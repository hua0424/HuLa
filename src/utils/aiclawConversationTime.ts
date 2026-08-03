/**
 * aichatoverview#189：AI 助理对话管理列表的最后消息时间格式化。
 *
 * 后端 AiclawConversationResp.lastMessage.sendTime 为 epoch milli，
 * 但可能为 null 或被序列化成数字字符串——调用方不得直接 new Date(input)，
 * 否则非法输入会显示 NaN/NaN。
 */

/** 把后端 sendTime 归一为 epoch milli；非法输入返回 null */
export const normalizeEpochMs = (input: number | string | null | undefined): number | null => {
  if (input === null || input === undefined || input === '') return null
  const n = typeof input === 'string' ? Number(input) : input
  if (typeof n !== 'number' || Number.isNaN(n) || n <= 0) return null
  return n
}

/**
 * 格式化对话列表时间：今天 HH:mm，昨天显示 yesterdayLabel，更早 M/D。
 * 非法/空输入显示占位「-」。
 */
export const formatAiclawConversationTime = (
  input: number | string | null | undefined,
  yesterdayLabel: string
): string => {
  const ts = normalizeEpochMs(input)
  if (ts === null) return '-'

  const date = new Date(ts)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    return yesterdayLabel
  }
  return `${date.getMonth() + 1}/${date.getDate()}`
}
