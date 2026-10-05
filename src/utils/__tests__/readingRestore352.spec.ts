import { describe, expect, it } from 'vitest'

/**
 * aichatoverview#352：阅读位置纯逻辑——快照归一化、重登选房、锚点解析、跟随判定。
 */

import {
  blankReadingSnapshot,
  decideMountRestore,
  isRestoreSettling,
  normalizeReadingSnapshot,
  pickRestoreRoom,
  RESTORE_SETTLE_MS,
  resolveRestoreAnchor,
  shouldFollowNewMessage
} from '@/utils/readingRestore'

describe('normalizeReadingSnapshot (#352)', () => {
  it('合法形状原样通过', () => {
    const raw = {
      version: 1,
      lastRoomId: 'r1',
      positions: {
        r1: { anchorMsgId: 'm5', anchorSendTime: 50, offsetPx: 12, wasAtBottom: false, updatedAt: 7 }
      }
    }
    expect(normalizeReadingSnapshot(raw)).toEqual(raw)
  })

  it('未知/旧形状一律无效（按无记录回列表），不抛异常', () => {
    expect(normalizeReadingSnapshot(null)).toBeNull()
    expect(normalizeReadingSnapshot(undefined)).toBeNull()
    expect(normalizeReadingSnapshot('reading')).toBeNull()
    expect(normalizeReadingSnapshot({ version: 0, lastRoomId: 'r1', positions: {} })).toBeNull()
    expect(normalizeReadingSnapshot({ lastRoomId: 'r1' })).toBeNull()
    expect(normalizeReadingSnapshot({ version: 1, lastRoomId: 42, positions: {} })).toBeNull()
  })

  it('坏锚点条目跳过、偏移钳制、wasAtBottom 严格 true', () => {
    const snapshot = normalizeReadingSnapshot({
      version: 1,
      lastRoomId: 'r1',
      positions: {
        r1: { anchorMsgId: 'm5', anchorSendTime: Number.NaN, offsetPx: -30, wasAtBottom: 1, updatedAt: 7 },
        r2: { anchorSendTime: 1 },
        '': { anchorMsgId: 'm9' }
      }
    })
    expect(snapshot?.positions['r1']).toEqual({
      anchorMsgId: 'm5',
      anchorSendTime: 0,
      offsetPx: 0,
      wasAtBottom: false,
      updatedAt: 7
    })
    expect(snapshot?.positions['r2']).toBeUndefined()
    expect(blankReadingSnapshot()).toEqual({ version: 1, lastRoomId: '', positions: {} })
  })
})

describe('pickRestoreRoom (#352)', () => {
  const snapshot = normalizeReadingSnapshot({
    version: 1,
    lastRoomId: 'r1',
    positions: { r1: { anchorMsgId: 'm5', anchorSendTime: 50, offsetPx: 0, wasAtBottom: false, updatedAt: 1 } }
  })

  it('上次房间仍在列表才恢复', () => {
    expect(pickRestoreRoom(snapshot, ['r1', 'r2'])).toBe('r1')
    expect(pickRestoreRoom(snapshot, new Set(['r9', 'r1']))).toBe('r1')
  })

  it('目标不在列表/无记录返回 null（调用方回列表），不猜首个会话', () => {
    expect(pickRestoreRoom(snapshot, ['r2', 'r3'])).toBeNull()
    expect(pickRestoreRoom(snapshot, [])).toBeNull()
    expect(pickRestoreRoom(null, ['r1'])).toBeNull()
    expect(pickRestoreRoom(blankReadingSnapshot(), ['r1'])).toBeNull()
  })
})

describe('resolveRestoreAnchor (#352)', () => {
  const list = [
    { id: 'm1', sendTime: 10 },
    { id: 'm2', sendTime: 20 },
    { id: 'm3', sendTime: 30 }
  ]

  it('锚点仍在直接命中（撤回占位保留 id 同样命中）', () => {
    expect(resolveRestoreAnchor(list, { anchorMsgId: 'm2', anchorSendTime: 20 })).toEqual({
      kind: 'anchor',
      anchorMsgId: 'm2'
    })
  })

  it('锚点真删按时间选邻近可读位置', () => {
    expect(resolveRestoreAnchor(list, { anchorMsgId: 'gone', anchorSendTime: 21 })).toEqual({
      kind: 'neighbor',
      anchorMsgId: 'm2'
    })
    expect(resolveRestoreAnchor(list, { anchorMsgId: 'gone', anchorSendTime: 1000 })).toEqual({
      kind: 'neighbor',
      anchorMsgId: 'm3'
    })
    expect(resolveRestoreAnchor(list, { anchorMsgId: 'gone', anchorSendTime: 0 })).toEqual({
      kind: 'neighbor',
      anchorMsgId: 'm1'
    })
  })

  it('空列表回底部', () => {
    expect(resolveRestoreAnchor([], { anchorMsgId: 'm2', anchorSendTime: 20 })).toEqual({ kind: 'bottom' })
  })
})

