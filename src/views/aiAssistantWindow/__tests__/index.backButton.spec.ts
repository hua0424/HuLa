import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

/**
 * #338：AI 助理三个管理页（好友管理/群聊设置/对话管理）返回按钮不可见。
 * 根因：四个返回控件引用了 icon.js 中不存在的 `#left`（可用的是 `#left-arrow`），
 * 有空白热区但无可见图标。本 spec 锁定：无裸 `#left` 引用、返回控件可见、
 * 点击回到该助理总览且保留选中助理、记录详情/列表层级正确。
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

import AiAssistantWindow from '@/views/aiAssistantWindow/index.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': { aiclaw: aiclawZh }
  }
})

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
        teleport: true
      }
    }
  })

const listItem = (overrides: Record<string, unknown> = {}) => ({
  uid: '1001',
  name: 'TestAI',
  avatar: '',
  description: '原始简介',
  authStatus: 1,
  activeStatus: 1,
  adapterType: 'openclaw',
  publicPersona: '',
  createTime: Date.now(),
  ...overrides
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

/** 选中列表第一项，进入助理总览（detail） */
const selectFirst = async (wrapper: ReturnType<typeof mountWindow>) => {
  const vm = wrapper.vm as any
  vm.handleSelect(vm.aiclawList[0])
  await flushPromises()
}

/** 断言返回控件可见且引用存在的图标符号 */
const expectVisibleBack = (wrapper: ReturnType<typeof mountWindow>, testid: string) => {
  const back = wrapper.find(`[data-testid="${testid}"]`)
  expect(back.exists()).toBe(true)
  expect(back.isVisible()).toBe(true)
  expect(back.find('use').attributes('href')).toBe('#left-arrow')
  return back
}

describe('#338 三个管理页返回按钮', () => {
  it('模板中不再引用不存在的 #left', async () => {
    const wrapper = mountWindow()
    await flushPromises()
    expect(wrapper.html()).not.toContain('href="#left"')
  })

  it('好友管理：返回可见，点击回该助理总览并保留选中', async () => {
    const wrapper = mountWindow()
    await flushPromises()
    await selectFirst(wrapper)
    const vm = wrapper.vm as any
    vm.handleOpenFriends()
    await flushPromises()

    const selectedBefore = vm.selectedUid
    const back = expectVisibleBack(wrapper, 'aiclaw-back-friends')
    await back.trigger('click')
    expect(vm.rightView).toBe('detail')
    expect(vm.selectedUid).toBe(selectedBefore)
    expect(wrapper.find('[data-testid="aiclaw-detail-header"]').exists()).toBe(true)
  })

  it('对话管理：返回可见，点击回该助理总览并保留选中', async () => {
    const wrapper = mountWindow()
    await flushPromises()
    await selectFirst(wrapper)
    const vm = wrapper.vm as any
    vm.handleOpenConversations()
    await flushPromises()

    const selectedBefore = vm.selectedUid
    const back = expectVisibleBack(wrapper, 'aiclaw-back-conversations')
    await back.trigger('click')
    expect(vm.rightView).toBe('detail')
    expect(vm.selectedUid).toBe(selectedBefore)
    expect(wrapper.find('[data-testid="aiclaw-detail-header"]').exists()).toBe(true)
  })

  it('群聊设置：返回可见，点击回该助理总览并保留选中', async () => {
    const wrapper = mountWindow()
    await flushPromises()
    await selectFirst(wrapper)
    const vm = wrapper.vm as any
    await vm.handleOpenGroupSettings()
    await flushPromises()

    const selectedBefore = vm.selectedUid
    const back = expectVisibleBack(wrapper, 'aiclaw-back-group-settings')
    await back.trigger('click')
    expect(vm.rightView).toBe('detail')
    expect(vm.selectedUid).toBe(selectedBefore)
    expect(wrapper.find('[data-testid="aiclaw-detail-header"]').exists()).toBe(true)
  })

  it('记录详情层级：详情返回先回对话列表，再回助理总览', async () => {
    const wrapper = mountWindow()
    await flushPromises()
    await selectFirst(wrapper)
    const vm = wrapper.vm as any
    vm.handleOpenConversations()
    await flushPromises()
    vm.handleOpenConversationDetail({ friendUid: '2001', friendName: 'Friend', friendAvatar: '' })
    await flushPromises()
    expect(vm.rightView).toBe('conversationMessages')

    const toList = expectVisibleBack(wrapper, 'aiclaw-back-conversation-messages')
    await toList.trigger('click')
    expect(vm.rightView).toBe('conversations')

    const toDetail = expectVisibleBack(wrapper, 'aiclaw-back-conversations')
    await toDetail.trigger('click')
    expect(vm.rightView).toBe('detail')
    expect(vm.selectedUid).toBe('1001')
  })
})
