import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

/**
 * aichatoverview#344：主人管理读取私聊历史的错误状态与迟到 guard。
 * - 失败显错可重试，成功空结果才显示空历史（story 4/5）
 * - 切换记录/重试后仅接受当前房间结果（story 9）
 */

vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: {},
    query: {}
  })
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {})
}))

vi.mock('@/router', () => ({
  default: {
    push: vi.fn(),
    replace: vi.fn(),
    currentRoute: { value: {} }
  }
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getCurrent: () => ({ label: 'aiAssistant', show: vi.fn() }) },
  getCurrentWebviewWindow: () => ({ label: 'aiAssistant', show: vi.fn() })
}))

vi.mock('@/services/fingerprint', () => ({
  getFingerprint: vi.fn().mockResolvedValue('mock-fingerprint')
}))

vi.mock('colorthief', () => ({
  default: class {
    getColor() {
      return Promise.resolve([0, 0, 0])
    }
  }
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    loadAiclawGroupConfigs: vi.fn().mockResolvedValue(undefined),
    loadAiclawGroupConfig: vi.fn().mockResolvedValue(undefined),
    getAiclawGroupConfigList: vi.fn().mockReturnValue([]),
    saveAiclawGroupConfig: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/stores/aiclaw', () => ({
  useAiclawStore: () => ({
    invalidate: vi.fn()
  })
}))

const groupStoreMocks = vi.hoisted(() => ({
  patchCachedUserInfo: vi.fn(),
  getRoomIdsByUid: () => [] as string[]
}))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => groupStoreMocks
}))

const contactStoreMocks = vi.hoisted(() => ({
  contactsList: [] as any[]
}))
vi.mock('@/stores/contacts', () => ({
  useContactStore: () => contactStoreMocks
}))

const imRequestMock = vi.hoisted(() => vi.fn())
const imRequestSilentMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: (...args: unknown[]) => imRequestMock(...args),
  imRequestSilent: (...args: unknown[]) => imRequestSilentMock(...args)
}))

import { ImUrlEnum } from '@/enums'
import AiAssistantWindow from '@/views/aiAssistantWindow/index.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': { aiclaw: aiclawZh }
  }
})

const AiclawEditProfileFormStub = {
  name: 'AiclawEditProfileForm',
  template: '<div data-testid="aiclaw-edit-profile-form" />',
  props: ['visible', 'uid', 'name', 'description'],
  emits: ['saved', 'update:visible']
}

const mountWindow = () =>
  mount(AiAssistantWindow, {
    global: {
      plugins: [i18n],
      stubs: {
        ActionBar: true,
        AiclawCreateForm: true,
        AiclawTokenDialog: true,
        AiclawDeleteConfirmDialog: true,
        AiclawGroupConfigForm: true,
        AiclawAddToGroupModal: true,
        AiclawEditProfileForm: AiclawEditProfileFormStub,
        teleport: true
      }
    }
  })

const listItem = (overrides: Record<string, unknown> = {}) => ({
  uid: '1001',
  name: 'TestAI',
  avatar: '',
  description: '',
  authStatus: 1,
  activeStatus: 1,
  adapterType: 'opencode',
  publicPersona: '',
  createTime: Date.now(),
  ...overrides
})

const conversationItem = (overrides: Record<string, unknown> = {}) => ({
  friendUid: '2001',
  friendName: '好友甲',
  friendAvatar: '',
  lastMessage: { content: '你好', sendTime: Date.now(), type: 1 },
  roomId: 'room-1',
  ...overrides
})

const messageItem = (content: string, id = 'm1') => ({
  fromUser: { uid: '2001' },
  message: { id, roomId: 'room-1', sendTime: Date.now(), type: 1, body: { content }, messageMarks: {} }
})

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.clearAllMocks()
  contactStoreMocks.contactsList = []
  imRequestSilentMock.mockResolvedValue([listItem()])
  imRequestMock.mockResolvedValue([])
  ;(globalThis as any).window.$message = { success: vi.fn(), error: vi.fn() }
})

afterEach(() => {
  errorSpy.mockRestore()
})

function i18nCompileErrors(): string[] {
  return errorSpy.mock.calls
    .map((args: unknown[]) => args.map(String).join(' '))
    .filter((line: string) => /compilation error|Invalid linked format/i.test(line))
}

/** 选中第一项并打开对话列表 */
const openConversations = async (wrapper: ReturnType<typeof mountWindow>) => {
  await flushPromises()
  const vm = wrapper.vm as any
  vm.handleSelect(vm.aiclawList[0])
  await flushPromises()
  vm.handleOpenConversations()
  await flushPromises()
}

