import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingState } from '@/types/thinking'

// REST 包装层 mock（回顾态按需拉取思考全文）
const imRequestMock = vi.fn()
vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: (...args: unknown[]) => imRequestMock(...args)
}))

import ThinkingCard from './ThinkingCard.vue'

// 仅注入测试用到的 aiclaw.thinking 文案，t() 产出真实字符串供断言
const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': {
      aiclaw: {
        thinking: {
          status: {
            thinking: '正在思考...',
            complete: '思考完成 ({duration})',
            error: '思考出错'
          },
          waiting: '等待 AI 响应...',
          review: '查看思考内容',
          review_loading: '加载中...',
          review_error: '加载思考内容失败',
          truncated: '内容过长已截断'
        }
      }
    }
  }
})

const baseThinking = (overrides: Partial<ThinkingState> = {}): ThinkingState => ({
  thinkingId: 'tk-1',
  aiclawId: 1001,
  aiclawName: 'TestBot',
  aiclawAvatar: '',
  roomId: 'room-1',
  status: 'thinking',
  startTime: Date.now(),
  collapsed: false,
  ...overrides
})

const mountCard = (thinking: ThinkingState, readonly = false) =>
  mount(ThinkingCard, {
    props: { thinking, readonly },
    global: {
      plugins: [i18n],
      stubs: {
        // Naive UI 头像在测试环境用占位 stub，避免依赖完整组件
        'n-avatar': true
      }
    }
  })

describe('ThinkingCard 状态版（S7）', () => {
  beforeEach(() => {
    imRequestMock.mockReset()
  })

  it('thinking 态：渲染思考徽章 + 脉冲点 + typing-status，且无流式光标', () => {
    const wrapper = mountCard(baseThinking({ status: 'thinking' }))

    const status = wrapper.find('[data-testid="typing-status"]')
    expect(status.exists()).toBe(true)
    expect(status.attributes('aria-label')).toBe('回复状态')
    expect(status.text()).toContain('正在思考')
    // 脉冲点
    expect(wrapper.find('.thinking-dot').exists()).toBe(true)
    // 流式光标已移除
    expect(wrapper.find('.streaming-cursor').exists()).toBe(false)
  })

  it('complete 态：渲染「已完成（耗时 Xs）」文本，无 typing-status，无流式光标', () => {
    const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 2500, collapsed: false }))

    expect(wrapper.text()).toContain('思考完成')
    expect(wrapper.text()).toContain('2.5s')
    expect(wrapper.find('[data-testid="typing-status"]').exists()).toBe(false)
    expect(wrapper.find('.streaming-cursor').exists()).toBe(false)
  })

  it('complete 态：提供回顾入口，点击后调用 REST 并渲染返回内容', async () => {
    imRequestMock.mockResolvedValue({ content: '完整的思考过程文本', status: 1, durationMs: 2500 })
    const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 2500, collapsed: false }))

    const reviewBtn = wrapper.find('[data-testid="thinking-review-button"]')
    expect(reviewBtn.exists()).toBe(true)

    await reviewBtn.trigger('click')
    await flushPromises()

    // 以 thinkingId 调用 REST 包装层
    expect(imRequestMock).toHaveBeenCalledTimes(1)
    expect(imRequestMock.mock.calls[0][0]).toMatchObject({
      params: { thinkingId: 'tk-1' }
    })
    expect(wrapper.text()).toContain('完整的思考过程文本')
    // 非截断不显示截断提示
    expect(wrapper.find('[data-testid="thinking-truncated-hint"]').exists()).toBe(false)
  })

  it('complete 态：status === 4 时显示截断提示', async () => {
    imRequestMock.mockResolvedValue({ content: '被截断的内容', status: 4 })
    const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 1000, collapsed: false }))

    await wrapper.find('[data-testid="thinking-review-button"]').trigger('click')
    await flushPromises()

    const hint = wrapper.find('[data-testid="thinking-truncated-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('内容过长已截断')
  })

  it('complete 态：REST 失败时显示错误提示', async () => {
    imRequestMock.mockRejectedValue(new Error('network'))
    const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 1000, collapsed: false }))

    await wrapper.find('[data-testid="thinking-review-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="thinking-review-error"]').exists()).toBe(true)
  })
})
