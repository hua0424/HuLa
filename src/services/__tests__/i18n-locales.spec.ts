import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'

/**
 * #151 / #51 通用回归锁：所有 locale JSON 文件必须能被 vue-i18n 真实编译器无错编译。
 *
 * 字面 `@` 在 vue-i18n 消息语法里表示 linked-message reference（`@:key`），已两度漏网：
 * - #51 aiclaw.json group_settings.mention_required / mention_required_hint
 * - #151 message.json message_list.mention_tag
 *
 * grep 只能证明「现在没有裸 @」，无法阻止未来新增文件/文案再次引入；
 * 因此用 import.meta.glob 把所有 locale JSON 喂给真实 createI18n + t()，
 * 只要有任何编译错误就会让 console.error 非空，测试直接失败。
 */

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

// Vite eager glob: key = "/locales/{lang}/{part}.json"，value = JSON 对象
const localeModules = import.meta.glob('~/locales/**/*.json', {
  eager: true,
  import: 'default'
}) as Record<string, Record<string, unknown>>

// 按语言聚合为 { 'zh-CN': { home: {...}, message: {...} }, en: {...} }
const messages: Record<string, Record<string, Record<string, unknown>>> = {}
for (const [path, data] of Object.entries(localeModules)) {
  const match = path.match(/\/locales\/([\w-]+)\/([\w-]+)\.json$/)
  if (!match) continue
  const [, locale, part] = match
  messages[locale] ??= {}
  messages[locale][part] = data
}

function compileErrors(): string[] {
  return errorSpy.mock.calls
    .map((args: unknown[]) => args.map(String).join(' '))
    .filter((line: string) => /compilation error|Invalid linked format|Unexpected empty linked key/i.test(line))
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

describe('#151 全部 locale 文件真实编译无错', () => {
  it('至少加载了 60 个 locale JSON 文件（确保 glob 生效）', () => {
    expect(Object.keys(localeModules).length).toBeGreaterThanOrEqual(60)
  })

  it('zh-CN mention_tag 编译无错且渲染字面 @', () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'zh-CN',
      fallbackLocale: 'en',
      messages
    })
    expect(i18n.global.t('message.message_list.mention_tag')).toBe('[有人@我]')
    expect(compileErrors()).toEqual([])
  })

  it('所有 locale 文件所有文案被真实编译器调用后无 console.error', () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'zh-CN',
      fallbackLocale: 'en',
      messages
    })

    for (const locale of Object.keys(messages)) {
      i18n.global.locale.value = locale
      const parts = messages[locale]
      for (const [part, fragment] of Object.entries(parts)) {
        for (const key of collectKeys(fragment)) {
          i18n.global.t(`${part}.${key}`)
        }
      }
    }

    expect(compileErrors()).toEqual([])
  })
})
