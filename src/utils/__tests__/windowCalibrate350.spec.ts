import { describe, expect, it } from 'vitest'

import { buildWindowRange, isDecimalId, isWindowUnsupported, mergeWindowResult } from '@/utils/windowCalibrate'

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
})
