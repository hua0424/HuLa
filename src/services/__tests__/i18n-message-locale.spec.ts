import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import messageZh from '~/locales/zh-CN/message.json'
import messageEn from '~/locales/en/message.json'

/**
 * #151 初始同步时 "SyntaxError: 10" 风暴回归锁。
 *
 * 根因：locales/zh-CN/message.json 的 message_list.mention_tag 含字面 `@`，被
 * vue-i18n 当成 linked-message 语法（`@:key`），每次 `t('message.message_list.mention_tag')`
 * 都会让 @intlify/message-compiler 报 3 条错（Invalid linked format / Unexpected lexical
 * analysis in token / Unexpected empty linked key）。会话列表里每条 @ 会话都会调用一次
 * t()，于是 Dawn 账号 38 个 @ 会话就产生 114 条 console error。
 *
 * 修法：字面 @ 转义为 `{'@'}`（vue-i18n 标准），渲染仍输出字面 @、UI 文案不变。
 */

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'zh-CN',
    fallbackLocale: 'en',
    messages: {
      'zh-CN': { message: messageZh },
      en: { message: messageEn }
    }
  })
}

function compileErrors(): string[] {
  return errorSpy.mock.calls
    .map((args: unknown[]) => args.map(String).join(' '))
    .filter((line: string) => /compilation error|Invalid linked format/i.test(line))
}

function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') {
      keys.push(key)
    } else if (v && typeof v === 'object') {
      keys.push(...collectKeys(v as Record<string, unknown>, key))
    }
  }
  return keys
}

describe('#151 message 文案 i18n 可编译（mention_tag 字面 @ 已转义）', () => {
  it('zh-CN mention_tag 编译无错且渲染字面 @', () => {
    const i18n = makeI18n()
    const t = i18n.global.t
    expect(t('message.message_list.mention_tag')).toBe('[有人@我]')
    expect(compileErrors()).toEqual([])
  })

  it('整个 message.json（zh-CN + en）所有文案都能被真实编译器无错编译', () => {
    const i18n = makeI18n()
    for (const key of collectKeys(messageZh as Record<string, unknown>)) {
      i18n.global.t(`message.${key}`)
    }
    i18n.global.locale.value = 'en'
    for (const key of collectKeys(messageEn as Record<string, unknown>)) {
      i18n.global.t(`message.${key}`)
    }
    expect(compileErrors()).toEqual([])
  })
})
