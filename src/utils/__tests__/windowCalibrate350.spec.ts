import { describe, expect, it } from 'vitest'

import {
  buildThinkingKnownIds,
  buildWindowRange,
  isDecimalId,
  isWindowUnsupported,
  mergeWindowResult,
  thinkingETagStale,
  validateThinkingEnvelope
} from '@/utils/windowCalibrate'

describe('windowCalibrate', () => {
  it('isDecimalId 排除乐观 temp 行与空值', () => {
    expect(isDecimalId('175988626166784')).toBe(true)
    expect(isDecimalId('T1728000000000')).toBe(false)
    expect(isDecimalId('')).toBe(false)
    expect(isDecimalId(undefined)).toBe(false)
    expect(isDecimalId(42)).toBe(false)
  })

  it('buildWindowRange 以上次快照固定上下界，已知 ID 截断 100', () => {
    const visible = Array.from({ length: 30 }, (_, i) => ({
      id: `${100 + i}`,
      sendTime: 1000 + i
    }))
    const range = buildWindowRange(visible, 20, 'req-1')
    expect(range.mode).toBe('tail')
    // 窗口取最后 20 条
    expect(range.fromId).toBe('110')
    expect(range.toId).toBe('129')
    expect(range.fromTimeMs).toBe(1010)
    expect(range.toTimeMs).toBe(1029)
    expect(range.knownIds).toHaveLength(30)
    expect(range.pageSize).toBe(20)
  })

  it('buildWindowRange 空窗口返回上界缺省的 tail', () => {
    const range = buildWindowRange([], 20, 'req-2')
    expect(range.mode).toBe('tail')
    expect(range.toId).toBeUndefined()
    expect(range.knownIds).toEqual([])
  })

  it('mergeWindowResult 原地合并：新增插入、已知未触及更新、在途触及保留', () => {
    const room: Record<string, any> = {
      '1': { message: { id: '1', sendTime: 1, body: { content: 'old' } } },
      '2': { message: { id: '2', sendTime: 2, body: { content: 'keep' } } }
    }
    const result = mergeWindowResult(
      room,
      {
        items: [
          { message: { id: '1', sendTime: 1, body: { content: 'recalled' } } },
          { message: { id: '3', sendTime: 3, body: { content: 'new' } } }
        ],
        unavailableIds: []
      },
      { existedIds: new Set(['1', '2']), wsTouched: false, isTransient: () => false },
      '2'
    )
    expect(result.merged).toBe(2)
    expect(room['1'].message.body.content).toBe('recalled')
    expect(room['3'].message.body.content).toBe('new')
    expect(room['2'].message.body.content).toBe('keep')
    expect(result.anchorKept).toBe(true)
  })

  it('mergeWindowResult 在途触及的行不被旧快照覆盖', () => {
    const room: Record<string, any> = {
      '1': { message: { id: '1', sendTime: 1, body: { content: 'ws-newer' } } }
    }
    const result = mergeWindowResult(
      room,
      { items: [{ message: { id: '1', sendTime: 1, body: { content: 'stale' } } }], unavailableIds: ['1'] },
      { existedIds: new Set(['1']), wsTouched: true, isTransient: () => false },
      '1'
    )
    expect(result.merged).toBe(0)
    expect(result.deleted).toBe(0)
    expect(room['1'].message.body.content).toBe('ws-newer')
    expect(result.anchorKept).toBe(true)
  })

  it('mergeWindowResult 不可用移除锚点时如实报告', () => {
    const room: Record<string, any> = {
      '1': { message: { id: '1', sendTime: 1 } },
      '2': { message: { id: '2', sendTime: 2 } }
    }
    const result = mergeWindowResult(
      room,
      { items: [], unavailableIds: ['1'] },
      { existedIds: new Set(['1', '2']), wsTouched: false, isTransient: () => false },
      '1'
    )
    expect(result.deleted).toBe(1)
    expect(room['1']).toBeUndefined()
    expect(room['2']).toBeDefined()
    expect(result.anchorKept).toBe(false)
  })

  it('mergeWindowResult 发送中占位永不覆盖或删除', () => {
    const room: Record<string, any> = {
      T1: { message: { id: 'T1', sendTime: 5, status: 'sending' } }
    }
    const result = mergeWindowResult(
      room,
      { items: [{ message: { id: 'T1', sendTime: 5 } }], unavailableIds: ['T1'] },
      {
        existedIds: new Set(['T1']),
        wsTouched: false,
        isTransient: (m: any) => m?.message?.status === 'sending'
      },
      'T1'
    )
    expect(result.merged).toBe(0)
    expect(result.deleted).toBe(0)
    expect(room['T1'].message.status).toBe('sending')
  })

  it('isWindowUnsupported 识别旧服务端与 404，网络失败另行重试', () => {
    expect(isWindowUnsupported('window_unsupported: 缺 complete')).toBe(true)
    expect(isWindowUnsupported('请求失败，状态码: 404')).toBe(true)
    expect(isWindowUnsupported('404 Not Found')).toBe(true)
    expect(isWindowUnsupported('network_error: timeout')).toBe(false)
    expect(isWindowUnsupported('请重新登录')).toBe(false)
  })

  it('buildWindowRange 附带已知思考 ID（十进制截断 100）', () => {
    const visible = [{ id: '7001', sendTime: 1000 }]
    const range = buildWindowRange(visible, 20, 'req-t', ['501', 'T9', '999'])
    expect(range.knownThinkingIds).toEqual(['501', '999'])
    const many = Array.from({ length: 150 }, (_, i) => `${5000 + i}`)
    expect(buildWindowRange([], 20, 'req-t2', many).knownThinkingIds).toHaveLength(100)
  })

  it('buildThinkingKnownIds 过滤非十进制并截断', () => {
    expect(buildThinkingKnownIds(['501', 502, 'T1', ''])).toEqual(['501', '502'])
  })

  it('thinkingETagStale 仅两端齐全且不等才判过期', () => {
    expect(thinkingETagStale('a', 'a')).toBe(false)
    expect(thinkingETagStale('a', 'b')).toBe(true)
    expect(thinkingETagStale(null, 'b')).toBe(false)
    expect(thinkingETagStale('a', null)).toBe(false)
    expect(thinkingETagStale(undefined, undefined)).toBe(false)
  })

  const thinkingEnvelope = () => ({
    thinkingAccess: true,
    thinkingTriggers: ['7001'],
    thinkingItems: [
      {
        id: '501',
        aiclawUid: '100',
        triggerMsgId: '7001',
        status: 1,
        durationMs: 120,
        hasResponse: 1,
        createTime: '2026-10-04T12:00:00',
        bodyETag: 'etag-501'
      },
      {
        id: 502,
        aiclawUid: 200,
        triggerMsgId: '7001',
        status: 4,
        durationMs: 130,
        hasResponse: 0,
        createTime: 1791112189184,
        bodyETag: 'etag-502'
      }
    ],
    thinkingComplete: true,
    thinkingKnownReceipts: [
      {
        id: '501',
        available: true,
        metadata: {
          id: '501',
          aiclawUid: '100',
          triggerMsgId: '7001',
          status: 1,
          createTime: '2026-10-04T12:00:00',
          bodyETag: 'etag-501'
        }
      },
      { id: '999', available: false, metadata: null }
    ],
    thinkingKnownComplete: true
  })

  it('validateThinkingEnvelope 同触发多助理归属与顺序、回执对齐', () => {
    const thinking = validateThinkingEnvelope(thinkingEnvelope(), ['501', '999'])
    expect(thinking?.access).toBe(true)
    expect(thinking?.triggers).toEqual(['7001'])
    expect(thinking?.items).toHaveLength(2)
    expect(thinking?.items[0].aiclawUid).toBe('100')
    expect(thinking?.items[1].aiclawUid).toBe('200')
    expect(thinking?.items[1].bodyETag).toBe('etag-502')
  })

  it('validateThinkingEnvelope 缺字段/回执不对齐/越界一律 null（保持缓存）', () => {
    expect(validateThinkingEnvelope(null, [])).toBeNull()
    expect(validateThinkingEnvelope({}, [])).toBeNull()
    expect(validateThinkingEnvelope(thinkingEnvelope(), ['501'])).toBeNull()
    const badOrder = thinkingEnvelope()
    badOrder.thinkingKnownReceipts = [...badOrder.thinkingKnownReceipts].reverse()
    expect(validateThinkingEnvelope(badOrder, ['501', '999'])).toBeNull()
    const outOfSet = thinkingEnvelope()
    ;(outOfSet.thinkingItems[0] as Record<string, unknown>).triggerMsgId = '7002'
    expect(validateThinkingEnvelope(outOfSet, ['501', '999'])).toBeNull()
    const badStatus = thinkingEnvelope()
    ;(badStatus.thinkingItems[0] as Record<string, unknown>).status = 9
    expect(validateThinkingEnvelope(badStatus, ['501', '999'])).toBeNull()
  })

  it('validateThinkingEnvelope 明确无权返回 access=false（调用方隐藏，不清缓存）', () => {
    const thinking = validateThinkingEnvelope({ thinkingAccess: false }, [])
    expect(thinking?.access).toBe(false)
    expect(thinking?.items).toEqual([])
  })
})
