import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

/**
 * REQ-018 #224：管理面板保存 codex 系 AI 人设时提示「新会话生效」
 * - adapterType=codex：保存成功 toast 使用 codex 变体文案（提示新会话生效，当前会话保持旧人设）
 * - 其余三家（openclaw/opencode/hermes）：保持原文案，不提示
 * - adapterType 大小写不敏感（后端原值直显，防御 CODEX/Codex）
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
  // #210：群设置 tab 的成员签名 watch 依赖 getRoomIdsByUid
  useGroupStore: () => ({ patchCachedUserInfo: vi.fn(), getRoomIdsByUid: () => [] })
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
  adapterType: 'codex',
  publicPersona: '旧人设',
  createTime: Date.now(),
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

/** 选中列表第一项进入详情，修改人设并触发保存 */
const savePersona = async (wrapper: ReturnType<typeof mountWindow>) => {
  const vm = wrapper.vm as any
  vm.handleSelect(vm.aiclawList[0])
  await flushPromises()
  vm.personaText = '新人设'
  await flushPromises()
  await vm.handleSavePersona()
  await flushPromises()
}

const successText = () => ((globalThis as any).window.$message.success as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]

describe('REQ-018 #224：codex 人设保存提示「新会话生效」', () => {
  it('adapterType=codex：保存成功 toast 提示新会话生效', async () => {
    imRequestSilentMock.mockResolvedValue([listItem({ adapterType: 'codex' })])
    const wrapper = mountWindow()
    await flushPromises()
    await savePersona(wrapper)

    expect((globalThis as any).window.$message.success).toHaveBeenCalledTimes(1)
    expect(successText()).toBe(i18n.global.t('aiclaw.detail.persona_save_success_codex'))
    expect(successText()).toContain('新会话')
    expect(i18nCompileErrors()).toEqual([])
  })

  it('adapterType 大小写不敏感：CODEX 也提示', async () => {
    imRequestSilentMock.mockResolvedValue([listItem({ adapterType: 'CODEX' })])
    const wrapper = mountWindow()
    await flushPromises()
    await savePersona(wrapper)

    expect(successText()).toBe(i18n.global.t('aiclaw.detail.persona_save_success_codex'))
  })

  it('adapterType=opencode：保持原文案不提示', async () => {
    imRequestSilentMock.mockResolvedValue([listItem({ adapterType: 'opencode' })])
    const wrapper = mountWindow()
    await flushPromises()
    await savePersona(wrapper)

    expect(successText()).toBe(i18n.global.t('aiclaw.detail.persona_save_success'))
    expect(successText()).not.toContain('新会话')
  })

  it('adapterType 缺省（老后端）：保持原文案不提示', async () => {
    const legacy = listItem()
    delete (legacy as any).adapterType
    imRequestSilentMock.mockResolvedValue([legacy])
    const wrapper = mountWindow()
    await flushPromises()
    await savePersona(wrapper)

    expect(successText()).toBe(i18n.global.t('aiclaw.detail.persona_save_success'))
  })
})
