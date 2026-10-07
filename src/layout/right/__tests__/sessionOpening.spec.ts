import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

/**
 * #339：右栏在途目标态——只呈现目标加载/失败，不呈现旧房间；失败可重试。
 */

const mittHandlers = vi.hoisted(() => new Map<string, (...args: any[]) => void>())
const mittMock = vi.hoisted(() => ({
  emit: vi.fn(),
  on: (event: string, fn: (...args: any[]) => void) => mittHandlers.set(event, fn),
  off: vi.fn()
}))
vi.mock('@/hooks/useMitt.ts', () => ({ useMitt: mittMock }))

vi.hoisted(() => {
  class WorkerStub {
    onerror: ((e: unknown) => void) | null = null
    postMessage() {}
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  }
  globalThis.Worker = WorkerStub as unknown as typeof Worker
})
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('@tauri-apps/plugin-notification', () => ({
  sendNotification: vi.fn(),
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue('granted')
}))
vi.mock('@/utils/UnreadCountManager', () => ({
  unreadCountManager: {
    refreshBadge: vi.fn(),
    calculateTotal: vi.fn(),
    setUpdateCallback: vi.fn(),
    requestUpdate: vi.fn()
  }
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getCurrent: () => ({ label: 'home' }) }
}))
vi.mock('@/router', () => ({
  default: { currentRoute: { value: { path: '/message' } }, push: vi.fn() }
}))
vi.mock('@/stores/setting.ts', async () => {
  const { ref } = await import('vue')
  return {
    useSettingStore: () => ({ themes: ref({ content: 'LIGHT', pattern: 'LIGHT' }) })
  }
})

const currentSessionRoomIdRef = ref('')
const sessionOpeningRef = ref<{ uid: string; type: number; error: string } | null>(null)
vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({ currentSessionRoomId: currentSessionRoomIdRef, sessionOpening: sessionOpeningRef })
}))
vi.mock('@/stores/group.ts', () => ({
  useGroupStore: () => ({
    getUserInfo: (uid: string) => (uid === 'uid-b' ? { name: '小王' } : undefined)
  })
}))

const openMsgSessionMock = vi.fn(async (_uid: string, _type: number) => {})
vi.mock('@/hooks/useCommon.ts', () => ({
  useCommon: () => ({ openMsgSession: openMsgSessionMock })
}))
vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string, params?: Record<string, string>) => (params?.name ? `${key}(${params.name})` : key)
    })
  }
})

vi.mock('@/components/rightBox/chatBox/index.vue', () => ({
  default: { name: 'ChatBox', template: '<div data-testid="chat-box-stub" />' }
}))
vi.mock('@/components/rightBox/Details.vue', () => ({ default: { name: 'Details', template: '<div />' } }))

import RightLayout from '@/layout/right/index.vue'

const mountLayout = () =>
  mount(RightLayout, {
    global: {
      stubs: {
        ActionBar: true,
        ApplyList: true,
        'n-spin': true,
        'n-button': { template: '<button @click="$emit(\'click\')"><slot /></button>' }
      }
    }
  })

describe('layout/right 在途目标态（#339）', () => {
  beforeEach(() => {
    currentSessionRoomIdRef.value = ''
    sessionOpeningRef.value = null
    mittHandlers.clear()
    vi.clearAllMocks()
  })

  it('加载期：呈现目标加载态，不挂载 ChatBox（旧房间不可见、不可发送）', async () => {
    sessionOpeningRef.value = { uid: 'uid-b', type: 2, error: '' }
    const wrapper = mountLayout()
    await flushPromises()

    expect(wrapper.find('[data-testid="chat-box-stub"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="session-opening-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="session-opening"]').text()).toContain('小王')
    expect(wrapper.find('[data-testid="session-opening-error"]').exists()).toBe(false)
  })

  it('未知目标名时退化为通用加载文案', async () => {
    sessionOpeningRef.value = { uid: 'uid-unknown', type: 2, error: '' }
    const wrapper = mountLayout()
    await flushPromises()

    expect(wrapper.find('[data-testid="session-opening-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="session-opening"]').text()).toContain('home.chat_main.opening_loading')
  })

  it('失败期：呈现错误与重试，点击重试沿用同一目标入口', async () => {
    sessionOpeningRef.value = { uid: 'uid-b', type: 2, error: 'network down' }
    const wrapper = mountLayout()
    await flushPromises()

    expect(wrapper.find('[data-testid="chat-box-stub"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="session-opening-error"]').exists()).toBe(true)
    await wrapper.find('[data-testid="session-opening-retry"]').trigger('click')
    expect(openMsgSessionMock).toHaveBeenCalledWith('uid-b', 2)
  })

  it('无在途无选中：保持原占位，不出现目标面板', async () => {
    const wrapper = mountLayout()
    await flushPromises()

    expect(wrapper.find('[data-testid="session-opening"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="chat-box-stub"]').exists()).toBe(false)
  })

  it('目标就绪：ChatBox 挂载，目标面板消失', async () => {
    currentSessionRoomIdRef.value = 'room-b'
    const wrapper = mountLayout()
    await flushPromises()

    expect(wrapper.find('[data-testid="chat-box-stub"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="session-opening"]').exists()).toBe(false)
  })
})
