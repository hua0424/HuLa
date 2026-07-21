import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * #179 Q2：权威同步落地守卫（启动抑制窗关闭 + 恢复态幽灵优雅移除+轻提示）合同。
 */

const chatStoreMock = {
  getSession: vi.fn(),
  getSessionList: vi.fn(),
  removeDissolvedSession: vi.fn(),
  isRoomInContactsSnapshot: vi.fn()
}
const globalStoreMock = {
  currentSessionRoomId: ''
}
const mittHandlers = new Map<string, (...args: any[]) => void>()

vi.mock('@/stores/chat', () => ({
  useChatStore: vi.fn(() => chatStoreMock)
}))
vi.mock('@/stores/global', () => ({
  useGlobalStore: vi.fn(() => globalStoreMock)
}))
vi.mock('@/hooks/useMitt', () => ({
  useMitt: {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => mittHandlers.set(event, handler)),
    off: vi.fn(),
    emit: vi.fn()
  }
}))
vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({
    t: vi.fn((key: string) => key)
  }))
}))

import { useGhostSessionGuard } from '@/hooks/useGhostSessionGuard'
import { armBootSuppression, isBootSuppressionActive } from '@/utils/errorToastSuppression'

describe('useGhostSessionGuard（#179 Q2）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mittHandlers.clear()
    globalStoreMock.currentSessionRoomId = ''
    chatStoreMock.isRoomInContactsSnapshot.mockResolvedValue(true)
    ;(window as any).$message = { info: vi.fn(), error: vi.fn() }
  })

  it('register 注册 CONTACTS_SYNCED 监听', () => {
    const { register } = useGhostSessionGuard()
    register()
    expect(mittHandlers.has('contactsSynced')).toBe(true)
  })

  it('同步落地关闭启动抑制窗（宽限期后）', async () => {
    vi.useFakeTimers()
    try {
      armBootSuppression()
      expect(isBootSuppressionActive()).toBe(true)

      const { handleContactsSynced } = useGhostSessionGuard()
      chatStoreMock.getSessionList.mockResolvedValue(undefined)
      chatStoreMock.getSession.mockReturnValue({ roomId: 'r1' })
      globalStoreMock.currentSessionRoomId = 'r1'

      await handleContactsSynced()

      // 宽限期内仍关窗流程中，5s 后关闭
      expect(isBootSuppressionActive()).toBe(true)
      await vi.advanceTimersByTimeAsync(5000)
      expect(isBootSuppressionActive()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('恢复态幽灵（当前会话不在权威快照）：移除 + 「该群聊已解散」轻提示', async () => {
    const { handleContactsSynced } = useGhostSessionGuard()
    globalStoreMock.currentSessionRoomId = 'ghost-room'
    chatStoreMock.getSessionList.mockResolvedValue(undefined)
    chatStoreMock.isRoomInContactsSnapshot.mockResolvedValue(false)

    await handleContactsSynced()

    expect(chatStoreMock.getSessionList).toHaveBeenCalledWith(true)
    expect(chatStoreMock.isRoomInContactsSnapshot).toHaveBeenCalledWith('ghost-room')
    expect(chatStoreMock.removeDissolvedSession).toHaveBeenCalledWith('ghost-room')
    expect((window as any).$message.info).toHaveBeenCalledTimes(1)
    expect((window as any).$message.info).toHaveBeenCalledWith('message.message_menu.group_dissolved')
  })

  it('同一 roomId 重复触发（兜底与守卫双路径）只提示一次（R5-P2）', async () => {
    const { handleContactsSynced } = useGhostSessionGuard()
    globalStoreMock.currentSessionRoomId = 'ghost-room-dup'
    chatStoreMock.getSessionList.mockResolvedValue(undefined)
    chatStoreMock.isRoomInContactsSnapshot.mockResolvedValue(false)

    await handleContactsSynced()
    await handleContactsSynced()

    expect(chatStoreMock.removeDissolvedSession).toHaveBeenCalledTimes(2)
    expect((window as any).$message.info).toHaveBeenCalledTimes(1)
  })

  it('当前会话仍在权威快照：不移除、不提示', async () => {
    const { handleContactsSynced } = useGhostSessionGuard()
    globalStoreMock.currentSessionRoomId = 'valid-room'
    chatStoreMock.getSessionList.mockResolvedValue(undefined)
    chatStoreMock.isRoomInContactsSnapshot.mockResolvedValue(true)

    await handleContactsSynced()

    expect(chatStoreMock.removeDissolvedSession).not.toHaveBeenCalled()
    expect((window as any).$message.info).not.toHaveBeenCalled()
  })

  it('无当前会话：只刷新列表，不移除不提示', async () => {
    const { handleContactsSynced } = useGhostSessionGuard()
    globalStoreMock.currentSessionRoomId = ''
    chatStoreMock.getSessionList.mockResolvedValue(undefined)

    await handleContactsSynced()

    expect(chatStoreMock.removeDissolvedSession).not.toHaveBeenCalled()
    expect((window as any).$message.info).not.toHaveBeenCalled()
  })
})
