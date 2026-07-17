import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useMessage } from '@/hooks/useMessage'
import { RoomTypeEnum } from '@/enums'
import type { SessionItem } from '@/services/types'

const chatStoreMock = {
  getSession: vi.fn(),
  getSessionList: vi.fn(),
  markSessionRead: vi.fn(),
  removeDissolvedSession: vi.fn()
}

const globalStoreMock = {
  updateCurrentSessionRoomId: vi.fn()
}

const groupStoreMock = {
  getUserListByRoomId: vi.fn(),
  getGroupUserList: vi.fn()
}

const userStoreMock = {
  userInfo: { uid: '10001' }
}

vi.mock('@/stores/chat', () => ({
  useChatStore: vi.fn(() => chatStoreMock)
}))

vi.mock('@/stores/global', () => ({
  useGlobalStore: vi.fn(() => globalStoreMock)
}))

vi.mock('@/stores/group', () => ({
  useGroupStore: vi.fn(() => groupStoreMock)
}))

vi.mock('@/stores/user', () => ({
  useUserStore: vi.fn(() => userStoreMock)
}))

vi.mock('@/stores/contacts', () => ({
  useContactStore: vi.fn(() => ({}))
}))

vi.mock('@/stores/setting', () => ({
  useSettingStore: vi.fn(() => ({ chat: { value: { isDouble: false } } }))
}))

vi.mock('@/utils/ImRequestUtils', () => ({
  exitGroup: vi.fn(),
  notification: vi.fn(),
  setSessionTop: vi.fn(),
  shield: vi.fn()
}))

vi.mock('@/utils/TauriInvokeHandler', () => ({
  invokeWithErrorHandler: vi.fn()
}))

vi.mock('@/hooks/useMitt', () => ({
  useMitt: {
    on: vi.fn(),
    emit: vi.fn()
  }
}))

vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({
    t: vi.fn((key: string) => key)
  }))
}))

describe('useMessage handleMsgClick 幽灵会话兜底清理', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  const createGroupSession = (roomId: string): SessionItem =>
    ({
      roomId,
      type: RoomTypeEnum.GROUP,
      unreadCount: 0
    }) as SessionItem

  it('群成员同步失败且服务端列表已无该房间时，应清理幽灵会话', async () => {
    const { handleMsgClick } = useMessage()
    const roomId = 'ghost-room-id'
    const session = createGroupSession(roomId)

    // 本地成员列表不含当前用户，触发 getGroupUserList
    groupStoreMock.getUserListByRoomId.mockReturnValue([])
    groupStoreMock.getGroupUserList.mockRejectedValue(new Error('房间号有误'))

    // 强拉列表后房间消失
    chatStoreMock.getSessionList.mockResolvedValue(undefined)
    chatStoreMock.getSession.mockReturnValueOnce({ roomId } as SessionItem).mockReturnValueOnce(undefined)

    await handleMsgClick(session)

    expect(globalStoreMock.updateCurrentSessionRoomId).toHaveBeenCalledWith(roomId)
    expect(chatStoreMock.getSession).toHaveBeenCalledWith(roomId)
    expect(chatStoreMock.markSessionRead).toHaveBeenCalledWith(roomId)
    expect(groupStoreMock.getGroupUserList).toHaveBeenCalledWith(roomId, true)
    expect(chatStoreMock.getSessionList).toHaveBeenCalledWith(true)
    expect(chatStoreMock.removeDissolvedSession).toHaveBeenCalledWith(roomId)
  })

  it('群成员同步失败但服务端列表仍有该房间时，不应清理会话', async () => {
    const { handleMsgClick } = useMessage()
    const roomId = 'valid-room-id'
    const session = createGroupSession(roomId)

    groupStoreMock.getUserListByRoomId.mockReturnValue([])
    groupStoreMock.getGroupUserList.mockRejectedValue(new Error('网络超时'))

    // 强拉列表后房间仍在
    chatStoreMock.getSessionList.mockResolvedValue(undefined)
    chatStoreMock.getSession.mockReturnValue({ roomId } as SessionItem)

    await handleMsgClick(session)

    expect(chatStoreMock.getSessionList).toHaveBeenCalledWith(true)
    expect(chatStoreMock.removeDissolvedSession).not.toHaveBeenCalled()
  })

  it('群成员同步成功时，按原有路径执行，不触发兜底', async () => {
    const { handleMsgClick } = useMessage()
    const roomId = 'normal-room-id'
    const session = createGroupSession(roomId)

    groupStoreMock.getUserListByRoomId.mockReturnValue([{ uid: '10001' }])

    await handleMsgClick(session)

    expect(groupStoreMock.getGroupUserList).not.toHaveBeenCalled()
    expect(chatStoreMock.getSessionList).not.toHaveBeenCalled()
    expect(chatStoreMock.removeDissolvedSession).not.toHaveBeenCalled()
  })
})
