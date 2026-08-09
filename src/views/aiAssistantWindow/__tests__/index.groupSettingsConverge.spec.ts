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
 * 卡片列表都不跟进，直到重开 tab。修复 = 两条互补路径：
 *  - 签名 watcher（web/移动端单上下文，userListMap 是活的）：签名变了才静默收敛
 *  - Tauri 事件 MEMBER_CHANGE_EVENT（桌面多窗）：真机诊断发现 pinia-shared-state
 *    收包 $patch 将 $state 的 reactive() 子树换成反序列化副本、首轮往返后跨窗同步
 *    失效（仅剩建窗快照），桌面端改由主窗 WS handler 经 Tauri 事件直驱增量收敛。
 * 闸门（两路径共用）：
 *  - 取数失败不加/不换卡（防卡片因瞬时故障消失）
 *  - 与选中 aiclaw 无关的成员变化不动列表（防 AiclawGroupConfigForm 重置编辑中表单）
 *  - tab 未打开时不取数
 */

vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: {},
    query: { aiclawUid: '1001', roomId: 'room-2' }
  })
}))

// Tauri 事件注册表：捕获组件 listen 的回调，用例按事件名直发
const listenRegistry = vi.hoisted(() => ({
  callbacks: {} as Record<string, (event: { payload: unknown }) => void>
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((event: string, cb: (e: { payload: unknown }) => void) => {
    listenRegistry.callbacks[event] = cb
    return Promise.resolve(() => {
      delete listenRegistry.callbacks[event]
    })
  })
}))

