import { describe, expect, it } from 'vitest'
import {
  buildAiclawGroupConfigUpdateBody,
  buildGroupCardLabel,
  normalizeAiclawGroupConfig,
  sortAiclawGroupConfigs
} from '@/utils/aiclawGroupConfig'
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

  it('#134：批准操作时未提供的字段不写入 body，避免覆盖服务端原值', () => {
    const body = buildAiclawGroupConfigUpdateBody(1001, '2002', { approved: true })
    expect(body.approved).toBe(1)
    expect(body.rateLimitPerMinute).toBeUndefined()
    expect(body.dailyLimit).toBeUndefined()
    expect(body.respondToAi).toBeUndefined()
    expect(body.mentionRequired).toBeUndefined()
    expect(body.workspaceDir).toBeUndefined()
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

describe('#82 / REQ-009 normalizeAiclawGroupConfig：server 1/0 与 boolean 归一化', () => {
  it('approved=1 → true', () => {
    const cfg = normalizeAiclawGroupConfig({ approved: 1 })
    expect(cfg.approved).toBe(true)
  })

  it('approved=true → true', () => {
    const cfg = normalizeAiclawGroupConfig({ approved: true })
    expect(cfg.approved).toBe(true)
  })

  it('approved=0 → false', () => {
    const cfg = normalizeAiclawGroupConfig({ approved: 0 })
    expect(cfg.approved).toBe(false)
  })

  it('approved=false → false', () => {
    const cfg = normalizeAiclawGroupConfig({ approved: false })
    expect(cfg.approved).toBe(false)
  })

  it('approved 缺省 → undefined', () => {
    const cfg = normalizeAiclawGroupConfig({})
    expect(cfg.approved).toBeUndefined()
  })

  it('respondToAi / mentionRequired 同样做 1/0 ↔ boolean 归一化', () => {
    const cfg = normalizeAiclawGroupConfig({ respondToAi: 1, mentionRequired: 0 })
    expect(cfg.respondToAi).toBe(true)
    expect(cfg.mentionRequired).toBe(false)
  })

  it('rateLimitPerMinute / dailyLimit 缺省 → 0', () => {
    const cfg = normalizeAiclawGroupConfig({})
    expect(cfg.rateLimitPerMinute).toBe(0)
    expect(cfg.dailyLimit).toBe(0)
  })
})

describe('REQ-012 #114 sortAiclawGroupConfigs：未激活群卡排前', () => {
  it('未激活（approved=false）排在已激活前面', () => {
    const sorted = sortAiclawGroupConfigs([
      { roomId: '1', approved: true, roomName: '活跃群 A' },
      { roomId: '2', approved: false, roomName: '未激活群' },
      { roomId: '3', approved: true, roomName: '活跃群 B' }
    ])
    expect(sorted.map((c) => c.roomId)).toEqual(['2', '1', '3'])
  })

  it('同活跃态内按群名升序', () => {
    const sorted = sortAiclawGroupConfigs([
      { roomId: '1', approved: true, roomName: 'Beta 群' },
      { roomId: '2', approved: true, roomName: 'Alpha 群' }
    ])
    expect(sorted.map((c) => c.roomId)).toEqual(['2', '1'])
  })

  it('群名相同按 roomId 稳定兜底', () => {
    const sorted = sortAiclawGroupConfigs([
      { roomId: 'b', approved: false, roomName: '同名' },
      { roomId: 'a', approved: false, roomName: '同名' }
    ])
    expect(sorted.map((c) => c.roomId)).toEqual(['a', 'b'])
  })

  it('approved 缺失视为未激活', () => {
    const sorted = sortAiclawGroupConfigs([
      { roomId: '1', approved: true, roomName: '活跃群' },
      { roomId: '2', approved: undefined, roomName: '缺失群' }
    ])
    expect(sorted.map((c) => c.roomId)).toEqual(['2', '1'])
  })

  it('不修改原数组', () => {
    const original = [
      { roomId: '1', approved: true },
      { roomId: '2', approved: false }
    ]
    sortAiclawGroupConfigs(original)
    expect(original.map((c) => c.roomId)).toEqual(['1', '2'])
  })
})

/**`Group <数字 room_id>` → `<群名称>(<群号>)`，
 * 例 `Dawn的群组(hula_mq8zrGyH)`（群号 = im_room_group.account，唯一人类可读群标识）。
 *
 * buildGroupCardLabel 是显示拼接 + 兜底阶梯的纯函数（取数在 chat.ts 侧 enrich，
 * 由 tester E2E 验证）。兜底阶梯（manager 拍板「最终别退回纯数字」）：
 *   名称+群号 → `名称(群号)`
 *   仅名称   → `名称`
 *   仅群号   → `群号`（account 也是人类可读 hula_xxx，优于退纯数字）
 *   都缺     → `Group <roomId>`（真·最后兜底）
 * 空白串按缺失处理（trim 后为空）。
 */
describe('#56 buildGroupCardLabel：群名(群号) + 兜底阶梯', () => {
  it('名称 + 群号 → 名称(群号)', () => {
    expect(buildGroupCardLabel('Dawn的群组', 'hula_mq8zrGyH', '171999356464128')).toBe('Dawn的群组(hula_mq8zrGyH)')
  })

  it('仅名称（群号缺）→ 名称', () => {
    expect(buildGroupCardLabel('Dawn的群组', undefined, '171999356464128')).toBe('Dawn的群组')
    expect(buildGroupCardLabel('Dawn的群组', '', '171999356464128')).toBe('Dawn的群组')
    expect(buildGroupCardLabel('Dawn的群组', '   ', '171999356464128')).toBe('Dawn的群组')
  })

  it('仅群号（名称缺）→ 群号（不退纯数字）', () => {
    expect(buildGroupCardLabel(undefined, 'hula_mq8zrGyH', '171999356464128')).toBe('hula_mq8zrGyH')
    expect(buildGroupCardLabel('  ', 'hula_mq8zrGyH', '171999356464128')).toBe('hula_mq8zrGyH')
  })

  it('名称 + 群号都缺 → Group <roomId>（最后兜底）', () => {
    expect(buildGroupCardLabel(undefined, undefined, '171999356464128')).toBe('Group 171999356464128')
    expect(buildGroupCardLabel('', '', '171999356464128')).toBe('Group 171999356464128')
    expect(buildGroupCardLabel(null, null, 171999356464128)).toBe('Group 171999356464128')
  })

  it('名称/群号两端空白被 trim（不产生 "名称( )" 这种脏串）', () => {
    expect(buildGroupCardLabel('  Dawn的群组 ', ' hula_mq8zrGyH ', '1')).toBe('Dawn的群组(hula_mq8zrGyH)')
  })
})
