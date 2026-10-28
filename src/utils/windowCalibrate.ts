// aichatoverview#350：阅读窗口校准的纯逻辑（可单测）。
//
// 约定：调用方先把 items 归一化 sendTime（store 的 normalizeMsgSendTime），
// 合并为原地按 ID 合并（不重置列表、不碰滚动，锚点保留）；删除沿 deleteMsg 语义。
// aichatoverview#483：wire 字段统一 knownMsgIds（与服务端 DTO 同名，不再靠隐式转换）；
// 范围来自真实视口行而非全房已加载列表；冲突用逐 ID 触及集合而非全局序号跳过。

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
  /** 已知消息 id（十进制字符串）。服务端 DTO 同名 knownMsgIds——改名即断链，勿再改回。 */
  knownMsgIds: string[]
  pageSize: number
  requestId: string
  /** aichatoverview#351：已知思考 id（十进制字符串，上限 100），逐条回执 */
  knownThinkingIds: string[]
}

/** 十进制消息 id（与服务端 parseId 同口径）；乐观 temp 行（T 前缀）排除在外。 */
export const isDecimalId = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && s.length <= 32 && /^[0-9]+$/.test(s)

/** 服务端回收/撤回类型（MessageTypeEnum.RECALL=2）；撤回只做单向收敛。 */
const RECALL_MESSAGE_TYPE = 2

/**
 * aichatoverview#483：真实阅读窗口（视口相交行），由 ChatMain 的 DOM 接缝上报。
 * 只保留当前范围与有限续片 cursor，不复制全房消息。
 */
export interface ReadingWindow {
  roomId: string
  /** 浏览代次（切房/重进递增）；旧代次范围不得参与新范围校准 */
  browseSeq: number
  /** 范围代次（每次上报递增） */
  rangeSeq: number
  /** 与视口相交的行 ID（有序，升序） */
  ids: string[]
  firstId: string
  lastId: string
  anchorId: string
  anchorSendTime: number
  atBottom: boolean
  capturedAt: number
}

export interface BuildWindowInput {
  /** 本房已加载消息（升序），用于取 sendTime 与已知 ID 快照 */
  loadedAsc: WindowVisibleMsg[]
  /** 真实阅读窗口 ID（有序）；空表示尚未布局，退回 tail 快照 */
  windowIds?: string[]
  pageSize: number
  requestId: string
  knownThinkingIds?: string[]
}

/**
 * aichatoverview#483：范围取自真实相交行。
 *
 * - 有真实窗口：上界=窗口最后一条、下界=窗口首条，pageSize 覆盖窗口（上限 100），
 *   让「距末尾超过 100 条的旧可见消息」也在范围内，而不是只拉最新若干条；
 * - 无真实窗口：保留 #350 的 tail 快照语义（布局未知不等于可见范围已知）；
 * - knownMsgIds 优先包含窗口 ID（逐条回执正好覆盖本轮要纠正的行），再用其余已加载 ID 补满。
 */
export const buildWindowRange = (
  input: BuildWindowInput | WindowVisibleMsg[],
  pageSizeLegacy?: number,
  requestIdLegacy?: string,
  knownThinkingIdsLegacy: string[] = [],
  windowIdsLegacy?: string[]
): WindowRangeRequest => {
  // 兼容旧五参调用（#350 测试与既有调用点）；新代码请传对象。
  const args: BuildWindowInput = Array.isArray(input)
    ? {
        loadedAsc: input,
        windowIds: windowIdsLegacy,
        pageSize: pageSizeLegacy ?? 20,
        requestId: requestIdLegacy ?? '',
        knownThinkingIds: knownThinkingIdsLegacy
      }
    : input
  const byId = new Map(args.loadedAsc.map((m) => [m.id, m]))
  const windowIds = (args.windowIds ?? []).filter((id) => isDecimalId(id) && byId.has(id))
  const fallback = Math.min(Math.max(Math.floor(args.pageSize) || 20, 1), 100)
  const size = Math.min(Math.max(windowIds.length || 0, fallback), 100)
  const rangeIds = windowIds.length ? windowIds.slice(0, 100) : args.loadedAsc.slice(-size).map((m) => m.id)
  // 已知 ID 名额优先给窗口行：被挤掉的必须是「已加载但不可见」的行，绝不能是这一轮要纠正的行。
  // （旧的 [...windowIds, ...loaded].slice(-100) 会在已加载超过 100 条时把窗口行挤出回执。）
  const loadedIds = dedupeIds(args.loadedAsc.map((m) => m.id))
  const knownMsgIds = windowIds.length
    ? dedupeIds([...windowIds, ...loadedIds.slice(-100)]).slice(0, 100)
    : loadedIds.slice(-100)
  const thinking = (args.knownThinkingIds ?? []).map(String).filter(isDecimalId).slice(-100)
  const base = {
    mode: 'tail' as const,
    knownMsgIds,
    pageSize: size,
    requestId: args.requestId,
    knownThinkingIds: thinking
  }
  if (!rangeIds.length) return base
  const first = byId.get(rangeIds[0])
  const last = byId.get(rangeIds[rangeIds.length - 1])
  if (!first || !last) return base
  return {
    ...base,
    fromTimeMs: first.sendTime,
    fromId: isDecimalId(first.id) ? first.id : undefined,
    toTimeMs: last.sendTime,
    toId: isDecimalId(last.id) ? last.id : undefined
  }
}

