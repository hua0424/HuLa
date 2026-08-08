import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

/**
 * REQ-015 #186：AI 助理管理窗
 * - F1：编辑资料入口 + 保存后刷新管理窗列表与本地缓存（contactStore/groupStore）
 * - F3：对话管理后端返回数组（不再按 {list: []} 解析）+ 好友/对话空列表「不含主人」说明文案
 * - F4：列表卡片 + 详情页头部显示 adapterType 原始值徽标（空值不显示）
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
  // #210：群设置 tab 的成员签名 watch 依赖该方法
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
  description: '原始简介',
  authStatus: 1,
  activeStatus: 1,
  adapterType: 'opencode',
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

function i18nCompileErrors(): string[] {
  return errorSpy.mock.calls
    .map((args: unknown[]) => args.map(String).join(' '))
    .filter((line: string) => /compilation error|Invalid linked format/i.test(line))
}

/** 选中列表第一项并进入详情视图 */
const selectFirst = async (wrapper: ReturnType<typeof mountWindow>) => {
  const vm = wrapper.vm as any
  vm.handleSelect(vm.aiclawList[0])
  await flushPromises()
}

describe('REQ-015 #186 F4：agent 类型徽标', () => {
  it('列表卡片直显 adapterType 原始值', async () => {
    imRequestSilentMock.mockResolvedValue([listItem(), listItem({ uid: '1002', name: 'Second', adapterType: 'cc' })])
    const wrapper = mountWindow()
    await flushPromises()

    const badges = wrapper.findAll('[data-testid="aiclaw-adapter-badge"]')
    expect(badges).toHaveLength(2)
    expect(badges[0].text()).toBe('opencode')
    expect(badges[1].text()).toBe('cc')
  })

  it('adapterType 为空时不显示徽标', async () => {
    imRequestSilentMock.mockResolvedValue([listItem({ adapterType: '' })])
    const wrapper = mountWindow()
    await flushPromises()

    expect(wrapper.find('[data-testid="aiclaw-adapter-badge"]').exists()).toBe(false)
  })

  it('详情页头部显示 adapterType 徽标', async () => {
    const wrapper = mountWindow()
    await flushPromises()
    await selectFirst(wrapper)

    const header = wrapper.find('[data-testid="aiclaw-detail-header"]')
    expect(header.exists()).toBe(true)
    expect(header.find('[data-testid="aiclaw-adapter-badge"]').text()).toBe('opencode')
  })
})

describe('REQ-015 #186 F1：编辑资料', () => {
  it('详情页有编辑资料入口，点击后弹窗携带当前名称/简介', async () => {
    const wrapper = mountWindow()
    await flushPromises()
    await selectFirst(wrapper)

    const entry = wrapper.find('[data-testid="aiclaw-edit-profile-button"]')
    expect(entry.exists()).toBe(true)
    await entry.trigger('click')
    await flushPromises()

    const form = wrapper.findComponent(AiclawEditProfileFormStub)
    expect(form.props('visible')).toBe(true)
    expect(form.props('uid')).toBe('1001')
    expect(form.props('name')).toBe('TestAI')
    expect(form.props('description')).toBe('原始简介')
  })

  it('saved 后管理窗列表即时更新名称，并刷新 contactStore/groupStore 缓存', async () => {
    contactStoreMocks.contactsList = [{ uid: '1001', remark: '' }]
    const wrapper = mountWindow()
    await flushPromises()
    await selectFirst(wrapper)

    await wrapper.find('[data-testid="aiclaw-edit-profile-button"]').trigger('click')
    await flushPromises()

    const form = wrapper.findComponent(AiclawEditProfileFormStub)
    form.vm.$emit('saved', { name: '改名后', description: '新简介' })
    await flushPromises()

    const vm = wrapper.vm as any
    const item = vm.aiclawList.find((a: any) => a.uid === '1001')
    expect(item.name).toBe('改名后')
    expect(item.description).toBe('新简介')
    expect(wrapper.text()).toContain('改名后')
    expect(groupStoreMocks.patchCachedUserInfo).toHaveBeenCalledWith('1001', { name: '改名后' })
  })
})

describe('REQ-015 #186 F3：对话管理解析 + 空列表文案', () => {
  it('后端返回数组形响应时正确渲染对话列表', async () => {
    imRequestMock.mockImplementation(({ url }: { url: string }) => {
      if (url === ImUrlEnum.AICLAW_CONVERSATIONS) {
        return Promise.resolve([
          {
            friendUid: '2001',
            friendName: '好友甲',
            friendAvatar: '',
            lastMessage: { content: '你好', sendTime: Date.now(), type: 1 },
            roomId: 'room-1'
          }
        ])
      }
      return Promise.resolve([])
    })

    const wrapper = mountWindow()
    await flushPromises()
    await selectFirst(wrapper)

    const vm = wrapper.vm as any
    vm.handleOpenConversations()
    await flushPromises()

    expect(wrapper.text()).toContain('好友甲')
    expect(wrapper.text()).toContain('你好')
  })

  it('对话管理空列表显示「不含主人」说明文案', async () => {
    imRequestMock.mockResolvedValue([])
    const wrapper = mountWindow()
    await flushPromises()
    await selectFirst(wrapper)

    const vm = wrapper.vm as any
    vm.handleOpenConversations()
    await flushPromises()

    expect(wrapper.text()).toContain(aiclawZh.conversations.empty)
    expect(wrapper.text()).toContain(aiclawZh.owner_excluded_hint)
    expect(i18nCompileErrors()).toEqual([])
  })

  it('好友管理空列表显示「不含主人」说明文案', async () => {
    imRequestMock.mockResolvedValue([])
    const wrapper = mountWindow()
    await flushPromises()
    await selectFirst(wrapper)

    const vm = wrapper.vm as any
    vm.handleOpenFriends()
    await flushPromises()

    expect(wrapper.text()).toContain(aiclawZh.friends.empty)
    expect(wrapper.text()).toContain(aiclawZh.owner_excluded_hint)
  })
})
