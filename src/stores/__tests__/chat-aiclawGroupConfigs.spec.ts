import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-016 #196 F5：复数版 loadAiclawGroupConfigs（管理窗批量场景）单房间失败改静默。
 * userListMap 残留（退群/解散后 aiclaw 仍挂旧房间）会让陈旧房间 server membership 校验必炸，
 * 每个失败房间都弹全局 toast = 误报风暴。单房间请求必须 showError:false，由调用方按返回
 * boolean 自行决定提示，且单房间失败不影响其余房间入库。
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

const imRequestMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: (...args: unknown[]) => imRequestMock(...args),
  markMsgRead: vi.fn().mockResolvedValue(undefined),
  getSessionDetail: vi.fn().mockResolvedValue({
    roomId: 'room-1',
    activeTime: Date.now(),
    unreadCount: 0,
    text: '',
    type: 1,
    name: 'test-room',
    avatar: ''
  })
}))
vi.mock('@/utils/RenderReplyContent.ts', () => ({
  renderReplyContent: vi.fn().mockImplementation((_name, _type, content) => content)
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

vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({ currentSessionRoomId: '' })
}))
vi.mock('@/stores/user', () => ({
  useUserStore: () => ({ userInfo: { uid: '12345', name: 'Me' } })
}))
const groupStoreMocks = vi.hoisted(() => ({
  getRoomIdsByUid: vi.fn(),
  addGroupDetail: vi.fn().mockResolvedValue(undefined),
  getGroupDetail: vi.fn().mockReturnValue(undefined),
  getUserInfo: vi.fn().mockReturnValue({ name: 'Alice', avatar: '' })
}))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => groupStoreMocks
}))
vi.mock('@/stores/feed', () => ({
  useFeedStore: () => ({})
}))
vi.mock('@/stores/sessionUnread', () => ({
  useSessionUnreadStore: () => ({
    apply: vi.fn().mockReturnValue({}),
    set: vi.fn(),
    remove: vi.fn()
  })
}))

import { useChatStore } from '@/stores/chat'

describe('chatStore.loadAiclawGroupConfigs（REQ-016 #196 F5 复数版静默）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    imRequestMock.mockReset()
    groupStoreMocks.getRoomIdsByUid.mockReset().mockReturnValue(['room-1', 'room-2'])
    groupStoreMocks.addGroupDetail.mockClear()
    groupStoreMocks.getGroupDetail.mockClear()
  })

  it('逐房间请求带 showError:false（陈旧房间校验失败不弹全局 toast）', async () => {
    imRequestMock.mockResolvedValue({ roomId: 'room-1', rateLimitPerMinute: 10 })

    const chatStore = useChatStore()
    await chatStore.loadAiclawGroupConfigs(1001)

    expect(imRequestMock).toHaveBeenCalledTimes(2)
    for (const call of imRequestMock.mock.calls) {
      expect(call[1]).toMatchObject({ showError: false })
    }
  })

  it('单房间失败不抛出、不影响其余房间入库，返回 false 由调用方裁决', async () => {
    // roomId 按 getRoomIdsByUid 顺序依次请求：room-1 成功，room-2 陈旧（server 校验炸）
    imRequestMock
      .mockResolvedValueOnce({ roomId: 'room-1', rateLimitPerMinute: 10 })
      .mockRejectedValueOnce(new Error('您不在该群中'))

    const chatStore = useChatStore()
    const ok = await chatStore.loadAiclawGroupConfigs(1001)

    expect(ok).toBe(false)
    expect(chatStore.getAiclawGroupConfig(1001, 'room-1')).toBeTruthy()
    expect(chatStore.getAiclawGroupConfig(1001, 'room-2')).toBeUndefined()
  })
})
