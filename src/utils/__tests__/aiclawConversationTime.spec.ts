import { describe, expect, it } from 'vitest'
import { formatAiclawConversationTime, normalizeEpochMs } from '@/utils/aiclawConversationTime'

/**
 * aichatoverview#189：AI 助理对话管理列表 sendTime 格式化。
 * 后端 AiclawConversationResp.lastMessage.sendTime 为 epoch milli，
 * 但可能为 null 或被序列化成数字字符串——原实现直接 new Date(input)
 * 导致非法输入显示 NaN/NaN。
 */

describe('normalizeEpochMs（#189）', () => {
  it('数字 epoch milli 原样返回', () => {
    expect(normalizeEpochMs(1754155200000)).toBe(1754155200000)
  })

  it('数字字符串 epoch milli 转为数字', () => {
    expect(normalizeEpochMs('1754155200000')).toBe(1754155200000)
  })

  it('null / undefined / 空串 / 0 / 负数 / NaN / 非数字字符串 返回 null', () => {
    expect(normalizeEpochMs(null)).toBeNull()
    expect(normalizeEpochMs(undefined)).toBeNull()
    expect(normalizeEpochMs('')).toBeNull()
    expect(normalizeEpochMs(0)).toBeNull()
    expect(normalizeEpochMs(-5)).toBeNull()
    expect(normalizeEpochMs(NaN)).toBeNull()
    expect(normalizeEpochMs('abc')).toBeNull()
    expect(normalizeEpochMs('2026-08-02 17:00:00')).toBeNull()
  })
})

describe('formatAiclawConversationTime（#189）', () => {
  const cases: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['空串', ''],
    ['NaN', NaN],
    ['非数字字符串', 'abc']
  ]

  for (const [label, input] of cases) {
    it(`非法输入（${label}）显示占位「-」而非 NaN/NaN`, () => {
      const out = formatAiclawConversationTime(input as never, '昨天')
      expect(out).toBe('-')
      expect(out).not.toContain('NaN')
    })
  }

  it('今天的消息显示 HH:mm', () => {
    const now = new Date()
    const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 5).getTime()
    expect(formatAiclawConversationTime(ts, '昨天')).toBe('09:05')
  })

  it('字符串型 epoch 也能正常格式化', () => {
    const now = new Date()
    const ts = String(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 5).getTime())
    expect(formatAiclawConversationTime(ts, '昨天')).toBe('09:05')
  })

  it('昨天的消息显示昨天占位文案', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(12, 0, 0, 0)
    expect(formatAiclawConversationTime(yesterday.getTime(), '昨天')).toBe('昨天')
  })

  it('更早的消息显示 M/D', () => {
    const ts = new Date(2026, 0, 5, 12, 0).getTime() // 2026-01-05，早于今天/昨天
    const out = formatAiclawConversationTime(ts, '昨天')
    expect(out).toBe('1/5')
    expect(out).not.toContain('NaN')
  })
})
