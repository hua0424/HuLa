// aichatoverview#483：阅读窗口校准的边界回归。
//
// 覆盖 AC03（触发/完成语义）、AC04（公平与预算）、AC06（缺项≠删除、撤回单向）、
// 以及 v1 设计 §2 指出的四个具体缺陷：
//   1. wire 字段 knownIds → knownMsgIds（与服务端 DTO / Rust 参数同名）
//   2. 范围来自真实视口行，而不是全房已加载列表末段
//   3. 全局 wsTouched 整批跳过 → 逐 ID 触及保护
//   4. 前 N 条长期未终态饿死后续候选 → 游标轮转
import { describe, expect, it } from 'vitest'
import {
  buildWindowRange,
  mergeWindowResult,
  resolveWindowStatus,
  selectRotatingBatch,
  validateWindowEnvelope,
  type WindowMergeMsg,
  type WindowCalibFacets
} from '@/utils/windowCalibrate'

const ROWS = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    id: String(from + i),
    sendTime: 1_700_000_000_000 + (from + i) * 1000
  }))

const envelope = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 'msg-window-v1',
  capabilities: ['messages', 'known-receipts'],
  requestId: 'req-1',
  items: [] as WindowMergeMsg[],
  complete: true,
  knownReceipts: [] as unknown[],
  knownComplete: true,
  ...over
})

describe('#483 wire 契约：knownMsgIds', () => {
  it('请求体字段名与服务端 DTO 同名，不再发 knownIds', () => {
    const range = buildWindowRange(ROWS(1, 5), 20, 'req-1')
    expect(Object.keys(range)).toContain('knownMsgIds')
    expect(Object.keys(range)).not.toContain('knownIds')
    expect(range.knownMsgIds).toEqual(['1', '2', '3', '4', '5'])
  })

  it('大 ID 保持字符串形式原样透传，不因 Number 精度丢位', () => {
    const bigId = '9007199254740993'
    const range = buildWindowRange([{ id: bigId, sendTime: 1 }], 20, 'req-big')
    expect(range.knownMsgIds).toEqual([bigId])
    expect(range.fromId).toBe(bigId)
  })

  it('非十进制（乐观 temp 行）不进 knownMsgIds，也不成为范围边界', () => {
    const range = buildWindowRange(
      [
        { id: '1', sendTime: 1000 },
        { id: 'T-abc', sendTime: 1001 },
        { id: '2', sendTime: 1002 }
      ],
      20,
      'req-t'
    )
    expect(range.knownMsgIds).toEqual(['1', '2'])
    expect(range.fromId).toBe('1')
    expect(range.toId).toBe('2')
  })
})

describe('#483 范围来自真实阅读窗口', () => {
  it('视口停在距末尾 150 条的旧消息上时，范围覆盖这些旧行而不是最新 20 条', () => {
    const loaded = ROWS(1, 400)
    const windowIds = ['100', '101', '102']
    const range = buildWindowRange({ loadedAsc: loaded, windowIds, pageSize: 20, requestId: 'req-old' })
    expect(range.fromId).toBe('100')
    expect(range.toId).toBe('102')
    // pageSize 不得小于窗口条数，否则服务端只会回最新一页
    expect(range.pageSize).toBeGreaterThanOrEqual(3)
    // 已知 ID 里必须包含本轮要纠正的行，回执才能逐条覆盖
    expect(range.knownMsgIds).toContain('100')
    expect(range.knownMsgIds).toContain('102')
  })

  it('窗口未知（未布局）时退回 tail 快照，不虚构可见范围', () => {
    const range = buildWindowRange({ loadedAsc: ROWS(1, 200), pageSize: 20, requestId: 'req-tail' })
    expect(range.mode).toBe('tail')
    expect(range.fromId).toBe('181')
    expect(range.toId).toBe('200')
  })

  it('已知 ID 上限 100，窗口行优先占据名额', () => {
    const loaded = ROWS(1, 300)
    const windowIds = ['150']
    const range = buildWindowRange({ loadedAsc: loaded, windowIds, pageSize: 20, requestId: 'req-cap' })
    expect(range.knownMsgIds.length).toBeLessThanOrEqual(100)
    expect(range.knownMsgIds[0]).toBe('150')
  })
})

