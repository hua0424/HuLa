import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-017 #200：group store 的 4 个 mutation action（exit/addAdmin/revokeAdmin/removeGroupMembers）
 * 全部以 showError:false 调底层——它们的调用方（dissolve/退出/设管理/踢人）均有领域失败 toast，
 * 底层 network_error toast 直出 = 双 toast（本 issue 的报障场景）。
 */

const imMocks = vi.hoisted(() => ({
  exitGroup: vi.fn().mockResolvedValue(undefined),
  addAdmin: vi.fn().mockResolvedValue(undefined),
  revokeAdmin: vi.fn().mockResolvedValue(undefined),
  removeGroupMember: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/utils/ImRequestUtils', () => imMocks)

const globalStoreMock = vi.hoisted(() => ({
  currentSessionRoomId: 'r1',
  updateCurrentSessionRoomId: vi.fn()
}))
vi.mock('@/stores/global', () => ({ useGlobalStore: () => globalStoreMock }))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ userInfo: { uid: 'me' } }) }))
vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({ removeSession: vi.fn(), sessionList: [] })
}))

import { useGroupStore } from '@/stores/group'

describe('group store #200 底层错误静默', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('exitGroup：showError:false（解散/退出链路均有领域 toast）', async () => {
    const groupStore = useGroupStore()
    await groupStore.exitGroup('r1')
    expect(imMocks.exitGroup).toHaveBeenCalledWith({ roomId: 'r1' }, expect.objectContaining({ showError: false }))
  })

  it('addAdmin：showError:false', async () => {
    const groupStore = useGroupStore()
    await groupStore.addAdmin(['u1'])
    expect(imMocks.addAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'r1', uidList: ['u1'] }),
      expect.objectContaining({ showError: false })
    )
  })

  it('revokeAdmin：showError:false', async () => {
    const groupStore = useGroupStore()
    await groupStore.revokeAdmin(['u1'])
    expect(imMocks.revokeAdmin).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ showError: false }))
  })

  it('removeGroupMembers：showError:false', async () => {
    const groupStore = useGroupStore()
    await groupStore.removeGroupMembers(['u1'], 'r1')
    expect(imMocks.removeGroupMember).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'r1', uidList: ['u1'] }),
      expect.objectContaining({ showError: false })
    )
  })

  it('底层失败照样抛给调用方（领域 toast 走 catch）', async () => {
    imMocks.exitGroup.mockRejectedValueOnce(new Error('network_error: error sending request'))
    const groupStore = useGroupStore()
    await expect(groupStore.exitGroup('r1')).rejects.toThrow('network_error')
  })
})
