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
