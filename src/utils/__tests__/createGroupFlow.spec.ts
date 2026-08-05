import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-016 #195 F3：建群防重 + 群名 + 链路提速（PRD #190 裁决 3）。
 * - creating 防重：并发调用只发一次 createGroup
 * - 群名入 body（空则不带 groupName 字段）
 * - 提速：配置弹窗不等 getSessionList 全量重拉（后台化），先开弹窗、异步补
 */

const createGroupMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  createGroup: (...args: unknown[]) => createGroupMock(...args)
}))

const chatStoreMocks = vi.hoisted(() => ({
  sessionList: [] as any[],
  getSessionList: vi.fn()
}))
vi.mock('@/stores/chat', () => ({
  useChatStore: () => chatStoreMocks
}))

const groupStoreMocks = vi.hoisted(() => ({
  addGroupDetail: vi.fn().mockResolvedValue(undefined),
  getGroupUserList: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => groupStoreMocks
}))

const aiclawStoreMocks = vi.hoisted(() => ({
  ensureLoaded: vi.fn().mockResolvedValue(undefined),
  isMyAiclaw: vi.fn((uid: string | number) => String(uid) === '2001'),
  getAdapterType: vi.fn(() => 'opencode'),
  getName: vi.fn((uid: string | number) => (String(uid) === '2001' ? '安洁' : undefined))
}))
vi.mock('@/stores/aiclaw', () => ({
  useAiclawStore: () => aiclawStoreMocks
}))

import { createGroupFlow } from '@/utils/createGroupFlow'

const flush = () => new Promise((r) => setTimeout(r, 10))

describe('createGroupFlow（REQ-016 #195 F3）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    chatStoreMocks.sessionList = []
    chatStoreMocks.getSessionList.mockResolvedValue(undefined)
    groupStoreMocks.addGroupDetail.mockResolvedValue(undefined)
    groupStoreMocks.getGroupUserList.mockResolvedValue(undefined)
    aiclawStoreMocks.ensureLoaded.mockResolvedValue(undefined)
    createGroupMock.mockResolvedValue({ roomId: 'room-new' })
  })

  it('群名入 body；空群名不带 groupName 字段', async () => {
    await createGroupFlow({ uidList: ['2001', '2002'], groupName: '  周五攻关组  ', onOpenBatchConfig: vi.fn() })
    expect(createGroupMock).toHaveBeenCalledWith({ uidList: ['2001', '2002'], groupName: '周五攻关组' })

    createGroupMock.mockClear()
    await createGroupFlow({ uidList: ['2001', '2002'], groupName: '   ', onOpenBatchConfig: vi.fn() })
    expect(createGroupMock).toHaveBeenCalledWith({ uidList: ['2001', '2002'] })
  })

  it('防重：并发调用只发一次 createGroup', async () => {
    let release: (v: unknown) => void
    createGroupMock.mockReturnValue(new Promise((r) => (release = r)))

    const onOpen = vi.fn()
    const p1 = createGroupFlow({ uidList: ['2001', '2002'], onOpenBatchConfig: onOpen })
    const p2 = createGroupFlow({ uidList: ['2001', '2002'], onOpenBatchConfig: onOpen })
    release!({ roomId: 'room-new' })
    await Promise.all([p1, p2])

    expect(createGroupMock).toHaveBeenCalledTimes(1)
  })

  it('提速：getSessionList 未完成时配置弹窗已打开（全量重拉后台化）', async () => {
    let releaseList: (v: unknown) => void
    chatStoreMocks.getSessionList.mockReturnValue(new Promise((r) => (releaseList = r)))

    const onOpen = vi.fn()
    const done = createGroupFlow({ uidList: ['2001', '2002'], onOpenBatchConfig: onOpen })
    await done

    // 全量会话重拉仍在途，但弹窗已开
    expect(onOpen).toHaveBeenCalledWith('room-new', [{ uid: '2001', name: '安洁', adapterType: 'opencode' }])

    // 收尾，避免在途 promise 泄漏到后续用例
    releaseList!(undefined)
    await flush()
  })

  it('后台会话重拉完成后按 roomId 匹配回调 onSessionReady', async () => {
    chatStoreMocks.getSessionList.mockImplementation(async () => {
      chatStoreMocks.sessionList = [{ roomId: 'room-new', detailId: 'g1' }]
    })
    const onSessionReady = vi.fn()
    await createGroupFlow({ uidList: ['2001', '2002'], onOpenBatchConfig: vi.fn(), onSessionReady })
    await flush()

    expect(onSessionReady).toHaveBeenCalledWith('room-new')
  })

  it('群详情/成员补拉后台化，不阻塞返回', async () => {
    let releaseDetail: (v: unknown) => void
    groupStoreMocks.addGroupDetail.mockReturnValue(new Promise((r) => (releaseDetail = r)))

    const onOpen = vi.fn()
    await createGroupFlow({ uidList: ['2001', '2002'], onOpenBatchConfig: onOpen })

    // 详情补拉未完成，弹窗已开
    expect(onOpen).toHaveBeenCalled()
    releaseDetail!(undefined)
    await flush()
  })

  it('选中成员无我的 aiclaw 时不开配置弹窗', async () => {
    aiclawStoreMocks.isMyAiclaw.mockReturnValue(false)
    const onOpen = vi.fn()
    const result = await createGroupFlow({ uidList: ['3001', '3002'], onOpenBatchConfig: onOpen })

    expect(onOpen).not.toHaveBeenCalled()
    expect(result.roomId).toBe('room-new')
  })

  it('createGroup 失败向上抛出（调用方 toast），finally 复位防重标志', async () => {
    createGroupMock.mockRejectedValueOnce(new Error('server busy'))
    await expect(createGroupFlow({ uidList: ['2001', '2002'], onOpenBatchConfig: vi.fn() })).rejects.toThrow(
      'server busy'
    )

    // 失败后防重标志已复位，可再次发起
    createGroupMock.mockResolvedValueOnce({ roomId: 'room-retry' })
    const result = await createGroupFlow({ uidList: ['2001', '2002'], onOpenBatchConfig: vi.fn() })
    expect(result.roomId).toBe('room-retry')
    expect(createGroupMock).toHaveBeenCalledTimes(2)
  })
})
