import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#179 TC-03：group store 成员拉取的错误提示抑制合同。
 *
 * - 选中会话窗口内（suppressMemberFetchError）底层拉取以 showError:false 发起；
 * - 确认解散的房间（markRoomDissolved）成员拉取直接短路，不再发请求。
 */

const groupListMemberMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  groupListMember: (...args: any[]) => groupListMemberMock(...args)
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

describe('useGroupStore 成员拉取错误提示抑制（#179 TC-03）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    groupListMemberMock.mockReset().mockResolvedValue([])
  })

  it('默认路径：底层请求保持原有错误提示行为（showError: true）', async () => {
    const groupStore = useGroupStore()
    await groupStore.getGroupUserList('room-1', true)

    expect(groupListMemberMock).toHaveBeenCalledWith('room-1', { showError: true })
  })

  it('suppressMemberFetchError 窗口内：底层请求以 showError:false 发起；延迟释放后恢复', async () => {
    vi.useFakeTimers()
    try {
      const groupStore = useGroupStore()

      groupStore.suppressMemberFetchError('room-1')
      await groupStore.getGroupUserList('room-1', true)
      expect(groupListMemberMock).toHaveBeenLastCalledWith('room-1', { showError: false })

      // 释放是 5s 延迟生效：覆盖点击后组件挂载的迟到成员拉取（TC-03 漏弹教训）
      groupStore.releaseMemberFetchError('room-1')
      await groupStore.getGroupUserList('room-1', true)
      expect(groupListMemberMock).toHaveBeenLastCalledWith('room-1', { showError: false })

      await vi.advanceTimersByTimeAsync(5000)
      await groupStore.getGroupUserList('room-1', true)
      expect(groupListMemberMock).toHaveBeenLastCalledWith('room-1', { showError: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('markRoomDissolved 后：成员拉取直接短路返回空列表，不再发起请求', async () => {
    const groupStore = useGroupStore()

    groupStore.markRoomDissolved('room-1')
    const result = await groupStore.getGroupUserList('room-1', true)

    expect(result).toEqual([])
    expect(groupListMemberMock).not.toHaveBeenCalled()
  })
})
