import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'
import aiclawEn from '~/locales/en/aiclaw.json'

/**
 * #51 桌面 aiAssistant 群配置表单整体渲染成 comment 占位的回归锁。
 *
 * 根因：locales/{zh-CN,en}/aiclaw.json 的 group_settings.mention_required /
 * mention_required_hint 含字面 `@`，被 vue-i18n 当成 linked-message 语法
 * （`@:key`），编译期报 "Invalid linked format"。在浏览器运行时这会让 t() 抛错
 * → n-form-item :label 渲染抛 → Vue 把整个 n-form 子树降级为 comment 占位
 * （save 按钮无 @ 故照常渲染，这解释了「只这个表单挂、其它字段全无」）。
 *
 * 修法：字面 @ 转义为 `{'@'}`（vue-i18n 标准），渲染仍输出字面 @、UI 文案不变。
 *
 * 判别信号说明：在 vitest（happy-dom）里 vue-i18n 对非法 linked 格式**不抛、只把
 * 编译错误打到 console.error 并回退原串**（与浏览器抛错降级不同）。因此仅断言
 * `not.toThrow()` 或比对返回值都会假绿——必须断言「编译期无 console.error」才能
 * 真正区分裸 @ 与已转义 @。这同时补上 mobile AiclawGroupSettings.spec 旧版用内联
 * mock 文案（绕过真实 JSON）造成的假绿。
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
      'zh-CN': { aiclaw: aiclawZh },
      en: { aiclaw: aiclawEn }
    }
  })
}

// 收集编译诊断：vue-i18n 把 "Message compilation error: ..." 打到 console.error。
function compileErrors(): string[] {
  return errorSpy.mock.calls
    .map((args) => args.map(String).join(' '))
    .filter((line) => /compilation error|Invalid linked format/i.test(line))
}

// 递归遍历 locale 对象里的每个字符串叶子，产出其点路径 key。
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

describe('#51 aiclaw 群配置 i18n 文案可编译（字面 @ 已转义）', () => {
  it('zh-CN mention_required / hint 编译无错且渲染字面 @', () => {
    const i18n = makeI18n()
    const t = i18n.global.t
    expect(t('aiclaw.group_settings.mention_required')).toBe('需要 @ 触发')
    expect(t('aiclaw.group_settings.mention_required_hint')).toBe('开启后 AI 仅在被 @ 时回复')
    expect(compileErrors()).toEqual([])
  })

  it('en mention_required / hint 编译无错且渲染字面 @', () => {
    const i18n = makeI18n()
    i18n.global.locale.value = 'en'
    const t = i18n.global.t
    expect(t('aiclaw.group_settings.mention_required')).toBe('Require @ mention')
    expect(t('aiclaw.group_settings.mention_required_hint')).toBe('AI only replies when @mentioned')
    expect(compileErrors()).toEqual([])
  })

  it('整个 aiclaw.json（zh-CN + en）所有文案都能被真实编译器无错编译（防任何裸 @ 复发）', () => {
    const i18n = makeI18n()
    for (const key of collectKeys(aiclawZh as Record<string, unknown>)) {
      i18n.global.t(`aiclaw.${key}`)
    }
    i18n.global.locale.value = 'en'
    for (const key of collectKeys(aiclawEn as Record<string, unknown>)) {
      i18n.global.t(`aiclaw.${key}`)
    }
    expect(compileErrors()).toEqual([])
  })
})
