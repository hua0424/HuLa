import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#229（#209 review 遗留 tranche-2）store 级行为锁：
 * - getContactList：全部调用点均为 WS 推送 / 窗口初始化 / 操作后顺带刷新（reviewer P2-2
 *   口径「WS 推送/窗口初始化触发」），失败已有 catch + console.error，不应再弹裸 toast
 * - cached.getAllBadgeList：唯一调用点为登录初始化后台，修复前双层提示
 *   （imRequest AppException toast + catch 内 window.$message.error），收为静默+日志
 */

const getFriendPageMock = vi.hoisted(() => vi.fn())
const getBadgesBatchMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  getFriendPage: (...args: any[]) => getFriendPageMock(...args),
  getBadgesBatch: (...args: any[]) => getBadgesBatchMock(...args),
  getAnnouncementList: vi.fn(),
  deleteFriend: vi.fn(),
  getNoticeUnreadCount: vi.fn(),
  handleInvite: vi.fn(),
  requestNoticePage: vi.fn()
}))

vi.mock('@/utils/UnreadCountManager', () => ({
  unreadCountManager: {
    refreshBadge: vi.fn(),
    calculateTotal: vi.fn(),
    setUpdateCallback: vi.fn(),
    requestUpdate: vi.fn()
  }
}))

vi.mock('@/stores/global', () => ({
  useGlobalStore: vi.fn(() => ({ currentSessionRoomId: '', currentSession: null, unReadMark: {} }))
}))
vi.mock('@/stores/feed', () => ({ useFeedStore: vi.fn(() => ({ unreadCount: 0 })) }))
vi.mock('@/stores/user', () => ({ useUserStore: vi.fn(() => ({ userInfo: { uid: '10001' } })) }))
vi.mock('@/stores/chat', () => ({ useChatStore: vi.fn(() => ({ getSession: () => undefined })) }))

import { useContactStore } from '@/stores/contacts'
import { useCachedStore } from '@/stores/cached'

describe('#229 getContactList 内部统一静默（调用点全为后台路径）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getFriendPageMock.mockReset().mockResolvedValue({ list: [], cursor: '', isLast: true })
  })

  it('getContactList 拉好友分页带 showError:false（WS 推送/窗口初始化不再弹裸 toast）', async () => {
    await useContactStore().getContactList(true)
    expect(getFriendPageMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ showError: false }))
  })

  it('失败路径仍有 console.error 留痕（静默不等于无日志）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getFriendPageMock.mockRejectedValue(new Error('network down'))

    await useContactStore().getContactList(true)

    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('#229 cached.getAllBadgeList 登录初始化后台静默', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getBadgesBatchMock.mockReset().mockResolvedValue([])
  })

  it('拉徽章带 showError:false，失败只 console.error 不再 window.$message.error（消双层提示）', async () => {
    const messageError = vi.fn()
    ;(window as any).$message = { error: messageError }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getBadgesBatchMock.mockRejectedValue(new Error('network down'))

    await useCachedStore().getAllBadgeList()

    expect(getBadgesBatchMock).toHaveBeenCalledWith([], expect.objectContaining({ showError: false }))
    expect(errorSpy).toHaveBeenCalled()
    expect(messageError).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
