import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

/**
 * aichatoverview#210：管理窗「群设置」tab 实时性。
 *
 * groupConfigList 曾是 tab 激活时刻的快照：tab 打开期间该 aiclaw 被拉进新群
 * （WS_MEMBER_CHANGE → userListMap 经 pinia-shared-state 跨窗收敛）或群解散，
 * 卡片列表都不跟进，直到重开 tab。修复 = 监听 groupStore.getRoomIdsByUid 的
 * 成员签名变化，签名变了才静默收敛（重取数），且：
 *  - 仅配置 roomId 集合变化才替换列表（保住 AiclawGroupConfigForm 编辑中表单）
 *  - 任一房间取数失败（loadAiclawGroupConfigs=false）不收敛（防卡片因瞬时故障消失）
 *  - tab 未打开时不取数
 */

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

// ref-driven mocks：组件 watch 的响应式追踪依赖这些 ref
const roomIdsRef = ref<string[]>(['room-1', 'room-2'])
const configsRef = ref<any[]>([])
const loadAllOkRef = ref(true)

const chatStoreMocks = vi.hoisted(() => ({
  loadAiclawGroupConfigs: vi.fn(),
  loadAiclawGroupConfig: vi.fn(),
  getAiclawGroupConfigList: vi.fn(),
  saveAiclawGroupConfig: vi.fn()
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: () => chatStoreMocks
}))

vi.mock('@/stores/aiclaw', () => ({
  useAiclawStore: () => ({
    invalidate: vi.fn()
  })
}))

vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    patchCachedUserInfo: vi.fn(),
    getRoomIdsByUid: () => roomIdsRef.value
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

// 成员签名 watch 挂在组件实例上：不 unmount 会跨用例泄漏（旧 wrapper 仍响应 roomIdsRef 变化）
const mountedWrappers: Array<ReturnType<typeof mount>> = []
const mountWindow = () => {
  const wrapper = mount(AiAssistantWindow, {
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
          props: ['config', 'saving', 'adapterType', 'defaultWorkspaceDir'],
          emits: ['save']
        }
      }
    }
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

const makeConfig = (roomId: string, approved = true) => ({
  roomId,
  roomName: `${roomId} 群`,
  rateLimitPerMinute: 5,
  dailyLimit: 100,
  respondToAi: false,
  mentionRequired: true,
  approved
})

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.clearAllMocks()
  roomIdsRef.value = ['room-1', 'room-2']
  loadAllOkRef.value = true
  configsRef.value = [makeConfig('room-1'), makeConfig('room-2', false)]
  chatStoreMocks.loadAiclawGroupConfigs.mockImplementation(() => Promise.resolve(loadAllOkRef.value))
  chatStoreMocks.getAiclawGroupConfigList.mockImplementation(() => configsRef.value)
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
  while (mountedWrappers.length) mountedWrappers.pop()!.unmount()
  errorSpy.mockRestore()
})

describe('#210 群设置 tab 成员签名收敛', () => {
  it('tab 打开期间成员新增群 → 静默重取数，新群卡片即时出现', async () => {
    const wrapper = mountWindow()
    await flushPromises()

    expect(wrapper.findAll('[data-testid="aiclaw-group-card"]')).toHaveLength(2)
    expect(chatStoreMocks.loadAiclawGroupConfigs).toHaveBeenCalledTimes(1)

    // 该 aiclaw 被拉进新群（另一窗口/WS 帧 → userListMap 收敛）
    roomIdsRef.value = ['room-1', 'room-2', 'room-3']
    configsRef.value = [makeConfig('room-1'), makeConfig('room-2', false), makeConfig('room-3', false)]
    await flushPromises()

    expect(chatStoreMocks.loadAiclawGroupConfigs).toHaveBeenCalledTimes(2)
    const cards = wrapper.findAll('[data-testid="aiclaw-group-card"]')
    expect(cards).toHaveLength(3)
    expect(cards.some((c) => c.text().includes('room-3 群'))).toBe(true)
  })

  it('tab 打开期间群解散（成员签名收缩）→ 对应卡片消失', async () => {
    const wrapper = mountWindow()
    await flushPromises()
    expect(wrapper.findAll('[data-testid="aiclaw-group-card"]')).toHaveLength(2)

    roomIdsRef.value = ['room-1']
    configsRef.value = [makeConfig('room-1')]
    await flushPromises()

    expect(chatStoreMocks.loadAiclawGroupConfigs).toHaveBeenCalledTimes(2)
    const cards = wrapper.findAll('[data-testid="aiclaw-group-card"]')
    expect(cards).toHaveLength(1)
    expect(cards[0].text()).toContain('room-1 群')
  })

  it('成员签名变了但配置 roomId 集合未变 → 不替换列表对象（保住编辑中表单）', async () => {
    const wrapper = mountWindow()
    await flushPromises()

    const formsBefore = wrapper.findAllComponents({ name: 'AiclawGroupConfigFormStub' })
    expect(formsBefore.length).toBeGreaterThan(0)
    const originalConfig = formsBefore[0].props('config')

    // 成员多了 room-3，但该群尚无配置记录 → 配置 roomId 集合与列表一致
    roomIdsRef.value = ['room-1', 'room-2', 'room-3']
    configsRef.value = [makeConfig('room-1'), makeConfig('room-2', false)] // 新数组新对象
    await flushPromises()

    // 收敛确实跑过（重取数），但列表未被替换 → 表单 prop 保持同一对象引用
    expect(chatStoreMocks.loadAiclawGroupConfigs).toHaveBeenCalledTimes(2)
    const formsAfter = wrapper.findAllComponents({ name: 'AiclawGroupConfigFormStub' })
    expect(formsAfter[0].props('config')).toBe(originalConfig)
  })

  it('任一房间取数失败（loadAiclawGroupConfigs=false）→ 不收敛，卡片不因瞬时故障消失', async () => {
    const wrapper = mountWindow()
    await flushPromises()
    expect(wrapper.findAll('[data-testid="aiclaw-group-card"]')).toHaveLength(2)

    loadAllOkRef.value = false
    roomIdsRef.value = ['room-1', 'room-2', 'room-3']
    configsRef.value = [makeConfig('room-1')]
    await flushPromises()

    // 收敛尝试过重取数，但失败后不得用残缺结果替换列表
    expect(chatStoreMocks.loadAiclawGroupConfigs).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('[data-testid="aiclaw-group-card"]')).toHaveLength(2)
  })

  it('tab 未打开（详情页）时成员变化不触发重取数', async () => {
    const wrapper = mountWindow()
    await flushPromises()
    expect(chatStoreMocks.loadAiclawGroupConfigs).toHaveBeenCalledTimes(1)

    // 返回详情页
    await wrapper.find('use[href="#left"]').trigger('click')
    await flushPromises()

    roomIdsRef.value = ['room-1', 'room-2', 'room-3']
    configsRef.value = [makeConfig('room-1'), makeConfig('room-2', false), makeConfig('room-3', false)]
    await flushPromises()

    expect(chatStoreMocks.loadAiclawGroupConfigs).toHaveBeenCalledTimes(1)
  })
})
