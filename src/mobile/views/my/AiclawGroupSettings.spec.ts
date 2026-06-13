import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it, vi } from 'vitest'

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

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': {
      aiclaw: {
        group_settings: {
          title: '群聊设置',
          rate_limit: '频率限制',
          rate_limit_hint: '条/分钟（0=无限制）',
          daily_limit: '每日上限',
          respond_to_ai: '响应其他 AI',
          mention_required: '需要 @ 触发',
          save: '保存',
          save_success: '保存成功',
          save_failed: '保存失败',
          empty: '暂无群聊'
        }
      }
    }
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

describe('AiclawGroupSettings 群配置表单（S7 回归锁）', () => {
  it('恰好渲染 4 个保留字段：频率限制 / 每日上限 / AI互触发 / @触发', async () => {
    const wrapper = mountForm()
    await flushPromises()

    const labels = wrapper.findAll('.n-form-item-label__text').map((n) => n.text())
    expect(labels).toEqual(['频率限制', '每日上限', '响应其他 AI', '需要 @ 触发'])
    expect(labels).toHaveLength(4)
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
