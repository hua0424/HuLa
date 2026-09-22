/**
 * aichatoverview#285 历史消息回填：纯策略函数（无 store/网络依赖，可单测）。
 *
 * 约束：远端历史链第一次必须从服务端首页开始，允许重复拉到已缓存记录并按 ID 去重；
 * 不能拿本地最旧消息 ID 当作服务端首次游标。`isLast=false` 配空页是合法过滤空页，
 * 必须保留继续入口；仅当服务端明确 `isLast=true` 且本地也耗尽时才算真正结束。
 */

/** 远端分页进度：unknown=未开始，more=还有更多，end=服务端确认结束 */
export type RemoteStatus = 'unknown' | 'more' | 'end'

export interface HistoryProgress {
  localExhausted: boolean
  remoteStatus: RemoteStatus
}

/** UI 统一 `isLast` 派生：本地耗尽且远端确认结束才算真正结束 */
export const deriveIsLast = (progress: HistoryProgress): boolean => {
  return progress.localExhausted && progress.remoteStatus === 'end'
}

export type FirstScreenDecision = 'render-local' | 'backfill-remote'

/**
 * 首屏决策：本地非空立即渲染且不请求远端；本地为空且远端未知时自动回填一页。
 * 登录预加载只读本地，不触发回填。
 */
export const decideFirstScreen = (localCount: number, remoteStatus: RemoteStatus): FirstScreenDecision => {
  if (localCount > 0) return 'render-local'
  return remoteStatus === 'unknown' ? 'backfill-remote' : 'render-local'
}

export type LoadMoreDecision = 'stop' | 'local' | 'remote'

/** loadMore 决策：本地未耗尽走本地；本地耗尽（或本次本地为空）走远端；每次最多一页远端请求 */
export const decideLoadMore = (progress: HistoryProgress): LoadMoreDecision => {
  if (deriveIsLast(progress)) return 'stop'
  if (!progress.localExhausted) return 'local'
  return progress.remoteStatus === 'end' ? 'stop' : 'remote'
}

/**
 * 远端游标推进校验：`isLast=false` 却 cursor 缺失/不前进视为协议异常，
 * 调用方停止本轮并允许重试，防止死循环。
 */
export const shouldAdvanceRemote = (
  isLast: boolean,
  prevCursor: string,
  nextCursor: string | null | undefined
): boolean => {
  if (isLast) return true
  return !!nextCursor && nextCursor !== prevCursor
}

export interface PreheatCounts {
  withMessages: number
  empty: number
  failed: number
  total: number
}

/** 预热统计口径：空数组是合法空结果（远端未验证），不冒充成功也不伪造成错误 */
export const formatPreheatLog = (counts: PreheatCounts): string => {
  return `本地预加载：有消息 ${counts.withMessages}，空结果 ${counts.empty}（远端未验证），失败 ${counts.failed}，总计 ${counts.total}`
}

/** 远端 ID 去重：重复拉到已缓存记录按 ID 去重，不以本地最旧 ID 跳过缺口 */
export const splitFreshRemoteIds = (
  existingIds: Set<string>,
  remoteIds: string[]
): { fresh: string[]; duplicate: number } => {
  const fresh: string[] = []
  const seen = new Set<string>()
  for (const id of remoteIds) {
    if (existingIds.has(id) || seen.has(id)) continue
    seen.add(id)
    fresh.push(id)
  }
  return { fresh, duplicate: remoteIds.length - fresh.length }
}
