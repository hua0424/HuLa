import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#229：getSessionList（重连/后台重拉）断网静默——函数级 showError:false。
 * manager 裁决（2026-08-10）：ISS-009 领域 UX 是兜底卡片+重试，裸 toast 并存属冗余噪声，
 * 只收 toast，卡片/isError/重试/web 分支全保留。
 */

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

const invokeWithErrorHandlerMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/TauriInvokeHandler', () => ({
  invokeWithErrorHandler: (...args: any[]) => invokeWithErrorHandlerMock(...args),
  invokeSilently: vi.fn().mockResolvedValue(undefined)
}))

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
  imRequest: vi.fn().mockResolvedValue({ list: [], cursor: '', isLast: true }),
  imRequestSilent: vi.fn().mockResolvedValue([])
}))
vi.mock('@/utils/UnreadCountManager', () => ({
  unreadCountManager: {
    refreshBadge: vi.fn(),
    calculateTotal: vi.fn(),
    setUpdateCallback: vi.fn(),
    requestUpdate: vi.fn()
  }
}))
vi.mock('@/utils/PlatformConstants', () => ({ isWeb: () => false, isDesktop: () => true, isMobile: () => false }))

import { useChatStore } from '@/stores/chat'

describe('#229 getSessionList 断网静默（ISS-009 边界内：只收 toast）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    invokeWithErrorHandlerMock.mockReset().mockResolvedValue([])
  })

  it('桌面路径 LIST_CONTACTS 带 showError:false（重连/后台重拉不弹裸 toast）', async () => {
    await useChatStore().getSessionList(true)

    expect(invokeWithErrorHandlerMock).toHaveBeenCalledWith(
      'list_contacts_command',
      undefined,
      expect.objectContaining({ showError: false })
    )
  })

  it('失败仍置 sessionOptions.isError（ISS-009 兜底卡片数据源不动）', async () => {
    invokeWithErrorHandlerMock.mockRejectedValue(new Error('network down'))

    const store = useChatStore()
    await store.getSessionList(true)

    expect(store.sessionOptions.isError).toBe(true)
  })

  it('成功路径后 isError 复位（既有行为不变）', async () => {
    const store = useChatStore()
    await store.getSessionList(true)

    expect(store.sessionOptions.isError).toBe(false)
  })
})
