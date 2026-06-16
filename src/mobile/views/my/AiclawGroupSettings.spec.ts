import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

// useRoute stub：提供 uid 路由参数
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { uid: '1001' } })
}))

// chatStore stub：返回一条群配置，覆盖全部 4 个保留字段
const groupConfig = {
  roomId: 'room-1',
  roomName: '测试群',
  rateLimitPerMinute: 5,
  dailyLimit: 100,
  respondToAi: false,
  mentionRequired: true
}
vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    loadAiclawGroupConfigs: vi.fn().mockResolvedValue(undefined),
    getAiclawGroupConfigList: vi.fn().mockReturnValue([groupConfig]),
    saveAiclawGroupConfig: vi.fn().mockResolvedValue(undefined)
  })
}))

import AiclawGroupSettings from './AiclawGroupSettings.vue'

// #51 关键：用**真实 locale JSON** 喂 i18n（旧版内联 mock 文案绕过真实 JSON → 假绿，
// 漏掉了 group_settings.mention_required 里字面 @ 被当 linked-message 语法的 bug）。
const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': { aiclaw: aiclawZh }
  }
})

// Naive UI 组件经 unplugin 全局注册（见 vitest.config.ts），实际渲染真实组件，
// 表单项 label 渲染在 .n-form-item-label__text 中，按此断言渲染了哪些字段。
const mountForm = () =>
  mount(AiclawGroupSettings, {
    global: {
      plugins: [i18n],
      stubs: {
        AutoFixHeightPage: { template: '<div><slot name="header" /><slot name="container" /></div>' },
        HeaderBar: true
      }
    }
  })

// #51 判别守卫：vitest（happy-dom）里 vue-i18n 对非法 linked 格式不抛、只把
// 编译错误打到 console.error 并回退原串——所以仅靠 label 文本断言会假绿（裸 @ 时
// 标签照样渲染出原串）。捕获 console.error 才能真正区分裸 @ 与已转义 @。
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

function i18nCompileErrors(): string[] {
  return errorSpy.mock.calls
    .map((args) => args.map(String).join(' '))
    .filter((line) => /compilation error|Invalid linked format/i.test(line))
}

describe('AiclawGroupSettings 群配置表单（S7 回归锁 + #51 i18n @ 转义守卫）', () => {
  it('恰好渲染 4 个保留字段：频率限制 / 每日上限 / AI互触发 / @触发', async () => {
    const wrapper = mountForm()
    await flushPromises()

    const labels = wrapper.findAll('.n-form-item-label__text').map((n) => n.text())
    expect(labels).toEqual(['频率限制', '每日上限', '响应其他 AI', '需要 @ 触发'])
    expect(labels).toHaveLength(4)
  })

  it('#51：表单文案在真实 locale JSON 下无 i18n 编译错误（裸 @ 会让此断言 RED）', async () => {
    const wrapper = mountForm()
    await flushPromises()
    expect(i18nCompileErrors()).toEqual([])
    // 表单子树真实渲染（未因 t() 抛错降级为 comment）：4 个 form-item 都在
    expect(wrapper.findAll('.n-form-item-label__text')).toHaveLength(4)
  })

  it('不存在任何 short-reply 字段（回归锁）', async () => {
    const wrapper = mountForm()
    await flushPromises()

    const html = wrapper.html().toLowerCase()
    expect(html).not.toContain('shortreply')
    expect(html).not.toContain('short_reply')
    expect(html).not.toContain('short-reply')
    expect(wrapper.text()).not.toContain('简短回复')
  })
})
