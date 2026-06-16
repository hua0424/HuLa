import { describe, expect, it } from 'vitest'
import { buildAiclawGroupConfigUpdateBody } from '@/utils/aiclawGroupConfig'
import type { AiclawGroupConfig } from '@/services/wsType'

/**
 * #53 群配置保存 boolean→Integer 类型不对称回归锁。
 *
 * server VO AiclawGroupConfigUpdateReq 的 respondToAi / mentionRequired 是 Integer(0/1)，
 * 但前端 load 时把 server 的 1/0 归一成 boolean 喂 n-switch；保存若把 boolean 原样发，
 * Jackson 反序列化 Integer 失败 → "参数类型解析异常"、保存不落库。
 *
 * 本 helper 是 saveAiclawGroupConfig 的可测缝：把本地（boolean 开关 + number）配置
 * 转成 server VO 期望的 body——两个开关转 0/1（Integer），rate/daily 保持 number，
 * aiclawUid/roomId 保持 number（Long < 2^53）。
 */

const base: AiclawGroupConfig = {
  rateLimitPerMinute: 10,
  dailyLimit: 1000,
  respondToAi: true,
  mentionRequired: true
}

describe('#53 buildAiclawGroupConfigUpdateBody：boolean 开关转 Integer 0/1', () => {
  it('respondToAi / mentionRequired = true → 1', () => {
    const body = buildAiclawGroupConfigUpdateBody(1001, '2002', { ...base, respondToAi: true, mentionRequired: true })
    expect(body.respondToAi).toBe(1)
    expect(body.mentionRequired).toBe(1)
  })

  it('respondToAi / mentionRequired = false → 0', () => {
    const body = buildAiclawGroupConfigUpdateBody(1001, '2002', { ...base, respondToAi: false, mentionRequired: false })
    expect(body.respondToAi).toBe(0)
    expect(body.mentionRequired).toBe(0)
  })

  it('mentionRequired 缺省（undefined）→ 0', () => {
    const cfg = { rateLimitPerMinute: 5, dailyLimit: 100, respondToAi: false } as AiclawGroupConfig
    const body = buildAiclawGroupConfigUpdateBody(1001, '2002', cfg)
    expect(body.mentionRequired).toBe(0)
  })

  it('两个开关在 body 里是 number 类型（非 boolean）——这是 bug 的判别点', () => {
    const body = buildAiclawGroupConfigUpdateBody(1001, '2002', base)
    expect(typeof body.respondToAi).toBe('number')
    expect(typeof body.mentionRequired).toBe('number')
  })

  it('rateLimitPerMinute / dailyLimit 作为 number 透传', () => {
    const body = buildAiclawGroupConfigUpdateBody(1001, '2002', { ...base, rateLimitPerMinute: 7, dailyLimit: 250 })
    expect(body.rateLimitPerMinute).toBe(7)
    expect(body.dailyLimit).toBe(250)
  })

  it('aiclawUid 透传、roomId 字符串转 number（Long）', () => {
    const body = buildAiclawGroupConfigUpdateBody(1001, '2002', base)
    expect(body.aiclawUid).toBe(1001)
    expect(body.roomId).toBe(2002)
    expect(typeof body.roomId).toBe('number')
  })
})
