// aichatoverview#350：阅读窗口校准的纯逻辑（可单测）。
//
// 约定：调用方先把 items 归一化 sendTime（store 的 normalizeMsgSendTime），
// 合并为原地按 ID 合并（不重置列表、不碰滚动，锚点保留）；删除沿 deleteMsg 语义。

import type { ThinkingMetadataItem } from '@/types/thinking'

export interface WindowVisibleMsg {
  id: string
  sendTime: number
}

export interface WindowRangeRequest {
  mode: 'tail' | 'range'
  fromTimeMs?: number
  fromId?: string
  toTimeMs?: number
  toId?: string
  knownIds: string[]
  pageSize: number
  requestId: string
  /** aichatoverview#351：已知思考 id（十进制字符串，上限 100），逐条回执 */
  knownThinkingIds: string[]
}

/** 十进制消息 id（与服务端 parseId 同口径）；乐观 temp 行（T 前缀）排除在外。 */
export const isDecimalId = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && s.length <= 32 && /^[0-9]+$/.test(s)

/**
 * tail 窗口：上界固定为当前可见最后一条（此次快照上界），下界为窗口首条；
 * 空窗口返回上界缺省的 tail（服务端按快照上界覆盖）。
 */
export const buildWindowRange = (
  visibleAsc: WindowVisibleMsg[],
  pageSize: number,
  requestId: string,
  knownThinkingIds: string[] = []
): WindowRangeRequest => {
  const size = Math.min(Math.max(Math.floor(pageSize) || 20, 1), 100)
  const window = visibleAsc.slice(-size)
  const knownIds = visibleAsc
    .map((m) => m.id)
    .filter(isDecimalId)
    .slice(-100)
  const thinking = knownThinkingIds.filter(isDecimalId).slice(-100)
  if (window.length === 0) {
    return { mode: 'tail', knownIds, pageSize: size, requestId, knownThinkingIds: thinking }
  }
  const first = window[0]
  const last = window[window.length - 1]
  return {
    mode: 'tail',
    fromTimeMs: first.sendTime,
    fromId: isDecimalId(first.id) ? first.id : undefined,
    toTimeMs: last.sendTime,
    toId: isDecimalId(last.id) ? last.id : undefined,
    knownIds,
    pageSize: size,
    requestId,
    knownThinkingIds: thinking
  }
}

export interface WindowMergeMsg {
  message?: { id?: string | number; sendTime?: number; [k: string]: unknown } | null
  [k: string]: unknown
}

export interface WindowMergeInput {
  items: WindowMergeMsg[]
  unavailableIds: Array<string | number>
}

export interface WindowMergeGuards {
  existedIds: Set<string>
  /** 请求期间被 WS 更新过（roomMsgSeq 推进）：已存在行保留较新本地事实 */
  wsTouched: boolean
  isTransient: (current: unknown) => boolean
}

export interface WindowMergeResult {
  merged: number
  deleted: number
  /** 阅读锚点是否仍在列表中（在即保留成功） */
  anchorKept: boolean
  anchorId: string
}

export const mergeWindowResult = (
  roomMessages: Record<string, WindowMergeMsg>,
  input: WindowMergeInput,
  guards: WindowMergeGuards,
  anchorId: string
): WindowMergeResult => {
  let merged = 0
  let deleted = 0
  for (const msg of input.items ?? []) {
    const rawId = msg?.message?.id
    if (rawId === undefined || rawId === null || rawId === '') continue
    const msgId = String(rawId)
    const existedBefore = guards.existedIds.has(msgId)
    if (existedBefore) {
      // 请求期间被 WS 更新过的 ID 不被旧快照覆盖；发送中/失败占位永不覆盖
      if (guards.wsTouched) continue
      if (guards.isTransient(roomMessages[msgId])) continue
    }
    roomMessages[msgId] = msg
    merged++
  }
  const unavailable = new Set((input.unavailableIds ?? []).map(String))
  for (const id of unavailable) {
    const current = roomMessages[id]
    if (!current) continue
    if (guards.existedIds.has(id) && guards.wsTouched) continue
    if (guards.isTransient(current)) continue
    delete roomMessages[id]
    deleted++
  }
  return { merged, deleted, anchorKept: !anchorId || !!roomMessages[anchorId], anchorId }
}

