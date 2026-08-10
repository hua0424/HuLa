import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import type { ThinkingState } from '@/types/thinking'

const imRequestMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: (...args: unknown[]) => imRequestMock(...args)
}))

const showThinkingRef = ref(true)
vi.mock('@/stores/setting', () => ({
  useSettingStore: vi.fn(() => ({
    // 与生产 settingStore.chat 同形：普通对象的属性读取（getter 保证测试可切换）
    chat: {
      get showThinking() {
        return showThinkingRef.value
      }
    }
  }))
}))

/** 可控 IntersectionObserver mock：实例入列，测试手动触发入视野 */
const ioInstances: {
  callback: IntersectionObserverCallback
  observe: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}[] = []
class MockIntersectionObserver {
  callback: IntersectionObserverCallback
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb
    ioInstances.push(this as never)
  }
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

const triggerIntersect = (index = 0) => {
  const inst = ioInstances[index]
  inst.callback([{ isIntersecting: true } as IntersectionObserverEntry], inst as unknown as IntersectionObserver)
}

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
          truncated: '内容过长已截断',
          view_full: '查看全文'
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

describe('InlineThinkingCard 默认展开版（REQ-015 #187）', () => {
  beforeEach(() => {
    imRequestMock.mockReset()
    showThinkingRef.value = true
    ioInstances.length = 0
  })

  it('thinking 态：渲染头像、名字、typing-status 与脉冲点，默认展示占位内容', () => {
    const wrapper = mountCard(baseThinking({ status: 'thinking' }))

    expect(wrapper.text()).toContain('TestBot')
    const status = wrapper.find('[data-testid="typing-status"]')
    expect(status.exists()).toBe(true)
    expect(status.attributes('aria-label')).toBe('回复状态')
    expect(status.text()).toContain('正在思考')
    expect(wrapper.find('.thinking-dot').exists()).toBe(true)
    expect(wrapper.text()).toContain('等待 AI 响应...')
  })

  it('complete 态：默认展开，但未入视野时不拉取全文', async () => {
    const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 2500 }))
    await flushPromises()

    expect(wrapper.text()).toContain('思考完成')
    expect(wrapper.text()).toContain('2.5s')
    // 默认展开：无需点击即注册 IntersectionObserver
    expect(ioInstances).toHaveLength(1)
    expect(ioInstances[0].observe).toHaveBeenCalled()
    // 未入视野：不发 REST
    expect(imRequestMock).not.toHaveBeenCalled()
  })

  it('complete 态：入视野自动拉取并渲染全文，内容区无内滚动', async () => {
    imRequestMock.mockResolvedValue({ content: '完整的思考过程文本', status: 1, durationMs: 2500 })
    const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 2500 }))
    await flushPromises()

    triggerIntersect()
    await flushPromises()

    expect(imRequestMock).toHaveBeenCalledTimes(1)
    expect(imRequestMock.mock.calls[0][0]).toMatchObject({
      params: { thinkingId: 'tk-1' }
    })
    expect(wrapper.text()).toContain('完整的思考过程文本')
    const content = wrapper.find('.thinking-content')
    expect(content.exists()).toBe(true)
    // 思考内容可选中复制（message-list 全局禁选，select-text 对齐气泡放开）
    expect(content.classes()).toContain('select-text')
    expect(content.classes()).not.toContain('overflow-y-auto')
    expect(content.classes()).not.toContain('max-h-120px')
    expect(wrapper.find('[data-testid="thinking-truncated-hint"]').exists()).toBe(false)
  })

  it('长文超阈值：默认只显示前段 + 「查看全文」，点击后显示全文', async () => {
    const longContent = '思'.repeat(5000)
    imRequestMock.mockResolvedValue({ content: longContent, status: 1 })
    const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 1000 }))
    await flushPromises()

    triggerIntersect()
    await flushPromises()

    const viewFull = wrapper.find('[data-testid="thinking-view-full"]')
    expect(viewFull.exists()).toBe(true)
    expect(viewFull.text()).toContain('查看全文')
    // 截断展示：前 4000 字
    expect(wrapper.find('.thinking-content').text()).toBe('思'.repeat(4000))

    await viewFull.trigger('click')
    expect(wrapper.find('.thinking-content').text()).toBe(longContent)
    expect(wrapper.find('[data-testid="thinking-view-full"]').exists()).toBe(false)
  })

  it('短内容不显示「查看全文」', async () => {
    imRequestMock.mockResolvedValue({ content: '短内容', status: 1 })
    const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 1000 }))
    await flushPromises()

    triggerIntersect()
    await flushPromises()

    expect(wrapper.find('[data-testid="thinking-view-full"]').exists()).toBe(false)
  })

  it('complete 态：status === 4 时显示服务端截断提示', async () => {
    imRequestMock.mockResolvedValue({ content: '被截断的内容', status: 4 })
    const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 1000 }))
    await flushPromises()

    triggerIntersect()
    await flushPromises()

    expect(wrapper.find('[data-testid="thinking-truncated-hint"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('内容过长已截断')
  })

  it('complete 态：REST 失败时显示错误提示，点击可重试', async () => {
    imRequestMock.mockRejectedValueOnce(new Error('network'))
    const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 1000 }))
    await flushPromises()

    triggerIntersect()
    await flushPromises()

    const error = wrapper.find('[data-testid="thinking-review-error"]')
    expect(error.exists()).toBe(true)

    imRequestMock.mockResolvedValueOnce({ content: '重试成功', status: 1 })
    await error.trigger('click')
    await flushPromises()

    expect(imRequestMock).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('重试成功')
  })

  it('#241：拉取思考详情带 showError:false——断网失败不弹裸 toast（卡片自带可重试错误行）', async () => {
    imRequestMock.mockRejectedValueOnce(new Error('network'))
    const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 1000 }))
    await flushPromises()

    triggerIntersect()
    await flushPromises()

    expect(imRequestMock).toHaveBeenCalledTimes(1)
    expect(imRequestMock.mock.calls[0][1]).toMatchObject({ showError: false })
    // 失败仍走卡片内错误行（可点击重试），不靠 toast 提示
    expect(wrapper.find('[data-testid="thinking-review-error"]').exists()).toBe(true)
  })

  it('手动折叠：默认展开，点头部收起内容，再点重新展开', async () => {
    imRequestMock.mockResolvedValue({ content: '思考内容', status: 1 })
    const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 1000 }))
    await flushPromises()
    triggerIntersect()
    await flushPromises()
    expect(wrapper.text()).toContain('思考内容')

    const header = wrapper.find('.inline-thinking-card > div')
    await header.trigger('click')
    expect(wrapper.find('.thinking-content').exists()).toBe(false)

    await header.trigger('click')
    expect(wrapper.find('.thinking-content').exists()).toBe(true)
  })

  it('thinking 态挂载后转为 complete：注册入视野拉取，入视野自动拉全文', async () => {
    imRequestMock.mockResolvedValue({ content: '实时完成的思考', status: 1, durationMs: 3000 })
    // 生产环境 ThinkingState 来自 store 的 reactive Map，这里用 reactive 模拟同形响应式
    const thinking = reactive(baseThinking({ status: 'thinking' }))
    const wrapper = mountCard(thinking)
    await flushPromises()

    // thinking 态不注册 observer、不拉取
    expect(ioInstances).toHaveLength(0)
    expect(imRequestMock).not.toHaveBeenCalled()

    // 实时流转为 complete（模拟 THINKING_END 后 store 状态变更）
    thinking.status = 'complete'
    thinking.durationMs = 3000
    await flushPromises()

    expect(ioInstances).toHaveLength(1)
    triggerIntersect()
    await flushPromises()

    expect(imRequestMock).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('实时完成的思考')
  })

  describe('"显示思考过程"开关关闭时', () => {
    beforeEach(() => {
      showThinkingRef.value = false
    })

    it('thinking 态仍保留单行状态', () => {
      const wrapper = mountCard(baseThinking({ status: 'thinking' }))

      expect(wrapper.find('[data-testid="typing-status"]').exists()).toBe(true)
    })

    it('complete 态完全隐藏', () => {
      const wrapper = mountCard(baseThinking({ status: 'complete', durationMs: 1000 }))

      expect(wrapper.find('.inline-thinking-card').exists()).toBe(false)
    })

    it('error 态完全隐藏', () => {
      const wrapper = mountCard(baseThinking({ status: 'error', errorMsg: 'oops' }))

      expect(wrapper.find('.inline-thinking-card').exists()).toBe(false)
    })
  })
})