describe('#483 合并：逐 ID 触及与单向撤回', () => {
  const base = (): Record<string, WindowMergeMsg> => ({
    '1': { message: { id: '1', sendTime: 1000, messageType: 1, content: 'local-1' } },
    '2': { message: { id: '2', sendTime: 1001, messageType: 1, content: 'local-2' } }
  })

  it('无关高流量触及其他行时，未被触及的行仍然收敛', () => {
    const roomMessages = base()
    const result = mergeWindowResult(
      roomMessages,
      {
        items: [
          { message: { id: '1', sendTime: 1000, messageType: 1, content: 'server-1' } },
          { message: { id: '2', sendTime: 1001, messageType: 1, content: 'server-2' } }
        ],
        unavailableIds: []
      },
      { existedIds: new Set(['1', '2']), touchedIds: new Set(['1']), isTransient: () => false },
      '1'
    )
    expect(roomMessages['1']?.message?.content).toBe('local-1')
    expect(roomMessages['2']?.message?.content).toBe('server-2')
    expect(result.merged).toBe(1)
    expect(result.keptLocal).toBe(1)
  })

  it('服务端撤回即使本地刚被触及也收敛（撤回单向，不因流量回退）', () => {
    const roomMessages = base()
    mergeWindowResult(
      roomMessages,
      { items: [{ message: { id: '1', sendTime: 1000, messageType: 2 } }], unavailableIds: [] },
      { existedIds: new Set(['1', '2']), touchedIds: new Set(['1']), isTransient: () => false },
      '1'
    )
    expect(roomMessages['1']?.message?.messageType).toBe(2)
  })

  it('分页未出现不等于删除：只有本次 known 回执明确 unavailable 才删', () => {
    const roomMessages = base()
    const result = mergeWindowResult(
      roomMessages,
      { items: [{ message: { id: '1', sendTime: 1000, messageType: 1 } }], unavailableIds: ['2'] },
      { existedIds: new Set(['1', '2']), touchedIds: new Set(), isTransient: () => false },
      '1'
    )
    expect(roomMessages['2']).toBeUndefined()
    expect(result.deleted).toBe(1)
    expect(result.anchorKept).toBe(true)
  })

  it('发送中/失败占位不被服务端快照覆盖，也不被删除', () => {
    const roomMessages: Record<string, WindowMergeMsg> = {
      '9': { message: { id: '9', sendTime: 2000, status: 'sending' } }
    }
    mergeWindowResult(
      roomMessages,
      { items: [{ message: { id: '9', sendTime: 2000, messageType: 1 } }], unavailableIds: ['9'] },
      { existedIds: new Set(['9']), touchedIds: new Set(), isTransient: () => true },
      '9'
    )
    expect(roomMessages['9']?.message?.status).toBe('sending')
  })

  it('锚点被撤回删除时 anchorKept=false，由既有邻接恢复接管', () => {
    const roomMessages = base()
    const result = mergeWindowResult(
      roomMessages,
      { items: [], unavailableIds: ['1'] },
      { existedIds: new Set(['1', '2']), touchedIds: new Set(), isTransient: () => false },
      '1'
    )
    expect(result.anchorKept).toBe(false)
  })
})

describe('#483 Web envelope 严格校验', () => {
  it('字段齐全时返回权威集合 = items ∪ available 回执消息', () => {
    const validated = validateWindowEnvelope(
      envelope({
        items: [{ message: { id: '1', sendTime: 1000, messageType: 1 } }],
        knownReceipts: [
          { id: '1', available: true, message: { message: { id: '1', sendTime: 1000, messageType: 1 } } },
          { id: '2', available: false }
        ]
      }),
      ['1', '2'],
      'req-1'
    )
    expect(validated).not.toBeNull()
    expect(validated?.items).toHaveLength(1)
    expect(validated?.receiptMessages).toHaveLength(1)
    expect(validated?.unavailableIds).toEqual(['2'])
    expect(validated?.complete).toBe(true)
  })

  it('回执条数与请求不一致 → null（不删任何消息、不报 ok）', () => {
    expect(
      validateWindowEnvelope(envelope({ knownReceipts: [{ id: '1', available: false }] }), ['1', '2'], 'req-1')
    ).toBeNull()
  })

  it('回执顺序错位 → null（不能把别的行的事实套到本行）', () => {
    expect(
      validateWindowEnvelope(
        envelope({
          knownReceipts: [
            { id: '2', available: false },
            { id: '1', available: false }
          ]
        }),
        ['1', '2'],
        'req-1'
      )
    ).toBeNull()
  })

  it('available 缺 message / unavailable 带 message → null', () => {
    expect(
      validateWindowEnvelope(envelope({ knownReceipts: [{ id: '1', available: true }] }), ['1'], 'req-1')
    ).toBeNull()
    expect(
      validateWindowEnvelope(
        envelope({ knownReceipts: [{ id: '1', available: false, message: { id: '1' } }] }),
        ['1'],
        'req-1'
      )
    ).toBeNull()
  })

  it('schema 版本未知或缺 capability → null（unsupported，保持缓存可重试）', () => {
    expect(validateWindowEnvelope(envelope({ schemaVersion: 'msg-window-v2' }), [], 'req-1')).toBeNull()
    expect(validateWindowEnvelope(envelope({ capabilities: ['messages'] }), [], 'req-1')).toBeNull()
  })

  it('requestId 回显不一致 → null（旧应答不得当作本轮结果）', () => {
    expect(validateWindowEnvelope(envelope({ requestId: 'req-0' }), [], 'req-1')).toBeNull()
  })
})