describe('shouldFollowNewMessage (#352)', () => {
  it('确在底部才跟随，历史阅读只提示', () => {
    expect(shouldFollowNewMessage(true, 5000)).toBe(true)
    expect(shouldFollowNewMessage(false, 0)).toBe(true)
    expect(shouldFollowNewMessage(false, 150)).toBe(true)
    expect(shouldFollowNewMessage(false, 151)).toBe(false)
    expect(shouldFollowNewMessage(false, 5000)).toBe(false)
  })
})

describe('isRestoreSettling (#352 恢复后抢底修复)', () => {
  const now = 1_000_000

  it('同房间窗口期内让位（SESSION_CHANGED 滞后到底被抑制）', () => {
    expect(isRestoreSettling(now - 50, 'r1', 'r1', now)).toBe(true)
    expect(isRestoreSettling(now - (RESTORE_SETTLE_MS - 1), 'r1', 'r1', now)).toBe(true)
  })

  it('窗口过期后恢复正常跟随', () => {
    expect(isRestoreSettling(now - RESTORE_SETTLE_MS, 'r1', 'r1', now)).toBe(false)
    expect(isRestoreSettling(now - 60_000, 'r1', 'r1', now)).toBe(false)
  })

  it('别的房间不受上一个房间恢复窗口影响（快速切房不被 stranded）', () => {
    expect(isRestoreSettling(now - 50, 'r1', 'r2', now)).toBe(false)
  })

  it('无记录/时钟异常不抑制（不误伤普通到底）', () => {
    expect(isRestoreSettling(0, 'r1', 'r1', now)).toBe(false)
    expect(isRestoreSettling(now - 50, null, 'r1', now)).toBe(false)
    expect(isRestoreSettling(now - 50, 'r1', null, now)).toBe(false)
    expect(isRestoreSettling(now + 1000, 'r1', 'r1', now)).toBe(false)
  })
})

describe('decideMountRestore (#352 warm 重登挂载恢复)', () => {
  const saved = { wasAtBottom: false, anchorMsgId: 'm5' }

  it('pending 已就绪直接 RESTORE（组件后挂载不错过）', () => {
    expect(decideMountRestore('r1', 'r1', saved)).toBe('restore')
    expect(decideMountRestore('r1', 'r1', null)).toBe('restore')
  })

  it('有未恢复的非底部锚点则 armed 等回填，不抢底', () => {
    expect(decideMountRestore(null, 'r1', saved)).toBe('arm')
    expect(decideMountRestore('r2', 'r1', saved)).toBe('arm')
  })

  it('无记录/已在底部/锚点缺失回底部', () => {
    expect(decideMountRestore(null, 'r1', null)).toBe('bottom')
    expect(decideMountRestore(null, 'r1', { wasAtBottom: true, anchorMsgId: 'm5' })).toBe('bottom')
    expect(decideMountRestore(null, 'r1', { wasAtBottom: false, anchorMsgId: '' })).toBe('bottom')
    expect(decideMountRestore(null, null, saved)).toBe('bottom')
    expect(decideMountRestore(null, '', saved)).toBe('bottom')
  })

  it('R4：快照未读回不判 bottom，持 arm 等回填（无房间仍回底部）', () => {
    expect(decideMountRestore(null, 'r1', null, false)).toBe('arm')
    expect(decideMountRestore(null, 'r1', saved, false)).toBe('arm')
    expect(decideMountRestore('r1', 'r1', null, false)).toBe('restore')
    expect(decideMountRestore(null, null, null, false)).toBe('bottom')
    expect(decideMountRestore(null, '', saved, false)).toBe('bottom')
  })
})
