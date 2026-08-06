import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-017 #200：persistMyRoomInfo 的 server 落盘调用静默底层错误——
 * 4 个调用方（Details 备注/本群昵称、ChatHeader 群资料、ChatSetting 设置）均有领域失败 toast，
 * 底层 network_error toast 直出会与之重复（双 toast）。
 */

const updateMyRoomInfoMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/utils/ImRequestUtils', () => ({
  updateMyRoomInfo: updateMyRoomInfoMock
}))

vi.mock('@/stores/cached', () => ({
  useCachedStore: () => ({
    syncRoomMembersToLocal: vi.fn().mockResolvedValue(true),
    updateMyRoomInfo: vi.fn().mockResolvedValue(true)
  })
}))
vi.mock('@/stores/chat', () => ({ useChatStore: () => ({ updateSession: vi.fn() }) }))
vi.mock('@/stores/group', () => ({ useGroupStore: () => ({ myNameInCurrentGroup: '', countInfo: null }) }))
vi.mock('@/stores/user.ts', () => ({ useUserStore: () => ({ userInfo: { uid: 'u1', name: 'me' } }) }))

import { useMyRoomInfoUpdater } from '@/hooks/useMyRoomInfoUpdater'

describe('useMyRoomInfoUpdater #200 底层错误静默', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('persistMyRoomInfo 以 showError:false 调 updateMyRoomInfo（领域 toast 由调用方负责）', async () => {
    const { persistMyRoomInfo } = useMyRoomInfoUpdater()
    await persistMyRoomInfo({ roomId: 'r1', myName: 'n', remark: 'x' })

    expect(updateMyRoomInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1', myName: 'n', remark: 'x' }),
      expect.objectContaining({ showError: false })
    )
  })

  it('server 落盘失败照样抛出（调用方 catch 出领域 toast），但不带底层 toast', async () => {
    updateMyRoomInfoMock.mockRejectedValueOnce(new Error('network_error: error sending request'))
    const { persistMyRoomInfo } = useMyRoomInfoUpdater()

    await expect(persistMyRoomInfo({ roomId: 'r1', myName: 'n', remark: '' })).rejects.toThrow('network_error')
    expect(updateMyRoomInfoMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ showError: false }))
  })
})