/** 旧服务端/404/缺字段一律判 unsupported（保持缓存、未校准、可重试），不当成功空。 */
export const isWindowUnsupported = (message: string): boolean =>
  /window_unsupported|status[^0-9]*404|\b404\b|not found|no handler|no static resource|no such route|unknown path/i.test(
    message ?? ''
  )

export type WindowCalibStatus = 'unknown' | 'calibrating' | 'ok' | 'partial' | 'unsupported' | 'error'

export interface WindowCalibOutcome {
  roomId: string
  ok: boolean
  status: WindowCalibStatus
  error?: string
  merged?: number
  deleted?: number
  anchorKept?: boolean
}

/** aichatoverview#351：从已缓存思考 ID 收集已知思考 ID（十进制，上限 100）。 */
export const buildThinkingKnownIds = (ids: Array<string | number>): string[] =>
  ids.map(String).filter(isDecimalId).slice(-100)

/**
 * aichatoverview#351：ETag 差异才判过期。任一端缺 ETag 不判差异（无从校验，
 * 不作无思考证据）；相等命中缓存，差异使当前校验状态失效。
 */
export const thinkingETagStale = (
  cachedETag: string | null | undefined,
  metaETag: string | null | undefined
): boolean => !!cachedETag && !!metaETag && cachedETag !== metaETag

export interface ThinkingCalibInput {
  access: boolean
  triggers: string[]
  items: ThinkingMetadataItem[]
}

/**
 * aichatoverview#351：思考 envelope 独立校验（纯函数）。
 *
 * 缺字段/回执不对齐/元数据越界一律返回 null（保持既有缓存、未校准、可重试，
 * 不影响消息）；access=false 是明确无权（调用方隐藏卡片与正文），同样不碰缓存。
 */
export const validateThinkingEnvelope = (
  env:
    | {
        thinkingAccess?: unknown
        thinkingTriggers?: unknown
        thinkingItems?: unknown
        thinkingComplete?: unknown
        thinkingKnownReceipts?: unknown
        thinkingKnownComplete?: unknown
      }
    | null
    | undefined,
  knownThinkingIds: string[]
): ThinkingCalibInput | null => {
  if (!env || typeof env.thinkingAccess !== 'boolean') return null
  if (!env.thinkingAccess) return { access: false, triggers: [], items: [] }
  const triggers = Array.isArray(env.thinkingTriggers) ? env.thinkingTriggers.map(String) : null
  if (!triggers || triggers.length > 100 || !triggers.every(isDecimalId)) return null
  if (!Array.isArray(env.thinkingItems) || typeof env.thinkingComplete !== 'boolean') return null
  const receipts = Array.isArray(env.thinkingKnownReceipts) ? env.thinkingKnownReceipts : null
  if (!receipts || typeof env.thinkingKnownComplete !== 'boolean') return null
  if (receipts.length !== knownThinkingIds.length) return null
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i] as { id?: unknown; available?: unknown; metadata?: unknown }
    if (String(r?.id ?? '') !== knownThinkingIds[i] || typeof r?.available !== 'boolean') return null
    if (r.available && (typeof r.metadata !== 'object' || r.metadata === null)) return null
    if (!r.available && r.metadata != null) return null
  }
  const triggerSet = new Set(triggers)
  const items: ThinkingMetadataItem[] = []
  for (const raw of env.thinkingItems) {
    const m = raw as Record<string, unknown>
    const id = String(m?.id ?? '')
    const aiclawUid = String(m?.aiclawUid ?? '')
    const triggerMsgId = String(m?.triggerMsgId ?? '')
    const status = typeof m?.status === 'number' ? m.status : Number.NaN
    if (
      !isDecimalId(id) ||
      !isDecimalId(aiclawUid) ||
      !isDecimalId(triggerMsgId) ||
      !Number.isInteger(status) ||
      status < 0 ||
      status > 4 ||
      !triggerSet.has(triggerMsgId)
    )
      return null
    items.push({
      id,
      aiclawUid,
      triggerMsgId,
      status,
      durationMs: typeof m.durationMs === 'number' ? m.durationMs : undefined,
      hasResponse: typeof m.hasResponse === 'number' ? m.hasResponse : undefined,
      createTime: typeof m.createTime === 'string' || typeof m.createTime === 'number' ? m.createTime : '',
      bodyETag: typeof m.bodyETag === 'string' ? m.bodyETag : null
    })
  }
  items.sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }))
  return { access: true, triggers, items }
}
