import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import type { ThinkingState } from '@/types/thinking'

const imRequestMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: (...args: unknown[]) => imRequestMock(...args)
}))

const showThinkingRef = ref(true)
vi.mock('@/stores/setting', () => ({
  useSettingStore: vi.fn(() => ({
    chat: computed(() => ({ showThinking: showThinkingRef.value }))
  }))
}))

import InlineThinkingCard from './InlineThinkingCard.vue'

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

const mountCard = (thinking: ThinkingState) =>
  mount(InlineThinkingCard, {
    props: { thinking },
    global: {
      plugins: [i18n],
      stubs: {
        'n-avatar': true
      }
    }
  })

const expandCard = async (wrapper: ReturnType<typeof mountCard>) => {
  const header = wrapper.find('.inline-thinking-card > div')
  if (header.exists()) {
    await header.trigger('click')
  }
}

describe('InlineThinkingCard 状态版（REQ-014）', () => {
  beforeEach(() => {
    imRequestMock.mockReset()
    showThinkingRef.value = true
  })

  it('thinking 态：渲染头像、名字、typing-status 与脉冲点', () => {
    const wrapper = mountCard(baseThinking({ status: 'thinking' }))

    expect(wrapper.text()).toContain('TestBot')
    const status = wrapper.find('[data-testid="typing-status"]')
    expect(status.exists()).toBe(true)
    expect(status.attributes('aria-label')).toBe('回复状态')
    expect(status.text()).toContain('正在思考')
    expect(wrapper.find('.thinking-dot').exists()).toBe(true)
  })

  it('complete 态：显示耗时，展开后提供回顾入口', async () => {
    const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 2500 }))

    expect(wrapper.text()).toContain('思考完成')
    expect(wrapper.text()).toContain('2.5s')
    expect(wrapper.find('[data-testid="typing-status"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="thinking-review-button"]').exists()).toBe(false)

    await expandCard(wrapper)
    expect(wrapper.find('[data-testid="thinking-review-button"]').exists()).toBe(true)
  })

  it('complete 态：展开并点击回顾按钮调用 REST 并渲染返回内容', async () => {
    imRequestMock.mockResolvedValue({ content: '完整的思考过程文本', status: 1, durationMs: 2500 })
    const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 2500 }))

    await expandCard(wrapper)
    await wrapper.find('[data-testid="thinking-review-button"]').trigger('click')
    await flushPromises()

    expect(imRequestMock).toHaveBeenCalledTimes(1)
    expect(imRequestMock.mock.calls[0][0]).toMatchObject({
      params: { thinkingId: 'tk-1' }
    })
    expect(wrapper.text()).toContain('完整的思考过程文本')
    expect(wrapper.find('[data-testid="thinking-truncated-hint"]').exists()).toBe(false)
  })

  it('complete 态：status === 4 时显示截断提示', async () => {
    imRequestMock.mockResolvedValue({ content: '被截断的内容', status: 4 })
    const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 1000 }))

    await expandCard(wrapper)
    await wrapper.find('[data-testid="thinking-review-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="thinking-truncated-hint"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('内容过长已截断')
  })

  it('complete 态：REST 失败时显示错误提示', async () => {
    imRequestMock.mockRejectedValue(new Error('network'))
    const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 1000 }))

    await expandCard(wrapper)
    await wrapper.find('[data-testid="thinking-review-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="thinking-review-error"]').exists()).toBe(true)
  })

  describe('"显示思考过程"开关关闭时', () => {
    beforeEach(() => {
      showThinkingRef.value = false
    })

    it('thinking 态仍保留单行状态', () => {
      const wrapper = mountCard(baseThinking({ status: 'thinking' }))

      expect(wrapper.find('[data-testid="typing-status"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="thinking-review-button"]').exists()).toBe(false)
    })

    it('complete 态完全隐藏', () => {
      const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 1000 }))

      expect(wrapper.find('[data-testid="inline-thinking-card"]').exists()).toBe(false)
    })

    it('error 态完全隐藏', () => {
      const wrapper = mountCard(baseThinking({ status: 'error', errorMsg: 'oops' }))

      expect(wrapper.find('[data-testid="inline-thinking-card"]').exists()).toBe(false)
    })
  })
})
