import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RoomTypeEnum } from '@/enums'

/**
 * REQ-016 #194 F1：userInfoChange 帧处理（PRD #190 裁决 2）。
 * server 契约：WS 帧 userInfoChange，data { uid, changeType: 'profile' | 'remark' }。
 * - profile：失效缓存重拉（getUserByIds）→ patchCachedUserInfo → patch 会话列表快照名/头像
 *   （聊天头部 activeItem 是同一 session 快照的 computed，随 updateSession 自动刷新）
 * - remark：备注 per-user 私有、帧不带值 → 刷新本人联系人列表拿权威 remark，
 *   会话显示名按「备注优先」重算
 */

const chatStoreMocks = vi.hoisted(() => ({
  sessionList: [] as any[],
  updateSession: vi.fn()
}))
vi.mock('@/stores/chat', () => ({
  useChatStore: () => chatStoreMocks
}))

const contactStoreMocks = vi.hoisted(() => ({
  contactsList: [] as any[],
  getContactList: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/stores/contacts', () => ({
  useContactStore: () => contactStoreMocks
}))

const groupStoreMocks = vi.hoisted(() => ({
  patchCachedUserInfo: vi.fn()
}))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => groupStoreMocks
}))

const userStoreMocks = vi.hoisted(() => ({
  userInfo: { uid: '999', name: '我自己', avatar: 'me.png' } as any
}))
vi.mock('@/stores/user', () => ({
  useUserStore: () => userStoreMocks
}))

const getUserByIdsMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  getUserByIds: (...args: unknown[]) => getUserByIdsMock(...args)
}))

import { handleUserInfoChange } from '@/utils/userInfoChange'

const singleSession = (overrides: Record<string, unknown> = {}) => ({
  roomId: 'room-s1',
  type: RoomTypeEnum.SINGLE,
  detailId: '1001',
  name: '旧名字',
  avatar: 'old.png',
  ...overrides
})

const groupSession = (overrides: Record<string, unknown> = {}) => ({
  roomId: 'room-g1',
  type: RoomTypeEnum.GROUP,
  detailId: 'room-g1',
  name: '测试群',
  avatar: 'group.png',
  ...overrides
})

describe('handleUserInfoChange（REQ-016 #194 F1）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    chatStoreMocks.sessionList = [singleSession(), groupSession()]
    contactStoreMocks.contactsList = []
    contactStoreMocks.getContactList.mockResolvedValue(undefined)
    userStoreMocks.userInfo = { uid: '999', name: '我自己', avatar: 'me.png' }
    getUserByIdsMock.mockResolvedValue([{ uid: '1001', name: '新名字', avatar: 'new.png', resume: '新简介' }])
  })

  it('profile 帧：重拉用户信息并 patch 缓存 + 单聊会话快照名/头像', async () => {
    await handleUserInfoChange({ uid: '1001', changeType: 'profile' })

    expect(getUserByIdsMock).toHaveBeenCalledWith(['1001'])
    expect(groupStoreMocks.patchCachedUserInfo).toHaveBeenCalledWith('1001', {
      name: '新名字',
      avatar: 'new.png',
      resume: '新简介'
    })
    expect(chatStoreMocks.updateSession).toHaveBeenCalledWith('room-s1', { name: '新名字', avatar: 'new.png' })
    // 群聊会话不受影响
    expect(chatStoreMocks.updateSession).toHaveBeenCalledTimes(1)
    // profile 帧不需要全量刷联系人
    expect(contactStoreMocks.getContactList).not.toHaveBeenCalled()
  })

  it('profile 帧：有备注时会话显示名按备注优先', async () => {
    contactStoreMocks.contactsList = [{ uid: '1001', remark: '小安' }]

    await handleUserInfoChange({ uid: '1001', changeType: 'profile' })

    expect(chatStoreMocks.updateSession).toHaveBeenCalledWith('room-s1', { name: '小安', avatar: 'new.png' })
  })

  it('remark 帧：先刷新联系人列表拿权威备注，再按备注优先 patch 会话', async () => {
    contactStoreMocks.getContactList.mockImplementation(async () => {
      contactStoreMocks.contactsList = [{ uid: '1001', remark: '老板' }]
    })

    await handleUserInfoChange({ uid: '1001', changeType: 'remark' })

    expect(contactStoreMocks.getContactList).toHaveBeenCalledWith(true)
    expect(chatStoreMocks.updateSession).toHaveBeenCalledWith('room-s1', { name: '老板', avatar: 'new.png' })
  })

  it('remark 帧：备注被清空时回退到权威昵称', async () => {
    chatStoreMocks.sessionList = [singleSession({ name: '旧备注名' })]
    contactStoreMocks.getContactList.mockImplementation(async () => {
      contactStoreMocks.contactsList = [{ uid: '1001', remark: '' }]
    })

    await handleUserInfoChange({ uid: '1001', changeType: 'remark' })

    expect(chatStoreMocks.updateSession).toHaveBeenCalledWith('room-s1', { name: '新名字', avatar: 'new.png' })
  })

  it('本人 uid 的 profile 帧：同步 userStore.userInfo', async () => {
    getUserByIdsMock.mockResolvedValue([{ uid: '999', name: '我的新名', avatar: 'me2.png', resume: '我的简介' }])

    await handleUserInfoChange({ uid: '999', changeType: 'profile' })

    expect(userStoreMocks.userInfo.name).toBe('我的新名')
    expect(userStoreMocks.userInfo.avatar).toBe('me2.png')
    expect(userStoreMocks.userInfo.resume).toBe('我的简介')
  })

  it('getUserByIds 失败时不抛异常、不写缓存', async () => {
    getUserByIdsMock.mockRejectedValue(new Error('network'))

    await expect(handleUserInfoChange({ uid: '1001', changeType: 'profile' })).resolves.toBeUndefined()
    expect(groupStoreMocks.patchCachedUserInfo).not.toHaveBeenCalled()
  })

  it('uid 缺省时直接忽略', async () => {
    await handleUserInfoChange({} as any)
    expect(getUserByIdsMock).not.toHaveBeenCalled()
  })

  it('数字 uid 归一为字符串后同样命中', async () => {
    await handleUserInfoChange({ uid: 1001, changeType: 'profile' })
    expect(getUserByIdsMock).toHaveBeenCalledWith(['1001'])
    expect(chatStoreMocks.updateSession).toHaveBeenCalledWith('room-s1', { name: '新名字', avatar: 'new.png' })
  })
})
