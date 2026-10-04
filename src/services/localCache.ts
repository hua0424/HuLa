import { TauriCommand, ImUrlEnum } from '@/enums'
import type { ThinkingMetadataItem, ThinkingState } from '@/types/thinking'
import { invokeWithErrorHandler } from '@/utils/TauriInvokeHandler'
import { imRequest } from '@/utils/ImRequestUtils'
import { isWeb } from '@/utils/PlatformConstants'
import { assertSessionCurrent, type SessionIdentity } from '@/services/sessionBinding'
import { loadThinkingByTrigger, type ThinkingDetail } from '@/services/thinkingService'

export type CachedThinking = {
  metadata: ThinkingMetadataItem
  roomId: string
  content: string | null
  bodyLoaded: boolean
  bodyETag: string | null
  bodyVerifiedAt: number | null
}
export type ThinkingCacheWindow = { items: CachedThinking[]; loadedTriggerIds: string[]; visibleTriggerIds: string[] }
const cacheable = (id: string) => /^\d{1,32}$/.test(id)
const idString = (id: string | number | null | undefined) => {
  if (typeof id === 'number' && !Number.isSafeInteger(id)) throw new Error('思考ID精度无效')
  return id == null ? '' : String(id)
}

export const readThinkingCache = async (
  binding: SessionIdentity,
  roomId: string,
  triggerMsgIds: string[]
): Promise<ThinkingCacheWindow> => {
  const ids = triggerMsgIds.filter(cacheable)
  if (!cacheable(roomId) || !ids.length) return { items: [], loadedTriggerIds: [], visibleTriggerIds: [] }
  return invokeWithErrorHandler(
    TauriCommand.READ_THINKING_CACHE,
    { binding, roomId, triggerMsgIds: ids },
    { showError: false }
  )
}

export const cacheThinkingMetadata = async (
  binding: SessionIdentity,
  roomId: string,
  triggerMsgIds: string[],
  items: ThinkingMetadataItem[]
): Promise<string[]> => {
  const ids = triggerMsgIds.filter(cacheable)
  if (!cacheable(roomId) || !ids.length) return []
  const normalized = items
    .map((item) => ({
      ...item,
      id: idString(item.id),
      aiclawUid: idString(item.aiclawUid),
      triggerMsgId: idString(item.triggerMsgId),
      // Rust's stored DTO is textual; preserve a numeric server instant, never invent Date.now().
      createTime: typeof item.createTime === 'number' ? new Date(item.createTime).toISOString() : item.createTime
    }))
    .filter((item) => ids.includes(item.triggerMsgId))
  return invokeWithErrorHandler<string[]>(
    TauriCommand.CACHE_THINKING_METADATA,
    { binding, roomId, triggerMsgIds: ids, items: normalized },
    { showError: false }
  )
}

export const readLocalSnapshot = <T>(binding: SessionIdentity, name: 'sessions' | 'reading'): Promise<T | null> =>
  invokeWithErrorHandler(TauriCommand.READ_LOCAL_SNAPSHOT, { binding, name }, { showError: false })
export const cacheLocalSnapshot = (binding: SessionIdentity, name: 'sessions' | 'reading', payload: unknown) =>
  invokeWithErrorHandler<void>(TauriCommand.CACHE_LOCAL_SNAPSHOT, { binding, name, payload }, { showError: false })

/** Successful cache is reused without a detail GET; missing content is not successful empty. */
const bodyRequests = new Map<string, Promise<{ content: string; status: number }>>()
export const loadThinkingBody = async (
  thinking: ThinkingState,
  binding: SessionIdentity | null
): Promise<{ content: string; status: number }> => {
  if (!binding) return readThinkingBody(thinking, null)
  const key = JSON.stringify([
    binding.backendKey,
    binding.uid,
    binding.sessionEpoch,
    thinking.roomId,
    thinking.triggerMsgId,
    String(thinking.aiclawId),
    thinking.thinkingId
  ])
  const inflight = bodyRequests.get(key)
  if (inflight) return inflight
  const task = readThinkingBody(thinking, binding)
  bodyRequests.set(key, task)
  try {
    return await task
  } finally {
    if (bodyRequests.get(key) === task) bodyRequests.delete(key)
  }
}

const readThinkingBody = async (
  thinking: ThinkingState,
  binding: SessionIdentity | null
): Promise<{ content: string; status: number }> => {
  let metadata: ThinkingMetadataItem | undefined
  if (binding && thinking.triggerMsgId) {
    const window = await readThinkingCache(binding, thinking.roomId, [thinking.triggerMsgId])
    const cached = window.items.find(
      (item) =>
        idString(item.metadata.id) === thinking.thinkingId &&
        idString(item.metadata.aiclawUid) === String(thinking.aiclawId) &&
        idString(item.metadata.triggerMsgId) === thinking.triggerMsgId
    )
    metadata = cached?.metadata
    if (cached?.bodyLoaded && typeof cached.content === 'string')
      return { content: cached.content, status: cached.metadata.status }
  }
  const detail = await imRequest<ThinkingDetail & { content?: string | null }>(
    {
      url: ImUrlEnum.AICLAW_THINKING_DETAIL,
      params: { thinkingId: thinking.thinkingId },
      binding: binding ?? undefined
    },
    { showError: false }
  )
  if (!detail || (detail.content != null && typeof detail.content !== 'string')) throw new Error('思考正文响应无效')
  const content = detail.content ?? ''
  if (binding) {
    if (
      idString(detail.thinkingId ?? detail.id) !== thinking.thinkingId ||
      idString(detail.roomId) !== thinking.roomId ||
      idString(detail.aiclawUid) !== String(thinking.aiclawId) ||
      idString(detail.triggerMsgId) !== (thinking.triggerMsgId ?? '') ||
      ![1, 4].includes(detail.status)
    )
      throw new Error('思考正文归属或结束状态未确认')
    if (!thinking.triggerMsgId) throw new Error('思考正文缺少可读触发消息')
    if (!metadata) {
      const items = await loadThinkingByTrigger({
        binding,
        roomId: thinking.roomId,
        triggerMsgIds: [thinking.triggerMsgId]
      })
      metadata = items?.find(
        (item) =>
          idString(item.id) === thinking.thinkingId &&
          idString(item.aiclawUid) === String(thinking.aiclawId) &&
          idString(item.triggerMsgId) === thinking.triggerMsgId
      )
      if (!items || !metadata) throw new Error('思考元数据尚未成功取得')
      await cacheThinkingMetadata(binding, thinking.roomId, [thinking.triggerMsgId], items)
    }
    await cacheThinkingMetadata(
      binding,
      thinking.roomId,
      [thinking.triggerMsgId],
      [{ ...metadata, status: detail.status, durationMs: detail.durationMs ?? undefined }]
    )
    await invokeWithErrorHandler(
      TauriCommand.CACHE_THINKING_BODY,
      {
        binding,
        roomId: thinking.roomId,
        triggerMsgId: thinking.triggerMsgId,
        aiclawUid: String(thinking.aiclawId),
        thinkingId: thinking.thinkingId,
        content
      },
      { showError: false }
    )
    await assertSessionCurrent(binding)
  } else if (!isWeb()) {
    throw new Error('思考正文缺少账号绑定')
  }
  return { content, status: detail.status }
}
