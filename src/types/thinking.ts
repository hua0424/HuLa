/**
 * AIclaw 思考状态类型（REQ-004）
 * 集中定义以避免 3 处重复定义导致的漂移风险
 */

/** 思考过程状态 */
export type ThinkingStatus = 'thinking' | 'complete' | 'error'

/** 单个思考会话的完整状态 */
export interface ThinkingState {
  /** 思考会话 ID（server 生成） */
  thinkingId: string
  /** aiclaw 用户 ID */
  aiclawId: number
  /** aiclaw 显示名 */
  aiclawName: string
  /** aiclaw 头像 */
  aiclawAvatar: string
  /** 房间 ID */
  roomId: string
  /** 当前思考内容（流式追加） */
  content: string
  /** 思考状态 */
  status: ThinkingStatus
  /** 开始时间戳 */
  startTime: number
  /** 结束时间戳（THINKING_END 时设置） */
  endTime?: number
  /** 处理耗时（毫秒，THINKING_END 时设置） */
  durationMs?: number
  /** 错误信息（status=error 时） */
  errorMsg?: string
  /** 触发消息 ID */
  triggerMsgId?: string
  /** delta 序号（用于去重） */
  lastSeq: number
  /** 是否已折叠 */
  collapsed: boolean
  /** 30s 延迟归档的 timeout ID（仅 store 层使用） */
  archiveTimeoutId?: ReturnType<typeof setTimeout>
}
