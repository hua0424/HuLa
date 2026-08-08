import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#221/#222 同根修复：好友分页响应（FriendResp）本已带 name/avatar/account，
 * getContactList 播种 friendInfoCache 时一并写入。
 *
 * 修复前只写 activeStatus/lastOptTime/userType——「无共同群的好友」（如只在单聊的
 * CodexAI/ClaudeCodeAI）因此进不了任何 userListMap，getUserInfo 三层查找落空：
 * 建群穿梭框源列表空名渲染（#221）、私聊思考卡标题泛化「AI」（#222）。
 */

const getFriendPageMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  getFriendPage: (...args: any[]) => getFriendPageMock(...args),
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
  useGlobalStore: vi.fn(() => ({
    currentSessionRoomId: '',
    currentSession: null,
    unReadMark: {}
  }))
}))
vi.mock('@/stores/feed', () => ({
  useFeedStore: vi.fn(() => ({ unreadCount: 0 }))
}))
vi.mock('@/stores/user', () => ({
  useUserStore: vi.fn(() => ({
    userInfo: { uid: '10001' }
  }))
}))
vi.mock('@/stores/chat', () => ({
  useChatStore: vi.fn(() => ({
    getSession: (_roomId: string) => undefined
  }))
}))

import { useContactStore } from '@/stores/contacts'
import { useGroupStore } from '@/stores/group'

const pageWith = (list: any[]) => ({ list, cursor: '', isLast: true })

describe('#221/#222 getContactList 播种 friendInfoCache 名字段', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getFriendPageMock.mockReset().mockResolvedValue(pageWith([]))
  })

  it('好友分页项的 name/avatar/account 写入 friendInfoCache：无共同群好友经 getUserInfo 可解析名字', async () => {
    getFriendPageMock.mockResolvedValue(
      pageWith([
        {
          uid: '9001',
          name: 'CodexAI',
          avatar: 'https://x/codex.png',
          account: 'codexai',
          remark: '',
          activeStatus: 1,
          lastOptTime: 0,
          userType: 4
        }
      ])
    )

    await useContactStore().getContactList(true)

    const info = useGroupStore().getUserInfo('9001')
    expect(info?.name).toBe('CodexAI')
    expect(info?.avatar).toBe('https://x/codex.png')
    expect(info?.account).toBe('codexai')
  })

  it('分页项缺 name 字段时不覆盖已有缓存名（防回退：局部信息不得抹掉全量补丁）', async () => {
    const groupStore = useGroupStore()
    groupStore.cacheFriendInfo('9002', { name: '安洁', avatar: 'old.png' } as any)

    getFriendPageMock.mockResolvedValue(
      pageWith([{ uid: '9002', remark: '', activeStatus: 2, lastOptTime: 0, userType: 4 }])
    )
    await useContactStore().getContactList(true)

    const info = groupStore.getUserInfo('9002')
    expect(info?.name).toBe('安洁')
    expect(info?.avatar).toBe('old.png')
  })

  it('分页项带新名时刷新缓存（改名经好友分页传播）', async () => {
    const groupStore = useGroupStore()
    groupStore.cacheFriendInfo('9003', { name: '旧名' } as any)

    getFriendPageMock.mockResolvedValue(
      pageWith([{ uid: '9003', name: '新名', remark: '', activeStatus: 1, lastOptTime: 0, userType: 4 }])
    )
    await useContactStore().getContactList(true)

    expect(groupStore.getUserInfo('9003')?.name).toBe('新名')
  })
})