describe('#483 分面完成语义', () => {
  const facets = (over: Partial<WindowCalibFacets> = {}): WindowCalibFacets => ({
    messages: true,
    thinkingMeta: true,
    thinkingTerminal: true,
    settled: true,
    ...over
  })

  it('四分面全部确认才是 ok', () => {
    expect(resolveWindowStatus(facets(), true)).toBe('ok')
  })

  it('消息完整但思考未终态 → partial，不得报已校准', () => {
    expect(resolveWindowStatus(facets({ thinkingTerminal: false }), true)).toBe('partial')
  })

  it('消息分片未覆盖（complete=false）→ partial', () => {
    expect(resolveWindowStatus(facets(), false)).toBe('partial')
  })

  it('仍有待补分片/待确认正文（settled=false）→ partial，保留后续机会', () => {
    expect(resolveWindowStatus(facets({ settled: false }), true)).toBe('partial')
  })
})

describe('#483 公平轮转：首批长期未终态不饿死后续实例', () => {
  const candidates = (n: number) => Array.from({ length: n }, (_, i) => ({ key: String(i + 1) }))

  it('候选超过批次上限时按游标环形推进，每一轮都换人', () => {
    const all = candidates(101)
    const first = selectRotatingBatch(all, 0, 64)
    const second = selectRotatingBatch(all, first.nextCursor, 64)
    expect(first.batch).toHaveLength(64)
    expect(first.nextCursor).toBe(64)
    expect(second.nextCursor).toBe(27)
    const firstKeys = new Set(first.batch.map((c) => c.key))
    // 第一轮末尾的实例必须出现在第二轮里，否则永远轮不到
    expect(second.batch.some((c) => firstKeys.has(c.key))).toBe(true)
  })

  it('首批永久 active（每轮都返回）也不阻塞后续终态实例被服务', () => {
    const all = candidates(70)
    const served = new Set<string>()
    let cursor = 0
    for (let round = 0; round < 3; round++) {
      const rotated = selectRotatingBatch(all, cursor, 64)
      rotated.batch.forEach((c) => served.add(c.key))
      cursor = rotated.nextCursor
    }
    expect(served.size).toBe(70)
  })

  it('候选增删不重置到第一条（游标按实际取数推进）', () => {
    const all = candidates(10)
    const first = selectRotatingBatch(all, 0, 4)
    const shrunk = selectRotatingBatch(candidates(8), first.nextCursor, 4)
    expect(shrunk.batch.map((c) => c.key)).not.toEqual(['1', '2', '3', '4'])
  })

  it('优先类（当前视口）排在前面，但不会独占全部名额', () => {
    const all = [
      ...candidates(5).map((c) => ({ ...c, hot: false })),
      ...candidates(3).map((c) => ({ key: `p${c.key}`, hot: true }))
    ]
    const rotated = selectRotatingBatch(all, 0, 4, (c) => c.hot)
    expect(rotated.batch.slice(0, 3).every((c) => c.hot)).toBe(true)
    expect(rotated.batch.some((c) => !c.hot)).toBe(true)
  })

  it('空候选与非法上限返回空批次且不推进游标', () => {
    expect(selectRotatingBatch([], 5, 64)).toEqual({ batch: [], nextCursor: 0 })
    expect(selectRotatingBatch(candidates(3), 0, 0)).toEqual({ batch: [], nextCursor: 0 })
  })
})
