import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageStatusEnum, MsgEnum } from '@/enums'
import type { MessageType } from '@/services/types'

/**
 * #150 客户端 @提及通知修复：atUidList 是数字数组，当前 uid 是字符串，
 * 必须 String() 归一后再比较，否则 includes 恒 false。
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
  getSessionDetail: vi.fn().mockResolvedValue({
    roomId: 'room-1',
    activeTime: Date.now(),
    unreadCount: 0,
    text: '',
    type: 1,
    name: 'test-room',
    avatar: ''
  }),
  imRequest: vi.fn().mockResolvedValue({ list: [], cursor: '', isLast: true })
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
vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    getUserInfo: vi.fn().mockReturnValue({ name: 'Alice', avatar: '' })
  })
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
import { sendNotification } from '@tauri-apps/plugin-notification'

const ROOM_ID = 'room-1'

const makeMsg = (atUidList: unknown, fromUid = 'other-1'): MessageType =>
  ({
    fromUser: { uid: fromUid, username: 'Alice', avatar: '', locPlace: '' },
    isCheck: false,
    sendTime: 1700000000000,
    message: {
      id: 'msg-1',
      roomId: ROOM_ID,
      type: MsgEnum.TEXT,
      status: MessageStatusEnum.SUCCESS,
      sendTime: 1700000000000,
      body: { content: 'hello @me', atUidList },
      messageMarks: {}
    }
  }) as unknown as MessageType

describe('useChatStore @ mention notification (#150)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(sendNotification).mockClear()
  })

  it('atUidList 是数字数组、当前 uid 是字符串时应触发通知', async () => {
    const store = useChatStore()
    await store.pushMsg(makeMsg([12345]))

    expect(sendNotification).toHaveBeenCalledTimes(1)
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Alice',
        body: 'hello @me'
      })
    )
  })

  it('atUidList 是字符串数组时也命中', async () => {
    const store = useChatStore()
    await store.pushMsg(makeMsg(['12345']))

    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  it('数字/字符串混合数组也能命中当前 uid', async () => {
    const store = useChatStore()
    await store.pushMsg(makeMsg([99999, '12345', 11111]))

    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  it('atUidList 不包含当前 uid 时不触发通知', async () => {
    const store = useChatStore()
    await store.pushMsg(makeMsg([99999, 11111]))

    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('atUidList 为 null/undefined 时不触发通知', async () => {
    const store = useChatStore()
    await store.pushMsg(makeMsg(null))
    await store.pushMsg(makeMsg(undefined))

    expect(sendNotification).not.toHaveBeenCalled()
  })
})
