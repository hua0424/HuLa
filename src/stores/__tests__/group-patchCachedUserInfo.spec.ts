import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-015 #186 F1：group store patchCachedUserInfo。
 * aiclaw 改名成功后直接修补本地缓存（好友缓存 + 各群成员列表），
 * 让好友列表/会话/群成员中的展示名即时生效，不必等下次全量拉取。
 */

vi.mock('@/utils/ImRequestUtils', () => ({
  groupListMember: vi.fn().mockResolvedValue([])
}))

vi.mock('@/stores/global', () => ({
  useGlobalStore: vi.fn(() => ({
    currentSessionRoomId: '',
    currentSession: null
  }))
}))
vi.mock('@/stores/user', () => ({
  useUserStore: vi.fn(() => ({
    userInfo: { uid: '10001' }
  }))
}))
vi.mock('@/stores/chat', () => ({
  useChatStore: vi.fn(() => ({
    getSession: (roomId: string) => ({ roomId, type: 1 })
  }))
}))

import { useGroupStore } from '@/stores/group'

describe('useGroupStore patchCachedUserInfo（REQ-015 #186）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('修补 friendInfoCache 中已缓存用户的名称', () => {
    const groupStore = useGroupStore()
    groupStore.cacheFriendInfo('2001', { name: '旧名字', userType: 4 })

    groupStore.patchCachedUserInfo('2001', { name: '新名字' })

    expect(groupStore.getUserInfo('2001')?.name).toBe('新名字')
  })

  it('uid 数字/字符串混用时按字符串归一命中', () => {
    const groupStore = useGroupStore()
    groupStore.cacheFriendInfo('2001', { name: '旧名字', userType: 4 })

    groupStore.patchCachedUserInfo(2001 as unknown as string, { name: '新名字' })

    expect(groupStore.getUserInfo('2001')?.name).toBe('新名字')
  })

  it('缓存中不存在该用户时不报错、不播种', () => {
    const groupStore = useGroupStore()

    expect(() => groupStore.patchCachedUserInfo('9999', { name: '不存在' })).not.toThrow()
    expect(groupStore.getUserInfo('9999')).toBeUndefined()
  })
})
