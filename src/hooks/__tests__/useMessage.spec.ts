import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useMessage } from '@/hooks/useMessage'
import { RoomTypeEnum } from '@/enums'
import type { SessionItem } from '@/services/types'

const chatStoreMock = {
  getSession: vi.fn(),
  getSessionList: vi.fn(),
  markSessionRead: vi.fn(),
  removeDissolvedSession: vi.fn(),
  sessionOptions: { isLoading: false }
}

const globalStoreMock = {
  updateCurrentSessionRoomId: vi.fn()
}

const groupStoreMock = {
  getUserListByRoomId: vi.fn(),
  getGroupUserList: vi.fn(),
  suppressMemberFetchError: vi.fn(),
  releaseMemberFetchError: vi.fn()
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

const mittHandlers = new Map<string, (...args: any[]) => void>()
vi.mock('@/hooks/useMitt', () => ({
  useMitt: {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => mittHandlers.set(event, handler)),
    off: vi.fn((event: string) => mittHandlers.delete(event)),
    emit: vi.fn()
  }
}))
const fireContactsSynced = () => mittHandlers.get('contactsSynced')?.()

vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({
    t: vi.fn((key: string) => key)
  }))
}))

describe('useMessage handleMsgClick 幽灵会话兜底清理', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mittHandlers.clear()
    chatStoreMock.sessionOptions.isLoading = false
    ;(window as any).$message = { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() }
  })

  const createGroupSession = (roomId: string): SessionItem =>
    ({
      roomId,
      type: RoomTypeEnum.GROUP,
      unreadCount: 0
    }) as SessionItem

  it('群成员同步失败且权威同步后房间已消失时，应清理幽灵会话并轻提示，不弹网络错误', async () => {
    const { handleMsgClick } = useMessage()
    const roomId = 'ghost-room-id'
    const session = createGroupSession(roomId)

    // 本地成员列表不含当前用户，触发 getGroupUserList
    groupStoreMock.getUserListByRoomId.mockReturnValue([])
    groupStoreMock.getGroupUserList.mockRejectedValue(new Error('房间号有误'))

    // 兜底触发同步 → CONTACTS_SYNCED 落地后房间消失（桌面端本地库被全量同步重写）
    chatStoreMock.getSessionList.mockImplementation(async () => {
      fireContactsSynced()
    })
    chatStoreMock.getSession.mockReturnValueOnce({ roomId } as SessionItem).mockReturnValue(undefined)

    await handleMsgClick(session)

    expect(globalStoreMock.updateCurrentSessionRoomId).toHaveBeenCalledWith(roomId)
    expect(chatStoreMock.getSession).toHaveBeenCalledWith(roomId)
    expect(chatStoreMock.markSessionRead).toHaveBeenCalledWith(roomId)
    expect(groupStoreMock.getGroupUserList).toHaveBeenCalledWith(roomId, true)
    expect(chatStoreMock.getSessionList).toHaveBeenCalledWith(true)
    expect(chatStoreMock.removeDissolvedSession).toHaveBeenCalledWith(roomId)

    // 抑制窗口覆盖整个选中过程（TC-03 合同）
    expect(groupStoreMock.suppressMemberFetchError).toHaveBeenCalledWith(roomId)
    expect(groupStoreMock.releaseMemberFetchError).toHaveBeenCalledWith(roomId)
    // 优雅轻提示 + 不弹网络错误
    expect((window as any).$message.info).toHaveBeenCalledTimes(1)
    expect((window as any).$message.info).toHaveBeenCalledWith('message.message_menu.group_dissolved')
    expect((window as any).$message.error).not.toHaveBeenCalled()
  })

  it('群成员同步失败但权威同步后房间仍在时，不应清理会话，补回一次网络错误提示', async () => {
    const { handleMsgClick } = useMessage()
    const roomId = 'valid-room-id'
    const session = createGroupSession(roomId)

    groupStoreMock.getUserListByRoomId.mockReturnValue([])
    groupStoreMock.getGroupUserList.mockRejectedValue(new Error('网络超时'))

    chatStoreMock.getSessionList.mockImplementation(async () => {
      fireContactsSynced()
    })
    chatStoreMock.getSession.mockReturnValue({ roomId } as SessionItem)

    await handleMsgClick(session)

    expect(chatStoreMock.getSessionList).toHaveBeenCalledWith(true)
    expect(chatStoreMock.removeDissolvedSession).not.toHaveBeenCalled()
    // 维持原有网络错误提示行为（一次），不解散轻提示
    expect((window as any).$message.error).toHaveBeenCalledTimes(1)
    expect((window as any).$message.error).toHaveBeenCalledWith('网络超时')
    expect((window as any).$message.info).not.toHaveBeenCalled()
  })

  it('群成员同步成功时，按原有路径执行，不触发兜底也无任何提示', async () => {
    const { handleMsgClick } = useMessage()
    const roomId = 'normal-room-id'
    const session = createGroupSession(roomId)

    groupStoreMock.getUserListByRoomId.mockReturnValue([{ uid: '10001' }])

    await handleMsgClick(session)

    expect(groupStoreMock.getGroupUserList).not.toHaveBeenCalled()
    expect(chatStoreMock.getSessionList).not.toHaveBeenCalled()
    expect(chatStoreMock.removeDissolvedSession).not.toHaveBeenCalled()
    expect((window as any).$message.error).not.toHaveBeenCalled()
    expect((window as any).$message.info).not.toHaveBeenCalled()
    // 抑制标志正常成对释放
    expect(groupStoreMock.suppressMemberFetchError).toHaveBeenCalledWith(roomId)
    expect(groupStoreMock.releaseMemberFetchError).toHaveBeenCalledWith(roomId)
  })

  it('CONTACTS_SYNCED 未落地前不做判定：本地旧快照含幽灵也不误弹网络错误', async () => {
    const { handleMsgClick } = useMessage()
    const roomId = 'ghost-race-room'
    const session = createGroupSession(roomId)

    groupStoreMock.getUserListByRoomId.mockReturnValue([])
    groupStoreMock.getGroupUserList.mockRejectedValue(new Error('房间号有误'))

    // 桌面端语义：getSessionList 先回本地旧快照（含幽灵），
    // 300ms 后全量同步落地才发射 CONTACTS_SYNCED 并让房间消失
    chatStoreMock.getSessionList.mockImplementation(async () => {
      setTimeout(() => {
        chatStoreMock.getSession.mockReturnValue(undefined)
        fireContactsSynced()
      }, 300)
    })
    chatStoreMock.getSession.mockReturnValue({ roomId } as SessionItem)

    const clickPromise = handleMsgClick(session)

    // 100ms 时（同步未落地）：不得提前误判误弹
    await new Promise((r) => setTimeout(r, 100))
    expect((window as any).$message.error).not.toHaveBeenCalled()
    expect(chatStoreMock.removeDissolvedSession).not.toHaveBeenCalled()

    await clickPromise

    expect(chatStoreMock.removeDissolvedSession).toHaveBeenCalledWith(roomId)
    expect((window as any).$message.info).toHaveBeenCalledWith('message.message_menu.group_dissolved')
    expect((window as any).$message.error).not.toHaveBeenCalled()
  })
})