// 桌面窗口环境：MEMBER_CHANGE_EVENT 监听仅 isDesktop 挂载
vi.mock('@/utils/PlatformConstants', () => ({
  isDesktop: () => true,
  isWeb: () => false,
  isMobile: () => false
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
  loadAiclawGroupConfigDetail: vi.fn(),
  removeAiclawGroupConfig: vi.fn(),
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
import { ChangeTypeEnum } from '@/enums'
import { MEMBER_CHANGE_EVENT } from '@/utils/memberChangeBroadcast'
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
  chatStoreMocks.loadAiclawGroupConfigDetail.mockResolvedValue(true)
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

  it('tab 打开期间被移出最后一个群（签名变空集）→ 最后一张卡片也消失', async () => {
    const wrapper = mountWindow()
    await flushPromises()
    expect(wrapper.findAll('[data-testid="aiclaw-group-card"]')).toHaveLength(2)

    roomIdsRef.value = []
    configsRef.value = []
    await flushPromises()

    // 空集与「tab 未激活」不能共用空串签名：被移出最后一个群时也必须收敛
    expect(chatStoreMocks.loadAiclawGroupConfigs).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('[data-testid="aiclaw-group-card"]')).toHaveLength(0)
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

/**
 * #210 二期：桌面多窗下 pinia-shared-state 首轮往返后同步失效（reactive() 子树被
 * $patch 换成反序列化副本），签名 watcher 收不到跨窗变化。桌面端改由主窗 WS handler
 * 经 Tauri 事件 MEMBER_CHANGE_EVENT 直驱增量收敛——事件载荷自带 roomId/changeType/
 * uidList，只动受影响的卡片，不整表替换（编辑中表单引用不被重置）。
 */
describe('#210 二期 桌面端 Tauri 事件直驱收敛', () => {
  const fireMemberChange = async (payload: Record<string, unknown>) => {
    listenRegistry.callbacks[MEMBER_CHANGE_EVENT]?.({ payload })
    await flushPromises()
  }

  it('挂载即注册 MEMBER_CHANGE_EVENT 监听（isDesktop 守卫通过）', async () => {
    mountWindow()
    await flushPromises()
    expect(listenRegistry.callbacks[MEMBER_CHANGE_EVENT]).toBeTypeOf('function')
  })

  it('广播「选中 aiclaw 被移出群」→ 卡片即时消失并逐出缓存（无需重开 tab）', async () => {
    const wrapper = mountWindow()
    await flushPromises()
    expect(wrapper.findAll('[data-testid="aiclaw-group-card"]')).toHaveLength(2)

    await fireMemberChange({ roomId: 'room-1', changeType: ChangeTypeEnum.REMOVE, uidList: ['1001'] })

    expect(chatStoreMocks.removeAiclawGroupConfig).toHaveBeenCalledWith(1001, 'room-1')
    const cards = wrapper.findAll('[data-testid="aiclaw-group-card"]')
    expect(cards).toHaveLength(1)
    expect(cards[0].text()).toContain('room-2 群')
  })

  it('被移出最后一个群 → 两张卡片全部消失', async () => {
    const wrapper = mountWindow()
    await flushPromises()

    await fireMemberChange({ roomId: 'room-1', changeType: ChangeTypeEnum.REMOVE, uidList: ['1001'] })
    await fireMemberChange({ roomId: 'room-2', changeType: ChangeTypeEnum.REMOVE, uidList: ['1001'] })

    expect(wrapper.findAll('[data-testid="aiclaw-group-card"]')).toHaveLength(0)
  })

  it('广播「选中 aiclaw 被拉进新群」且取数成功 → 新群卡片即时出现', async () => {
    const wrapper = mountWindow()
    await flushPromises()
    expect(wrapper.findAll('[data-testid="aiclaw-group-card"]')).toHaveLength(2)

    // 模拟 detail 取数已写入 store 缓存：之后 getAiclawGroupConfigList 返回含 room-3 的列表
    configsRef.value = [makeConfig('room-1'), makeConfig('room-2', false), makeConfig('room-3', false)]
    await fireMemberChange({ roomId: 'room-3', changeType: ChangeTypeEnum.JOIN, uidList: ['1001'] })

    expect(chatStoreMocks.loadAiclawGroupConfigDetail).toHaveBeenCalledWith(1001, 'room-3')
    const cards = wrapper.findAll('[data-testid="aiclaw-group-card"]')
    expect(cards).toHaveLength(3)
    expect(cards.some((c) => c.text().includes('room-3 群'))).toBe(true)
  })

  it('拉人广播但取数失败（loadAiclawGroupConfigDetail=false）→ 不加卡，列表原样', async () => {
    const wrapper = mountWindow()
    await flushPromises()

    chatStoreMocks.loadAiclawGroupConfigDetail.mockResolvedValueOnce(false)
    await fireMemberChange({ roomId: 'room-3', changeType: ChangeTypeEnum.JOIN, uidList: ['1001'] })

    expect(chatStoreMocks.loadAiclawGroupConfigDetail).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('[data-testid="aiclaw-group-card"]')).toHaveLength(2)
  })

  it('与选中 aiclaw 无关的成员变化 → 不取数、不逐出、列表对象不替换（保住编辑中表单）', async () => {
    const wrapper = mountWindow()
    await flushPromises()

    const formsBefore = wrapper.findAllComponents({ name: 'AiclawGroupConfigFormStub' })
    expect(formsBefore.length).toBeGreaterThan(0)
    const originalConfig = formsBefore[0].props('config')

    await fireMemberChange({ roomId: 'room-1', changeType: ChangeTypeEnum.REMOVE, uidList: ['9999'] })
    await fireMemberChange({ roomId: 'room-9', changeType: ChangeTypeEnum.JOIN, uidList: ['9999'] })

    expect(chatStoreMocks.loadAiclawGroupConfigDetail).not.toHaveBeenCalled()
    expect(chatStoreMocks.removeAiclawGroupConfig).not.toHaveBeenCalled()
    expect(wrapper.findAll('[data-testid="aiclaw-group-card"]')).toHaveLength(2)
    const formsAfter = wrapper.findAllComponents({ name: 'AiclawGroupConfigFormStub' })
    expect(formsAfter[0].props('config')).toBe(originalConfig)
  })

  it('广播「群解散」→ 对应卡片消失，且不触发取数', async () => {
    const wrapper = mountWindow()
    await flushPromises()

    await fireMemberChange({ roomId: 'room-1', dissolved: true })

    expect(chatStoreMocks.removeAiclawGroupConfig).toHaveBeenCalledWith(1001, 'room-1')
    expect(chatStoreMocks.loadAiclawGroupConfigDetail).not.toHaveBeenCalled()
    const cards = wrapper.findAll('[data-testid="aiclaw-group-card"]')
    expect(cards).toHaveLength(1)
    expect(cards[0].text()).toContain('room-2 群')
  })

  it('tab 未打开时收到广播 → 不动作（不取数、不逐出）', async () => {
    const wrapper = mountWindow()
    await flushPromises()

    await wrapper.find('use[href="#left"]').trigger('click')
    await flushPromises()

    await fireMemberChange({ roomId: 'room-1', changeType: ChangeTypeEnum.REMOVE, uidList: ['1001'] })

    expect(chatStoreMocks.loadAiclawGroupConfigDetail).not.toHaveBeenCalled()
    expect(chatStoreMocks.removeAiclawGroupConfig).not.toHaveBeenCalled()
  })
})
