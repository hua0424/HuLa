import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

/**
 * REQ-016 #196 F6：AI 助理管理窗主机信息展示
 * - 列表卡片 + 详情：主机名 + IP（server AiclawListResp += hostname/ip/ownerWorkspaceDir）
 * - 详情：主人私聊工作目录（ownerWorkspaceDir）
 * - 好友管理每行：与该好友私聊的工作目录（AiclawFriendResp += dmWorkspaceDir）
 * - 字段为 null/缺省（openclaw/未上报/老后端）→ 显示「-」
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

vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({ patchCachedUserInfo: vi.fn() })
}))

vi.mock('@/stores/contacts', () => ({
  useContactStore: () => ({ contactsList: [] })
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
        AiclawEditProfileForm: true,
        teleport: true
      }
    }
  })

const listItem = (overrides: Record<string, unknown> = {}) => ({
  uid: '1001',
  name: 'TestAI',
  avatar: '',
  description: '简介',
  authStatus: 1,
  activeStatus: 1,
  adapterType: 'opencode',
  publicPersona: '',
  createTime: Date.now(),
  hostname: 'gpu-node-01',
  ip: '192.168.8.83',
  ownerWorkspaceDir: '~/.aichat/opencode/workspace/1001/owner',
  ...overrides
})

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.clearAllMocks()
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

describe('REQ-016 #196 F6：主机信息展示', () => {
  it('列表卡片显示主机名与 IP', async () => {
    const wrapper = mountWindow()
    await flushPromises()

    const hostLine = wrapper.find('[data-testid="aiclaw-card-host"]')
    expect(hostLine.exists()).toBe(true)
    expect(hostLine.text()).toContain('gpu-node-01')
    expect(hostLine.text()).toContain('192.168.8.83')
  })

  it('列表卡片主机信息为 null 时显示「-」', async () => {
    imRequestSilentMock.mockResolvedValue([listItem({ hostname: null, ip: null })])
    const wrapper = mountWindow()
    await flushPromises()

    const hostLine = wrapper.find('[data-testid="aiclaw-card-host"]')
    expect(hostLine.exists()).toBe(true)
    expect(hostLine.text()).toContain('-')
    expect(hostLine.text()).not.toContain('null')
    expect(hostLine.text()).not.toContain('undefined')
  })

  it('老后端无主机信息字段（undefined）时卡片仍渲染「-」不炸', async () => {
    const legacy = listItem()
    delete (legacy as any).hostname
    delete (legacy as any).ip
    delete (legacy as any).ownerWorkspaceDir
    imRequestSilentMock.mockResolvedValue([legacy])
    const wrapper = mountWindow()
    await flushPromises()

    const hostLine = wrapper.find('[data-testid="aiclaw-card-host"]')
    expect(hostLine.exists()).toBe(true)
    expect(hostLine.text()).not.toContain('undefined')
  })

  it('详情显示主机名/IP/主人私聊工作目录', async () => {
    const wrapper = mountWindow()
    await flushPromises()
    await selectFirst(wrapper)

    const hostInfo = wrapper.find('[data-testid="aiclaw-host-info"]')
    expect(hostInfo.exists()).toBe(true)
    expect(hostInfo.text()).toContain('gpu-node-01')
    expect(hostInfo.text()).toContain('192.168.8.83')
    expect(hostInfo.text()).toContain('~/.aichat/opencode/workspace/1001/owner')
    expect(i18nCompileErrors()).toEqual([])
  })

  it('详情 ownerWorkspaceDir 为 null（openclaw）时显示「-」', async () => {
    imRequestSilentMock.mockResolvedValue([listItem({ adapterType: 'openclaw', ownerWorkspaceDir: null })])
    const wrapper = mountWindow()
    await flushPromises()
    await selectFirst(wrapper)

    const hostInfo = wrapper.find('[data-testid="aiclaw-host-info"]')
    expect(hostInfo.exists()).toBe(true)
    expect(hostInfo.text()).toContain('-')
    expect(hostInfo.text()).not.toContain('null')
  })

  it('好友管理每行显示与该好友私聊的工作目录', async () => {
    imRequestMock.mockImplementation(({ url }: { url: string }) => {
      if (url === ImUrlEnum.AICLAW_FRIENDS) {
        return Promise.resolve([
          {
            uid: '2001',
            name: '好友甲',
            avatar: '',
            account: 'acc1',
            activeStatus: 1,
            userType: 1,
            relationDesc: null,
            dmWorkspaceDir: '~/.aichat/opencode/workspace/1001/dm/2001'
          },
          {
            uid: '2002',
            name: '好友乙',
            avatar: '',
            account: 'acc2',
            activeStatus: 1,
            userType: 1,
            relationDesc: '同事',
            dmWorkspaceDir: null
          }
        ])
      }
      return Promise.resolve([])
    })

    const wrapper = mountWindow()
    await flushPromises()
    await selectFirst(wrapper)

    const vm = wrapper.vm as any
    vm.handleOpenFriends()
    await flushPromises()

    const dmDirs = wrapper.findAll('[data-testid="aiclaw-friend-dm-dir"]')
    expect(dmDirs).toHaveLength(2)
    expect(dmDirs[0].text()).toContain('~/.aichat/opencode/workspace/1001/dm/2001')
    // null → 「-」兜底，且不渲染 null/undefined 字面量
    expect(dmDirs[1].text()).toContain('-')
    expect(dmDirs[1].text()).not.toContain('null')
    expect(i18nCompileErrors()).toEqual([])
  })
})
