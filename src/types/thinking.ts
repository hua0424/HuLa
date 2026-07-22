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
  /** 是否已折叠 */
  collapsed: boolean
}

/**
 * 服务端 thinking 元数据项（POST /im/aiclaw/thinking/by-trigger 返回）
 *
 * 不含全文 content；点开单条时再通过 AICLAW_THINKING_DETAIL 拉取全文。
 */
export interface ThinkingMetadataItem {
  /** thinkingId（展开时用于拉取全文） */
  id: number | string
  /** 产生 thinking 的 aiclaw uid */
  aiclawUid: number | string
  /** 触发本次 thinking 的消息 ID */
  triggerMsgId?: number | string
  /**
   * 状态：0=进行中 1=成功 2=错误 3=超时 4=超长截断
   */
  status: number
  /** 处理耗时（毫秒） */
  durationMs?: number
  /** 是否产生了回复消息：0=否，1=是 */
  hasResponse?: number
  /** 创建时间（服务端 LocalDateTime 字符串） */
  createTime: string
}

/** 将服务端 thinking 状态码映射为前端 ThinkingStatus */
export const mapServerThinkingStatus = (status: number): ThinkingStatus => {
  switch (status) {
    case 1:
    case 4:
      return 'complete'
    case 2:
    case 3:
      return 'error'
    default:
      return 'thinking'
  }
}

/**
 * 将服务端创建时间字符串解析为时间戳。
 * 非法/空值返回当前时间戳，避免后续排序出现 NaN。
 */
export const parseThinkingCreateTime = (createTime: string | undefined): number => {
  if (!createTime) return Date.now()
  const ts = new Date(createTime).getTime()
  return Number.isNaN(ts) ? Date.now() : ts
}
