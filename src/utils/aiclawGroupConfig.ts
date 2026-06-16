import type { AiclawGroupConfig } from '@/services/wsType'

/**
 * 把本地群配置（n-switch 的 boolean 开关 + number）转成 server VO
 * AiclawGroupConfigUpdateReq 期望的 body。
 *
 * #53：server VO 的 respondToAi / mentionRequired 是 Integer(0/1)，前端 load 时把
 * server 的 1/0 归一成 boolean 喂 n-switch；保存若把 boolean 原样发，Jackson 反序列化
 * Integer 失败 → "参数类型解析异常"、保存不落库（加载转 boolean、保存没转回 = 不对称）。
 * 故这里把两个开关转回 0/1（Integer）；rateLimitPerMinute / dailyLimit 是 number 直传；
 * aiclawUid / roomId 是 Long（JSON number，< 2^53 安全）。不改 server VO。
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
  mentionRequired: config.mentionRequired ? 1 : 0
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
