import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-017 #208：userListMap 治本——退群/解散/被踢时清理本地成员缓存。
 * 旧行为：exitGroup 只把自己从成员列表过滤掉，房间内其他成员（含 aiclaw）残留，
 * getRoomIdsByUid(aiclawUid) 继续返回陈旧 roomId，驱动 aiclaw 群配置遍历打 server 必炸（#196 治标已静默）。
 * 治本：生命周期终点整键清除 userListMap[roomId] 及派生缓存（memberOrderCounters/onlineCountMap）。
 */

const imMocks = vi.hoisted(() => ({
  exitGroup: vi.fn().mockResolvedValue(undefined)
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

describe('group store #208 房间生命周期终点清成员缓存', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  const seedRoom = (groupStore: ReturnType<typeof useGroupStore>) => {
    // 模拟已有成员缓存：我 + 一个 aiclaw 成员
    groupStore.updateMemberCache('r1', [
      { uid: 'me', name: 'me' },
      { uid: 'ai-1', name: 'aiclaw' }
    ] as any)
    expect(groupStore.getRoomIdsByUid('ai-1')).toContain('r1')
  }

  it('exitGroup（退群/解散共用入口）成功后整键清除成员缓存', async () => {
    const groupStore = useGroupStore()
    seedRoom(groupStore)

    await groupStore.exitGroup('r1')

    // 验收：getRoomIdsByUid 不再返回该房间（不依赖客户端重启）
    expect(groupStore.getRoomIdsByUid('ai-1')).not.toContain('r1')
    expect(groupStore.getRoomIdsByUid('me')).not.toContain('r1')
    expect(groupStore.userListMap['r1']).toBeUndefined()
    expect(groupStore.onlineCountMap['r1']).toBeUndefined()
  })

  it('removeAllUsers（被踢路径 handleSelfRemove 用）整键清除而非置空数组', () => {
    const groupStore = useGroupStore()
    seedRoom(groupStore)

    groupStore.removeAllUsers('r1')

    expect(groupStore.userListMap['r1']).toBeUndefined()
    expect(groupStore.getRoomIdsByUid('ai-1')).not.toContain('r1')
  })

  it('exitGroup 失败（HTTP 未达 server）不清成员缓存', async () => {
    const groupStore = useGroupStore()
    seedRoom(groupStore)
    imMocks.exitGroup.mockRejectedValueOnce(new Error('network offline'))

    await expect(groupStore.exitGroup('r1')).rejects.toThrow()

    // 退出未生效 = 我仍是成员，缓存应保留（由回滚/重试语义决定）
    expect(groupStore.getRoomIdsByUid('ai-1')).toContain('r1')
  })
})
