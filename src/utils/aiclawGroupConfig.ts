import type { AiclawGroupConfig } from '@/services/wsType'

/**
 * 把 server 原始群配置（Integer 0/1 与 boolean 混用）归一化成前端 AiclawGroupConfig。
 *
 * #53：respondToAi / mentionRequired / approved 在 server 侧是 Integer(0/1)，前端统一用 boolean。
 * 对 approved 特殊处理：字段缺失时返回 undefined，避免 unloaded 状态被误判为未批准。
 */
export const normalizeAiclawGroupConfig = (raw: Record<string, unknown>): AiclawGroupConfig => ({
  rateLimitPerMinute: Number(raw.rateLimitPerMinute ?? 0),
  dailyLimit: Number(raw.dailyLimit ?? 0),
  respondToAi: raw.respondToAi === true || raw.respondToAi === 1,
  mentionRequired:
    raw.mentionRequired === undefined ? undefined : raw.mentionRequired === true || raw.mentionRequired === 1,
  approved: raw.approved === undefined ? undefined : raw.approved === true || raw.approved === 1,
  workspaceDir: typeof raw.workspaceDir === 'string' ? raw.workspaceDir : undefined
})

/**
 * 把本地群配置（n-switch 的 boolean 开关 + number）转成 server VO
 * AiclawGroupConfigUpdateReq 期望的 body。
 *
 * #53：server VO 的 respondToAi / mentionRequired / approved 是 Integer(0/1)，前端 load 时把
 * server 的 1/0 归一成 boolean 喂 n-switch；保存若把 boolean 原样发，Jackson 反序列化
 * Integer 失败 → "参数类型解析异常"、保存不落库（加载转 boolean、保存没转回 = 不对称）。
 * 故这里把开关转回 0/1（Integer）；rateLimitPerMinute / dailyLimit 是 number 直传；
 * workspaceDir 有值时原样下发；aiclawUid / roomId 是 Long（JSON number，< 2^53 安全）。
 */
export const buildAiclawGroupConfigUpdateBody = (
  aiclawUid: number,
  roomId: string | number,
  config: AiclawGroupConfig
) => ({
  aiclawUid,
  roomId: Number(roomId),
  rateLimitPerMinute: config.rateLimitPerMinute,
  dailyLimit: config.dailyLimit,
  respondToAi: config.respondToAi ? 1 : 0,
  mentionRequired: config.mentionRequired ? 1 : 0,
  approved: config.approved === true ? 1 : 0,
  workspaceDir: config.workspaceDir
})

/**
 * 把 server 返回的原始群配置归一化成前端 AiclawGroupConfig。
 *
 * #82 / REQ-009：server 对 boolean 类字段（respondToAi / mentionRequired / approved）
 * 可能返回 true/false 或 Integer 1/0；前端统一转成 boolean，避免 n-switch / 徽标判断混乱。
 * 缺省时：rate/daily 为 0，开关类字段为 false，approved 未返回时 undefined（不显示沉默标识）。
 */
export const normalizeAiclawGroupConfig = (raw: Record<string, unknown>): AiclawGroupConfig => ({
  rateLimitPerMinute: Number(raw.rateLimitPerMinute ?? 0),
  dailyLimit: Number(raw.dailyLimit ?? 0),
  respondToAi: raw.respondToAi === true || raw.respondToAi === 1,
  mentionRequired: raw.mentionRequired === true || raw.mentionRequired === 1,
  approved: raw.approved === undefined ? undefined : raw.approved === true || raw.approved === 1
})

/**
 * #56 群卡片标题：把内部数字 room_id 显示替换成「群名称(群号)」，
 * 例 `Dawn的群组(hula_mq8zrGyH)`。群号 = im_room_group.account（唯一人类可读群标识，
 * 用于进群核对）。取数在 chat.ts loadAiclawGroupConfigs 侧 enrich（groupStore 共享缓存
 * 命中即零网络，未命中 fetchGroupDetailSafely 拉一次）；本函数只负责显示拼接 + 兜底。
 *
 * 兜底阶梯（「最终别退回纯数字」）：
 *   名称 + 群号 → `名称(群号)`
 *   仅名称     → `名称`
 *   仅群号     → `群号`（account 本身可读，优于退纯数字）
 *   都缺       → `Group <roomId>`（真·最后兜底）
 * 空白串 trim 后按缺失处理，避免 `名称( )` 脏串。
 */
export const buildGroupCardLabel = (
  groupName?: string | null,
  account?: string | null,
  roomId?: string | number | null
): string => {
  const name = groupName?.trim()
  const acct = account?.trim()
  if (name && acct) return `${name}(${acct})`
  if (name) return name
  if (acct) return acct
  return `Group ${roomId ?? ''}`.trim()
}

/**
 * 默认工作目录模板：dir-based agent（opencode/codex）在群场景缺省落盘位置。
 * 与 plugins 派生规则保持一致，方便主人到机器上识别。
 */
export const buildDefaultWorkspaceDir = (aiclawUid: string | number, groupAccount?: string | null): string => {
  const account = groupAccount?.trim() || 'unknown'
  return `~/.aichat/opencode/workspace/${aiclawUid}/group/${account}`
}

/**
 * 判断该 aiclaw 类型是否需要显示工作目录字段。
 * 目前 dir-based agent：opencode / codex；openclaw 等不显示。
 */
export const isDirBasedAdapter = (adapterType?: string | null): boolean => {
  if (!adapterType) return false
  const lower = adapterType.toLowerCase()
  return lower === 'opencode' || lower === 'codex'
}
