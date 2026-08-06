import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-017 #208：ROOM_DISSOLUTION / 离线同步失效路径（chatStore.removeDissolvedSession）
 * 也必须整键清除成员缓存——在线收解散帧与离线重建两条路都不留陈旧 userListMap。
 * 复用 dissolveGroup.spec 的真实 chat store + 网络边界打桩模式。
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
  getSessionDetail: vi.fn(),
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
vi.mock('@/utils/PlatformConstants', () => ({
  isWeb: () => false,
  isMobile: () => false,
  isWindows: () => true,
  isMac: () => false
}))

import { useChatStore } from '@/stores/chat'
import { useGroupStore } from '@/stores/group'

describe('chatStore.removeDissolvedSession #208 成员缓存治本', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('解散清理后 getRoomIdsByUid 不再返回该房间，房间被标记失效', () => {
    const chatStore = useChatStore()
    const groupStore = useGroupStore()

    // 种下成员缓存（含一个 aiclaw 成员，模拟 #196 误报的源头形态）
    groupStore.updateMemberCache('r9', [{ uid: 'ai-1', name: 'aiclaw' }] as any)
    expect(groupStore.getRoomIdsByUid('ai-1')).toContain('r9')

    chatStore.removeDissolvedSession('r9')

    expect(groupStore.userListMap['r9']).toBeUndefined()
    expect(groupStore.getRoomIdsByUid('ai-1')).not.toContain('r9')
    expect(groupStore.isRoomDissolved('r9')).toBe(true)
  })
})
