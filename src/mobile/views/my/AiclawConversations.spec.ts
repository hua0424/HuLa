import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

/**
 * REQ-015 #186 F3（移动端）：对话记录后端返回数组形响应，
 * 不再按 {list: []} 解析；空列表显示「不含主人」说明文案。
 * 移动端本轮不做真机测试，但解析修复与桌面同改。
 */

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { uid: '1001' } }),
  useRouter: () => ({ push: vi.fn() })
}))

const imRequestMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: (...args: unknown[]) => imRequestMock(...args)
}))

import AiclawConversations from '@/mobile/views/my/AiclawConversations.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': { aiclaw: aiclawZh } }
})

const mountPage = () =>
  mount(AiclawConversations, {
    global: {
      plugins: [i18n],
      stubs: {
        AutoFixHeightPage: {
          template: '<div><slot name="container" /></div>'
        },
        HeaderBar: true
      }
    }
  })

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  imRequestMock.mockReset()
})

afterEach(() => {
  errorSpy.mockRestore()
})

function i18nCompileErrors(): string[] {
  return errorSpy.mock.calls
    .map((args: unknown[]) => args.map(String).join(' '))
    .filter((line: string) => /compilation error|Invalid linked format/i.test(line))
}

describe('AiclawConversations（移动端，REQ-015 #186 F3）', () => {
  it('数组形响应正确渲染对话列表', async () => {
    imRequestMock.mockResolvedValue([
      {
        friendUid: '2001',
        friendName: '好友甲',
        friendAvatar: '',
        lastMessage: { content: '你好', sendTime: Date.now(), type: 1 },
        roomId: 'room-1'
      }
    ])

    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('好友甲')
    expect(wrapper.text()).toContain('你好')
  })

  it('空列表显示「不含主人」说明文案', async () => {
    imRequestMock.mockResolvedValue([])

    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain(aiclawZh.conversations.empty)
    expect(wrapper.text()).toContain(aiclawZh.owner_excluded_hint)
    expect(i18nCompileErrors()).toEqual([])
  })
})
