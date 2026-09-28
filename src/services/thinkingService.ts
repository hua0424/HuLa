import { ImUrlEnum } from '@/enums'
import { imRequestSilent } from '@/utils/ImRequestUtils'
import type { ThinkingMetadataItem } from '@/types/thinking'

/** GET detail is authenticated and must return ownership fields before it can recover a missed START. */
export type ThinkingDetail = {
  id?: string | number
  thinkingId?: string | number
  roomId?: string | number
  aiclawUid?: string | number
  triggerMsgId?: string | number
  clientRunId?: string
  status: number
  durationMs?: number
}

export const loadThinkingDetail = async (thinkingId: string): Promise<ThinkingDetail | null> => {
  try {
    return (
      (await imRequestSilent<ThinkingDetail>({
        url: ImUrlEnum.AICLAW_THINKING_DETAIL,
        params: { thinkingId }
      })) ?? null
    )
  } catch (error) {
    console.error('[thinkingService] loadThinkingDetail failed:', error)
    return null
  }
}

export type LoadThinkingByTriggerParams = {
  /** 房间 ID */
  roomId: string | number
  /** 触发消息 ID 列表（非空、≤100） */
  triggerMsgIds: (string | number)[]
}

/**
 * 按触发消息批量反查 aiclaw 思考元数据（REQ-014 / ADR-0007）。
 *
 * 契约：POST /im/aiclaw/thinking/by-trigger
 * body: { roomId, triggerMsgIds[] }
 * resp: ThinkingMetadataItem[]（metadata only，无 content；展开全文仍走 AICLAW_THINKING_DETAIL）
 *
 * 使用静默请求：元数据加载失败不应阻塞消息列表渲染。
 */
export const loadThinkingByTrigger = async ({
  roomId,
  triggerMsgIds
}: LoadThinkingByTriggerParams): Promise<ThinkingMetadataItem[]> => {
  if (!roomId || !triggerMsgIds?.length) return []

  try {
    const data = await imRequestSilent<ThinkingMetadataItem[]>({
      url: ImUrlEnum.AICLAW_THINKING_BY_TRIGGER,
      body: {
        roomId: String(roomId),
        triggerMsgIds
      }
    })
    return data ?? []
  } catch (error) {
    console.error('[thinkingService] loadThinkingByTrigger failed:', error)
    return []
  }
}
