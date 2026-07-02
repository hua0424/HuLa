import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: {},
    query: { aiclawUid: '1001', roomId: 'room-2' }
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

const chatStoreMocks = vi.hoisted(() => ({
  loadAiclawGroupConfigs: vi.fn().mockResolvedValue(undefined),
  loadAiclawGroupConfig: vi.fn().mockResolvedValue(undefined),
  getAiclawGroupConfigList: vi.fn().mockReturnValue([]),
  saveAiclawGroupConfig: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: () => chatStoreMocks
}))

vi.mock('@/stores/aiclaw', () => ({
  useAiclawStore: () => ({
    invalidate: vi.fn()
  })
}))

vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: vi.fn().mockResolvedValue([]),
  imRequestSilent: vi.fn().mockResolvedValue([])
}))

import { imRequestSilent } from '@/utils/ImRequestUtils'
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
        AiclawGroupConfigForm: {
          name: 'AiclawGroupConfigFormStub',
          template: '<div data-testid="aiclaw-group-config-form" />',
          props: ['config', 'saving', 'adapterType', 'aiclawUid', 'defaultWorkspaceDir'],
          emits: ['save']
        }
      }
    }
  })

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.clearAllMocks()
  vi.mocked(imRequestSilent).mockResolvedValue([
    {
      uid: '1001',
      name: 'TestAI',
      avatar: '',
      description: '',
      authStatus: 1,
      activeStatus: 1,
      adapterType: 'opencode',
      publicPersona: '',
      createTime: Date.now()
    }
  ])
})

afterEach(() => {
  errorSpy.mockRestore()
})

function i18nCompileErrors(): string[] {
  return errorSpy.mock.calls
    .map((args: unknown[]) => args.map(String).join(' '))
    .filter((line: string) => /compilation error|Invalid linked format/i.test(line))
}

describe('REQ-012 #114：AI 助理群设置未激活群卡显眼化 + 一键批准', () => {
  beforeEach(() => {
    chatStoreMocks.getAiclawGroupConfigList.mockReturnValue([
      {
        roomId: 'room-1',
        roomName: 'Alpha 群',
        rateLimitPerMinute: 5,
        dailyLimit: 100,
        respondToAi: false,
        mentionRequired: true,
        approved: true
      },
      {
        roomId: 'room-2',
        roomName: 'Beta 群',
        rateLimitPerMinute: 5,
        dailyLimit: 100,
        respondToAi: false,
        mentionRequired: true,
        approved: false
      }
    ])
  })

  it('从 query 跳转后加载群设置，未激活卡片排在前面', async () => {
    const wrapper = mountWindow()
    await flushPromises()

    expect(i18nCompileErrors()).toEqual([])
    const cards = wrapper.findAll('[data-testid="aiclaw-group-card"]')
    expect(cards).toHaveLength(2)
    expect(cards[0].find('[data-testid="aiclaw-group-card-inactive-badge"]').exists()).toBe(true)
    expect(cards[1].find('[data-testid="aiclaw-group-card-inactive-badge"]').exists()).toBe(false)
    // Beta 群 approved=false，应排第一
    expect(cards[0].text()).toContain('Beta 群')
    expect(cards[1].text()).toContain('Alpha 群')
  })

  it('未激活卡片显示「批准」按钮，已激活卡片不显示', async () => {
    const wrapper = mountWindow()
    await flushPromises()

    const cards = wrapper.findAll('[data-testid="aiclaw-group-card"]')
    expect(cards[0].find('[data-testid="aiclaw-group-card-approve-button"]').exists()).toBe(true)
    expect(cards[1].find('[data-testid="aiclaw-group-card-approve-button"]').exists()).toBe(false)
  })

  it('点击「批准」后调用 saveAiclawGroupConfig(approved=true) 并重载配置', async () => {
    const wrapper = mountWindow()
    await flushPromises()

    const approveBtn = wrapper.find('[data-testid="aiclaw-group-card-approve-button"]')
    expect(approveBtn.exists()).toBe(true)
    await approveBtn.trigger('click')
    await flushPromises()

    expect(chatStoreMocks.saveAiclawGroupConfig).toHaveBeenCalledWith(
      1001,
      'room-2',
      expect.objectContaining({ approved: true })
    )
    expect(chatStoreMocks.loadAiclawGroupConfig).toHaveBeenCalledWith(1001, 'room-2')
  })

  it('P2：表单保存 approved=false 后重载配置并同步列表，立即显示未激活徽章', async () => {
    chatStoreMocks.getAiclawGroupConfigList.mockReturnValue([
      {
        roomId: 'room-2',
        roomName: 'Beta 群',
        rateLimitPerMinute: 5,
        dailyLimit: 100,
        respondToAi: false,
        mentionRequired: true,
        approved: true
      },
      {
        roomId: 'room-1',
        roomName: 'Alpha 群',
        rateLimitPerMinute: 5,
        dailyLimit: 100,
        respondToAi: false,
        mentionRequired: true,
        approved: false
      }
    ])

    const wrapper = mountWindow()
    await flushPromises()

    const forms = wrapper.findAllComponents({ name: 'AiclawGroupConfigFormStub' })
    expect(forms).toHaveLength(2)

    // 模拟 Beta 群表单把 approved toggle 从 true 改为 false 保存
    chatStoreMocks.getAiclawGroupConfigList.mockReturnValue([
      {
        roomId: 'room-2',
        roomName: 'Beta 群',
        rateLimitPerMinute: 5,
        dailyLimit: 100,
        respondToAi: false,
        mentionRequired: true,
        approved: false
      },
      {
        roomId: 'room-1',
        roomName: 'Alpha 群',
        rateLimitPerMinute: 5,
        dailyLimit: 100,
        respondToAi: false,
        mentionRequired: true,
        approved: false
      }
    ])

    await forms[1].vm.$emit('save', {
      roomId: 'room-2',
      roomName: 'Beta 群',
      rateLimitPerMinute: 5,
      dailyLimit: 100,
      respondToAi: false,
      mentionRequired: true,
      approved: false
    })
    await flushPromises()

    expect(chatStoreMocks.saveAiclawGroupConfig).toHaveBeenCalledWith(
      1001,
      'room-2',
      expect.objectContaining({ approved: false })
    )
    expect(chatStoreMocks.loadAiclawGroupConfig).toHaveBeenCalledWith(1001, 'room-2')

    const cards = wrapper.findAll('[data-testid="aiclaw-group-card"]')
    const betaCard = cards.find((c) => c.text().includes('Beta 群'))
    expect(betaCard).toBeDefined()
    expect(betaCard!.find('[data-testid="aiclaw-group-card-inactive-badge"]').exists()).toBe(true)
  })
})
