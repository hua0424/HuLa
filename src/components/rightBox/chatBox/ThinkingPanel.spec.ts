import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getByLabel: vi.fn().mockResolvedValue(null), getCurrent: vi.fn() }
}))
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))
vi.mock('@tauri-apps/plugin-notification', () => ({
  sendNotification: vi.fn(),
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue('granted')
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/message' }),
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('@/utils/ImRequestUtils', () => ({
  markMsgRead: vi.fn().mockResolvedValue(undefined),
  getSessionDetail: vi.fn().mockResolvedValue(undefined),
  imRequest: vi.fn().mockResolvedValue({ list: [], cursor: '', isLast: true })
}))
vi.mock('@/utils/UnreadCountManager', () => ({
  unreadCountManager: {
    refreshBadge: vi.fn(),
    calculateTotal: vi.fn(),
    setUpdateCallback: vi.fn(),
    requestUpdate: vi.fn()
  }
}))
vi.mock('@/utils/TauriInvokeHandler', () => ({
  invokeWithErrorHandler: vi.fn().mockResolvedValue(undefined),
  invokeSilently: vi.fn().mockResolvedValue(undefined)
}))

import ThinkingPanel from './ThinkingPanel.vue'
import { useChatStore } from '@/stores/chat'
import { useGlobalStore } from '@/stores/global'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': {
      aiclaw: {
        thinking: {
          archive_entry: '已归档 {count} 条思考',
          archive_title: '思考归档',
          archive_empty: '暂无归档思考'
        }
      },
      components: {
        common: {
          close: '关闭'
        }
      }
    }
  }
})

describe('ThinkingPanel', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
  })

  const mountPanel = () =>
    mount(ThinkingPanel, {
      attachTo: document.body,
      global: {
        plugins: [pinia, i18n],
        stubs: {
          ThinkingCard: true
        }
      }
    })

  it('点击归档入口打开抽屉后，点击关闭按钮可关闭抽屉', async () => {
    const ROOM_ID = 'room-1'
    const chatStore = useChatStore()
    const globalStore = useGlobalStore()
    globalStore.currentSessionRoomId = ROOM_ID

    // 预置一条已归档思考，使归档入口出现
    chatStore.thinkingArchive.set(ROOM_ID, [
      {
        thinkingId: 'tk-001',
        aiclawId: 1001,
        aiclawName: 'TestBot',
        aiclawAvatar: '',
        roomId: ROOM_ID,
        status: 'complete',
        startTime: Date.now(),
        collapsed: true,
        durationMs: 1000
      }
    ])

    const wrapper = mountPanel()
    await flushPromises()

    const findCloseBtn = () => document.querySelector('[data-testid="thinking-archive-drawer-close"]')

    // 抽屉初始关闭
    expect(findCloseBtn()).toBeNull()

    // 点击归档入口打开抽屉
    await wrapper.find('.cursor-pointer').trigger('click')
    await flushPromises()

    const closeBtn = findCloseBtn()
    expect(closeBtn).not.toBeNull()
    expect(closeBtn!.getAttribute('aria-label')).toBe('关闭')

    // 点击关闭按钮后抽屉状态回到关闭
    await (closeBtn as HTMLElement).click()
    await flushPromises()

    expect((wrapper.vm as any).$.setupState.showArchiveDrawer as boolean).toBe(false)

    wrapper.unmount()
  })
})