const dedupeIds = (ids: string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (!isDecimalId(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export interface WindowMergeMsg {
  message?: { id?: string | number; sendTime?: number; messageType?: number; [k: string]: unknown } | null
  [k: string]: unknown
}

export interface WindowMergeInput {
  items: WindowMergeMsg[]
  unavailableIds: Array<string | number>
}

/** 行形状判定：合并/归一化之前先确认这是「带 id 与 sendTime 的消息行」。 */
const isMergeMsg = (value: unknown): value is WindowMergeMsg => {
  if (typeof value !== 'object' || value === null) return false
  const message = (value as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return false
  const row = message as { id?: unknown; sendTime?: unknown }
  if (row.id == null || String(row.id) === '') return false
  return typeof row.sendTime === 'number' || typeof (value as { sendTime?: unknown }).sendTime === 'number'
}

export interface WindowMergeGuards {
  existedIds: Set<string>
  /** aichatoverview#483：请求期间被 WS 触及的 ID（逐 ID）——只有这些行保留较新本地事实，
   *  无关的高流量新增不再让整批已存在行跳过（旧全局 wsTouched 会造成持续 partial/饿死）。 */
  touchedIds: Set<string>
  isTransient: (current: unknown) => boolean
}

export interface WindowMergeResult {
  merged: number
  deleted: number
  /** 本次因本地更新更新鲜而保留本地事实的行数（明细，不驱动整轮状态） */
  keptLocal: number
  /** 阅读锚点是否仍在列表中（在即保留成功） */
  anchorKept: boolean
  anchorId: string
}

/**
 * aichatoverview#483：原地合并。
 *
 * - 逐 ID 触及保护：只有请求期间真的被更新过的行跳过，避免无关流量造成整批 partial；
 * - 撤回单向：服务端已是 RECALL 而本地不是时总是收敛（不受触及保护阻挡）；
 * - 发送中/失败占位永不覆盖；
 * - 分页未出现的 ID 不删除；只有本请求 known 回执明确 unavailable 才删除，且受同一触及保护。
 */
export const mergeWindowResult = (
  roomMessages: Record<string, WindowMergeMsg>,
  input: WindowMergeInput,
  guards: WindowMergeGuards,
  anchorId: string
): WindowMergeResult => {
  let merged = 0
  let deleted = 0
  let keptLocal = 0
  for (const msg of input.items ?? []) {
    const rawId = msg?.message?.id
    if (rawId === undefined || rawId === null || rawId === '') continue
    const msgId = String(rawId)
    const current = roomMessages[msgId]
    if (guards.isTransient(current)) continue
    const incomingRecall = Number(msg?.message?.messageType) === RECALL_MESSAGE_TYPE
    const localRecall = Number(current?.message?.messageType) === RECALL_MESSAGE_TYPE
    if (current && incomingRecall && !localRecall) {
      roomMessages[msgId] = msg
      merged++
      continue
    }
    // 撤回单向：本地已撤回的行不能被同一批里更旧的 available 快照改回可读
    if (current && localRecall && !incomingRecall) {
      keptLocal++
      continue
    }
    if (guards.existedIds.has(msgId) && guards.touchedIds.has(msgId)) {
      keptLocal++
      continue
    }
    roomMessages[msgId] = msg
    merged++
  }
  const unavailable = new Set((input.unavailableIds ?? []).map(String))
  for (const id of unavailable) {
    const current = roomMessages[id]
    if (!current) continue
    if (guards.existedIds.has(id) && guards.touchedIds.has(id)) {
      keptLocal++
      continue
    }
    if (guards.isTransient(current)) continue
    delete roomMessages[id]
    deleted++
  }
  return { merged, deleted, keptLocal, anchorKept: !anchorId || !!roomMessages[anchorId], anchorId }
}

/** 旧服务端/404/缺字段一律判 unsupported（保持缓存、未校准、可重试），不当成功空。 */
export const isWindowUnsupported = (message: string): boolean =>
  /window_unsupported|status[^0-9]*404|\b404\b|not found|no handler|no static resource|no such route|unknown path/i.test(
    message ?? ''
  )

export type WindowCalibStatus = 'unknown' | 'calibrating' | 'ok' | 'partial' | 'unsupported' | 'error'

/**
 * aichatoverview#483：分面完成语义。消息覆盖、思考元数据/授权、已知实例终态、需要正文确认
 * 各有完成条件；任一分面未确认都不得让整轮报 ok（partial 的 ok 不驱动「已校准」）。
 */
export interface WindowCalibFacets {
  /** 本轮消息分片是否已覆盖请求范围（服务端 complete 且 knownComplete） */
  messages: boolean
  /** 思考元数据/授权是否本轮确认（无思考候选时记 true——无事可做） */
  thinkingMeta: boolean
  /** 已知思考实例是否已有终态（本轮全部服务或确认无候选） */
  thinkingTerminal: boolean
  /** 后续待补分片/待确认正文仍有缺口时为 false，保留下次机会 */
  settled: boolean
}

export interface WindowCalibOutcome {
  roomId: string
  ok: boolean
  status: WindowCalibStatus
  error?: string
  merged?: number
  deleted?: number
  anchorKept?: boolean
  facets?: WindowCalibFacets
}

/** 由分面推导整轮状态：只有全部分面确认才 ok。 */
export const resolveWindowStatus = (facets: WindowCalibFacets, complete: boolean): WindowCalibStatus => {
  if (!complete) return 'partial'
  return facets.messages && facets.thinkingMeta && facets.thinkingTerminal && facets.settled ? 'ok' : 'partial'
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

export interface ValidatedWindow {
  items: WindowMergeMsg[]
  unavailableIds: string[]
  /** available 回执携带的权威消息（服务端已确认存在的当前版本） */
  receiptMessages: WindowMergeMsg[]
  complete: boolean
  knownComplete: boolean
}

/**
 * aichatoverview#483：Web 直调 envelope 与 Rust 同口径严格校验（纯函数）。
 *
 * 缺字段/版本未知/capabilities 不足/回执数量或顺序不符/available 缺 message/
 * unavailable 带 message → null（unsupported：保持缓存、未校准、可重试，且绝不删消息）。
 * 权威集合 = items ∪ available receipts.message；分页未出现不等于删除。
 */
export const validateWindowEnvelope = (
  env:
    | {
        schemaVersion?: unknown
        capabilities?: unknown
        requestId?: unknown
        items?: unknown
        complete?: unknown
        knownReceipts?: unknown
        knownComplete?: unknown
      }
    | null
    | undefined,
  knownMsgIds: string[],
  requestId: string
): ValidatedWindow | null => {
  if (!env || env.schemaVersion !== 'msg-window-v1') return null
  if (!Array.isArray(env.capabilities)) return null
  const caps = env.capabilities.map(String)
  if (!caps.includes('messages') || !caps.includes('known-receipts')) return null
  if (env.requestId != null && String(env.requestId) !== requestId) return null
  if (!Array.isArray(env.items) || typeof env.complete !== 'boolean') return null
  if (!Array.isArray(env.knownReceipts) || typeof env.knownComplete !== 'boolean') return null
  if (env.knownReceipts.length !== knownMsgIds.length) return null
  // 每条 items 必须是可直接合并的消息行；形状不对不能进内存（否则后续 normalize 会抛错）
  if (!env.items.every(isMergeMsg)) return null
  const unavailableIds: string[] = []
  const receiptMessages: WindowMergeMsg[] = []
  for (let i = 0; i < env.knownReceipts.length; i++) {
    const r = env.knownReceipts[i] as { id?: unknown; available?: unknown; message?: unknown }
    if (String(r?.id ?? '') !== knownMsgIds[i] || typeof r?.available !== 'boolean') return null
    if (r.available) {
      if (!isMergeMsg(r.message)) return null
      receiptMessages.push(r.message)
    } else {
      if (r.message != null) return null
      unavailableIds.push(knownMsgIds[i])
    }
  }
  return {
    items: env.items as WindowMergeMsg[],
    unavailableIds,
    receiptMessages,
    complete: env.complete,
    knownComplete: env.knownComplete
  }
}

export interface RotatingCandidate {
  /** 稳定排序键（十进制 ID 或复合键） */
  key: string
}

export interface RotationResult<T> {
  batch: T[]
  /** 下一个游标（按 batch 实际推进，取模）；失败/仍运行也推进，避免饥饿 */
  nextCursor: number
}

/**
 * aichatoverview#483：有界轮转选择。
 *
 * 候选按「优先类在前、类内按 key 稳定升序」排序后，从 cursor 起环形取 limit 条；
 * 游标按实际取出的条数推进（不因失败/仍运行而停在原处），因此首批长期未终态也
 * 不会让后续实例永久饥饿；候选增删只影响排序，不重置到第一条。
 */
export const selectRotatingBatch = <T extends RotatingCandidate>(
  candidates: T[],
  cursor: number,
  limit: number,
  priority?: (c: T) => boolean
): RotationResult<T> => {
  if (!candidates.length || limit <= 0) return { batch: [], nextCursor: 0 }
  const ordered = [...candidates].sort((a, b) => {
    const pa = priority?.(a) ? 0 : 1
    const pb = priority?.(b) ? 0 : 1
    if (pa !== pb) return pa - pb
    return a.key.localeCompare(b.key, 'en', { numeric: true })
  })
  const start = ordered.length ? ((Math.floor(cursor) % ordered.length) + ordered.length) % ordered.length : 0
  const take = Math.min(limit, ordered.length)
  const batch = Array.from({ length: take }, (_, i) => ordered[(start + i) % ordered.length])
  return { batch, nextCursor: (start + take) % ordered.length }
}