describe('#344 消息读取：失败显错可重试', () => {
  it('接口失败时显示加载失败与重试，不显示空历史', async () => {
    imRequestMock.mockImplementation(({ url }: { url: string }) => {
      if (url === ImUrlEnum.AICLAW_CONVERSATIONS) return Promise.resolve([conversationItem()])
      if (url === ImUrlEnum.AICLAW_CONVERSATION_MESSAGES) return Promise.reject(new Error('服务器异常'))
      return Promise.resolve([])
    })
    const wrapper = mountWindow()
    await openConversations(wrapper)

    const vm = wrapper.vm as any
    vm.handleOpenConversationDetail(vm.conversationList[0])
    await flushPromises()

    expect(wrapper.find('[data-testid="aiclaw-messages-error"]').exists()).toBe(true)
    expect(wrapper.text()).toContain(aiclawZh.conversations.load_failed)
    expect(wrapper.find('[data-testid="aiclaw-messages-retry"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain(aiclawZh.conversations.empty)
    expect(i18nCompileErrors()).toEqual([])
  })

  it('重试后成功即渲染消息并清除错误态', async () => {
    let fail = true
    imRequestMock.mockImplementation(({ url }: { url: string }) => {
      if (url === ImUrlEnum.AICLAW_CONVERSATIONS) return Promise.resolve([conversationItem()])
      if (url === ImUrlEnum.AICLAW_CONVERSATION_MESSAGES) {
        if (fail) return Promise.reject(new Error('服务器异常'))
        return Promise.resolve({ list: [messageItem('真实历史')], cursor: '', isLast: true })
      }
      return Promise.resolve([])
    })
    const wrapper = mountWindow()
    await openConversations(wrapper)

    const vm = wrapper.vm as any
    vm.handleOpenConversationDetail(vm.conversationList[0])
    await flushPromises()
    expect(wrapper.find('[data-testid="aiclaw-messages-error"]').exists()).toBe(true)

    fail = false
    await wrapper.find('[data-testid="aiclaw-messages-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="aiclaw-messages-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('真实历史')
    expect(wrapper.text()).not.toContain(aiclawZh.conversations.empty)
  })

  it('成功空结果显示空历史，不显示错误与重试', async () => {
    imRequestMock.mockImplementation(({ url }: { url: string }) => {
      if (url === ImUrlEnum.AICLAW_CONVERSATIONS) return Promise.resolve([conversationItem()])
      if (url === ImUrlEnum.AICLAW_CONVERSATION_MESSAGES) {
        return Promise.resolve({ list: [], cursor: '', isLast: true })
      }
      return Promise.resolve([])
    })
    const wrapper = mountWindow()
    await openConversations(wrapper)

    const vm = wrapper.vm as any
    vm.handleOpenConversationDetail(vm.conversationList[0])
    await flushPromises()

    expect(wrapper.text()).toContain(aiclawZh.conversations.empty)
    expect(wrapper.find('[data-testid="aiclaw-messages-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="aiclaw-messages-retry"]').exists()).toBe(false)
  })
})

describe('#344 消息读取：迟到响应不串房间', () => {
  it('先开 A（pending）再开 B，A 的迟到响应不覆盖 B', async () => {
    let resolveA!: (v: unknown) => void
    imRequestMock.mockImplementation(({ url, params }: { url: string; params?: any }) => {
      if (url === ImUrlEnum.AICLAW_CONVERSATIONS) {
        return Promise.resolve([
          conversationItem(),
          conversationItem({ friendUid: '2002', friendName: '好友乙', roomId: 'room-2' })
        ])
      }
      if (url === ImUrlEnum.AICLAW_CONVERSATION_MESSAGES) {
        if (params?.friendUid === '2001') return new Promise((r) => (resolveA = r))
        return Promise.resolve({ list: [messageItem('B 的消息', 'mb')], cursor: '', isLast: true })
      }
      return Promise.resolve([])
    })
    const wrapper = mountWindow()
    await openConversations(wrapper)

    const vm = wrapper.vm as any
    // 打开 A，好友甲请求 pending
    vm.handleOpenConversationDetail(vm.conversationList[0])
    await flushPromises()
    // 切换到 B，好友乙立即成功
    vm.handleOpenConversationDetail(vm.conversationList[1])
    await flushPromises()
    expect(wrapper.text()).toContain('B 的消息')
    // A 的迟到响应到达，必须被丢弃
    resolveA({ list: [messageItem('A 的旧消息', 'ma')], cursor: '', isLast: true })
    await flushPromises()

    expect(wrapper.text()).toContain('B 的消息')
    expect(wrapper.text()).not.toContain('A 的旧消息')
  })
})

describe('#344 对话列表：失败显错可重试', () => {
  it('列表接口失败时显示加载失败与重试，不显示空历史', async () => {
    imRequestMock.mockImplementation(({ url }: { url: string }) => {
      if (url === ImUrlEnum.AICLAW_CONVERSATIONS) return Promise.reject(new Error('服务器异常'))
      return Promise.resolve([])
    })
    const wrapper = mountWindow()
    await openConversations(wrapper)

    expect(wrapper.find('[data-testid="aiclaw-conversations-error"]').exists()).toBe(true)
    expect(wrapper.text()).toContain(aiclawZh.conversations.load_failed)
    expect(wrapper.find('[data-testid="aiclaw-conversations-retry"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain(aiclawZh.conversations.empty)
    expect(i18nCompileErrors()).toEqual([])
  })

  it('列表重试后成功即渲染并清除错误态', async () => {
    let fail = true
    imRequestMock.mockImplementation(({ url }: { url: string }) => {
      if (url === ImUrlEnum.AICLAW_CONVERSATIONS) {
        if (fail) return Promise.reject(new Error('服务器异常'))
        return Promise.resolve([conversationItem()])
      }
      return Promise.resolve([])
    })
    const wrapper = mountWindow()
    await openConversations(wrapper)
    expect(wrapper.find('[data-testid="aiclaw-conversations-error"]').exists()).toBe(true)

    fail = false
    await wrapper.find('[data-testid="aiclaw-conversations-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="aiclaw-conversations-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('好友甲')
  })
})
