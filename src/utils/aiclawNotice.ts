import { NoticeType, type NoticeItem } from '@/services/types'

/**
 * 判断通知是否为「AI 助理入群待批准」（REQ-009 #88）。
 */
export const isAiclawGroupApproveNotice = (item: NoticeItem): boolean =>
  item.eventType === NoticeType.AICLAW_GROUP_APPROVE

/**
 * 从 #88 通知中提取跳转目标。
 * 约定：senderId = aiclawUid，roomId = 群 roomId。
 */
export const getAiclawGroupApproveTarget = (item: NoticeItem): { aiclawUid: string; roomId: string } | null => {
  if (!isAiclawGroupApproveNotice(item)) return null
  if (!item.senderId || !item.roomId) return null
  return { aiclawUid: String(item.senderId), roomId: String(item.roomId) }
}
