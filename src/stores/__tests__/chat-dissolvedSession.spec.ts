import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#179：会话解散/失效后的统一清理逻辑测试。
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

import { useChatStore } from '@/stores/chat'
import { useGlobalStore } from '@/stores/global'
import { useGroupStore } from '@/stores/group'
import { RoomTypeEnum } from '@/enums'
import type { SessionItem } from '@/services/types'

const makeSession = (roomId: string): SessionItem =>
  ({
    roomId,
    name: `session-${roomId}`,
    type: RoomTypeEnum.GROUP,
    activeTime: Date.now(),
    unreadCount: 0
  }) as SessionItem

describe('useChatStore removeDissolvedSession (#179)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('移除目标会话、群详情，并切换当前会话到下一个', () => {
    const chatStore = useChatStore()
    const globalStore = useGlobalStore()
    const groupStore = useGroupStore()

    const s1 = makeSession('room-1')
    const s2 = makeSession('room-2')
    chatStore.sessionList = [s1, s2]
    chatStore.sessionMap = { 'room-1': s1, 'room-2': s2 }
    groupStore.groupDetails = [{ roomId: 'room-1' } as any, { roomId: 'room-2' } as any]
    globalStore.currentSessionRoomId = 'room-1'

    chatStore.removeDissolvedSession('room-1')

    expect(chatStore.sessionList.map((s) => s.roomId)).toEqual(['room-2'])
    expect(chatStore.sessionMap['room-1']).toBeUndefined()
    expect(groupStore.groupDetails.find((g) => g.roomId === 'room-1')).toBeUndefined()
    expect(globalStore.currentSessionRoomId).toBe('room-2')
  })

  it('移除最后一个会话后，当前会话应安全置空而不崩溃', () => {
    const chatStore = useChatStore()
    const globalStore = useGlobalStore()
    const groupStore = useGroupStore()

    const s1 = makeSession('room-1')
    chatStore.sessionList = [s1]
    chatStore.sessionMap = { 'room-1': s1 }
    groupStore.groupDetails = [{ roomId: 'room-1' } as any]
    globalStore.currentSessionRoomId = 'room-1'

    chatStore.removeDissolvedSession('room-1')

    expect(chatStore.sessionList).toEqual([])
    expect(chatStore.sessionMap['room-1']).toBeUndefined()
    expect(groupStore.groupDetails.find((g) => g.roomId === 'room-1')).toBeUndefined()
    expect(globalStore.currentSessionRoomId).toBe('')
  })

  it('移除非当前会话时，不切换当前会话', () => {
    const chatStore = useChatStore()
    const globalStore = useGlobalStore()

    const s1 = makeSession('room-1')
    const s2 = makeSession('room-2')
    chatStore.sessionList = [s1, s2]
    chatStore.sessionMap = { 'room-1': s1, 'room-2': s2 }
    globalStore.currentSessionRoomId = 'room-2'

    chatStore.removeDissolvedSession('room-1')

    expect(globalStore.currentSessionRoomId).toBe('room-2')
  })

  it('重复移除同一房间是幂等的', () => {
    const chatStore = useChatStore()
    const globalStore = useGlobalStore()

    const s1 = makeSession('room-1')
    const s2 = makeSession('room-2')
    chatStore.sessionList = [s1, s2]
    chatStore.sessionMap = { 'room-1': s1, 'room-2': s2 }
    globalStore.currentSessionRoomId = 'room-1'

    chatStore.removeDissolvedSession('room-1')
    chatStore.removeDissolvedSession('room-1')

    expect(chatStore.sessionList.map((s) => s.roomId)).toEqual(['room-2'])
    expect(globalStore.currentSessionRoomId).toBe('room-2')
  })
})
