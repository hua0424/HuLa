import { describe, expect, it } from 'vitest'
import { isAiclawGroupApproveNotice, getAiclawGroupApproveTarget } from '@/utils/aiclawNotice'
import { NoticeType, type NoticeItem } from '@/services/types'

const makeNotice = (eventType: number, senderId?: string, roomId?: string): NoticeItem => ({
  id: '1',
  eventType,
  type: 1,
  senderId: senderId ?? '1001',
  receiverId: '2001',
  applyId: '0',
  roomId: roomId ?? '3001',
  content: 'Test Group',
  status: 0,
  isRead: false,
  createTime: Date.now()
})

describe('#88 aiclawNotice helpers', () => {
  it('isAiclawGroupApproveNotice 仅对 eventType === 11 返回 true', () => {
    expect(isAiclawGroupApproveNotice(makeNotice(NoticeType.AICLAW_GROUP_APPROVE))).toBe(true)
    expect(isAiclawGroupApproveNotice(makeNotice(NoticeType.GROUP_APPLY))).toBe(false)
    expect(isAiclawGroupApproveNotice(makeNotice(NoticeType.AICLAW_DEVICE_AUTH))).toBe(false)
  })

  it('getAiclawGroupApproveTarget 返回 senderId 作为 aiclawUid、roomId 作为群 id', () => {
    const target = getAiclawGroupApproveTarget(makeNotice(NoticeType.AICLAW_GROUP_APPROVE, '1001', '3001'))
    expect(target).toEqual({ aiclawUid: '1001', roomId: '3001' })
  })

  it('getAiclawGroupApproveTarget 对非 #88 通知返回 null', () => {
    expect(getAiclawGroupApproveTarget(makeNotice(NoticeType.GROUP_APPLY))).toBeNull()
  })

  it('getAiclawGroupApproveTarget 在 senderId/roomId 缺失时返回 null（防御性）', () => {
    expect(getAiclawGroupApproveTarget(makeNotice(NoticeType.AICLAW_GROUP_APPROVE, '', '3001'))).toBeNull()
    expect(getAiclawGroupApproveTarget(makeNotice(NoticeType.AICLAW_GROUP_APPROVE, '1001', ''))).toBeNull()
  })
})
