// aichatoverview#352：重登恢复房间阅读位置的纯逻辑（可单测）。
//
// 约定：持久化形状与 Rust `reading` 快照（im_local_snapshot name='reading'，
// 按 backend+UID 分库天然隔离）一致；store 只负责读写时机，解析/决策全在这里。

export interface ReadPosition {
  /** 首条可见消息 id（撤回占位保留 id，同样可命中） */
  anchorMsgId: string
  /** 锚点 sendTime：锚点被真删时按时间距离选邻近可读位置 */
  anchorSendTime: number
  /** 锚点顶部相对容器顶部的像素偏移 */
  offsetPx: number
  /** 上次离开时是否在底部：在底部直接跟随，不做锚点恢复 */
  wasAtBottom: boolean
  updatedAt: number
}

export interface ReadingSnapshot {
  version: 1
  lastRoomId: string
  positions: Record<string, ReadPosition>
}

export const READING_SNAPSHOT_VERSION = 1 as const
/** 锚点回填上限页数（每页 20 条，超出视为过深历史，直接邻近/底部兜底） */
export const RESTORE_BACKFILL_PAGES = 5

export const blankReadingSnapshot = (): ReadingSnapshot => ({ version: 1, lastRoomId: '', positions: {} })

const finiteNumber = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** 未知/旧形状一律判无效（调用方按无记录回列表），不抛异常、不猜测。 */
export const normalizeReadingSnapshot = (raw: unknown): ReadingSnapshot | null => {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  if (v.version !== READING_SNAPSHOT_VERSION) return null
  if (typeof v.lastRoomId !== 'string') return null
  const positions: Record<string, ReadPosition> = {}
  const src = v.positions
  if (src && typeof src === 'object') {
    for (const [roomId, p] of Object.entries(src as Record<string, unknown>)) {
      if (!roomId || !p || typeof p !== 'object') continue
      const q = p as Record<string, unknown>
      if (typeof q.anchorMsgId !== 'string' || !q.anchorMsgId) continue
      positions[roomId] = {
        anchorMsgId: q.anchorMsgId,
        anchorSendTime: finiteNumber(q.anchorSendTime, 0),
        offsetPx: Math.max(0, finiteNumber(q.offsetPx, 0)),
        wasAtBottom: q.wasAtBottom === true,
        updatedAt: finiteNumber(q.updatedAt, 0)
      }
    }
  }
  return { version: 1, lastRoomId: v.lastRoomId, positions }
}

/**
 * 重登目标房间：上次房间仍在当前会话列表才恢复；
 * 否则返回 null（调用方回列表），不猜测、不 fallback 到首个会话。
 */
export const pickRestoreRoom = (
  snapshot: ReadingSnapshot | null,
  sessionRoomIds: ReadonlySet<string> | string[]
): string | null => {
  const last = snapshot?.lastRoomId
  if (!last) return null
  const has = Array.isArray(sessionRoomIds) ? sessionRoomIds.includes(last) : sessionRoomIds.has(last)
  return has ? last : null
}

export interface RestoreAnchorMsg {
  id: string
  sendTime: number
}

export type RestoreResolution =
  | { kind: 'bottom' }
  | { kind: 'anchor'; anchorMsgId: string }
  | { kind: 'neighbor'; anchorMsgId: string }

/**
 * 锚点解析：锚点仍在列表直接用（撤回占位保留 id，同样命中）；
 * 真正删除按 sendTime 选时间最近的邻近可读位置；空列表回底部。
 */
export const resolveRestoreAnchor = (
  messages: RestoreAnchorMsg[],
  saved: Pick<ReadPosition, 'anchorMsgId' | 'anchorSendTime'>
): RestoreResolution => {
  if (!messages.length) return { kind: 'bottom' }
  if (messages.some((m) => m.id === saved.anchorMsgId)) return { kind: 'anchor', anchorMsgId: saved.anchorMsgId }
  const target = finiteNumber(saved.anchorSendTime, 0)
  let best = messages[0]
  let bestDist = Math.abs(finiteNumber(best.sendTime, 0) - target)
  for (const m of messages) {
    const dist = Math.abs(finiteNumber(m.sendTime, 0) - target)
    if (dist < bestDist) {
      best = m
      bestDist = dist
    }
  }
  return { kind: 'neighbor', anchorMsgId: best.id }
}

/** 历史阅读中新消息只提示；确在底部（状态或实测距离）才跟随到底。 */
export const shouldFollowNewMessage = (isAtBottom: boolean, distancePx: number, thresholdPx = 150): boolean =>
  isAtBottom || finiteNumber(distancePx, Number.MAX_SAFE_INTEGER) <= thresholdPx
