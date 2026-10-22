import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-016 #196 F5：复数版 loadAiclawGroupConfigs（管理窗批量场景）单房间失败改静默。
 * userListMap 残留（退群/解散后 aiclaw 仍挂旧房间）会让陈旧房间 server membership 校验必炸，
 * 每个失败房间都弹全局 toast = 误报风暴。单房间请求必须 showError:false，由调用方按返回
 * boolean 自行决定提示，且单房间失败不影响其余房间入库。
 */
vi.hoisted(() => {
  class WorkerStub {
    onerror: ((e: unknown) => void) | null = null
    postMessage() {}
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  }
  globalThis.Worker = WorkerStub as unknown as typeof Worker
})

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getByLabel: vi.fn().mockResolvedValue(null), getCurrent: vi.fn() }
}))
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))
vi.mock('@tauri-apps/plugin-notification', () => ({
  sendNotification: vi.fn(),
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue('granted')
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/message' }),
  useRouter: () => ({ push: vi.fn() })
}))

const imRequestMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: (...args: unknown[]) => imRequestMock(...args),
  markMsgRead: vi.fn().mockResolvedValue(undefined),
  getSessionDetail: vi.fn().mockResolvedValue({
    roomId: 'room-1',
    activeTime: Date.now(),
    unreadCount: 0,
    text: '',
    type: 1,
    name: 'test-room',
    avatar: ''
  })
}))
vi.mock('@/utils/RenderReplyContent.ts', () => ({
  renderReplyContent: vi.fn().mockImplementation((_name, _type, content) => content)
}))
vi.mock('@/utils/UnreadCountManager', () => ({
  unreadCountManager: {
    refreshBadge: vi.fn(),
    calculateTotal: vi.fn(),
    setUpdateCallback: vi.fn(),
    requestUpdate: vi.fn()
  }
}))
vi.mock('@/utils/TauriInvokeHandler', () => ({
  invokeWithErrorHandler: vi.fn().mockResolvedValue(undefined),
  invokeSilently: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({ currentSessionRoomId: '' })
}))
vi.mock('@/stores/user', () => ({
  useUserStore: () => ({ userInfo: { uid: '12345', name: 'Me' } })
}))
const groupStoreMocks = vi.hoisted(() => ({
  getRoomIdsByUid: vi.fn(),
  addGroupDetail: vi.fn().mockResolvedValue(undefined),
  getGroupDetail: vi.fn().mockReturnValue(undefined),
  getUserInfo: vi.fn().mockReturnValue({ name: 'Alice', avatar: '' })
}))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => groupStoreMocks
}))
vi.mock('@/stores/feed', () => ({
  useFeedStore: () => ({})
}))
vi.mock('@/stores/sessionUnread', () => ({
  useSessionUnreadStore: () => ({
    apply: vi.fn().mockReturnValue({}),
    set: vi.fn(),
    remove: vi.fn()
  })
}))

import { useChatStore } from '@/stores/chat'
import { sessionBinding } from '@/services/sessionBinding'

describe('chatStore.loadAiclawGroupConfigs（REQ-016 #196 F5 复数版静默）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    imRequestMock.mockReset()
    groupStoreMocks.getRoomIdsByUid.mockReset().mockReturnValue(['room-1', 'room-2'])
    groupStoreMocks.addGroupDetail.mockClear()
    groupStoreMocks.getGroupDetail.mockClear()
  })

  it('逐房间请求带 showError:false（陈旧房间校验失败不弹全局 toast）', async () => {
    imRequestMock.mockResolvedValue({ roomId: 'room-1', rateLimitPerMinute: 10 })

    const chatStore = useChatStore()
    await chatStore.loadAiclawGroupConfigs(1001)

    expect(imRequestMock).toHaveBeenCalledTimes(2)
    for (const call of imRequestMock.mock.calls) {
      expect(call[1]).toMatchObject({ showError: false })
    }
  })

  it('单房间失败不抛出、不影响其余房间入库，返回 false 由调用方裁决', async () => {
    // roomId 按 getRoomIdsByUid 顺序依次请求：room-1 成功，room-2 陈旧（server 校验炸）
    imRequestMock
      .mockResolvedValueOnce({ roomId: 'room-1', rateLimitPerMinute: 10 })
      .mockRejectedValueOnce(new Error('您不在该群中'))

    const chatStore = useChatStore()
    const ok = await chatStore.loadAiclawGroupConfigs(1001)

    expect(ok).toBe(false)
    expect(chatStore.getAiclawGroupConfig(1001, 'room-1')).toBeTruthy()
    expect(chatStore.getAiclawGroupConfig(1001, 'room-2')).toBeUndefined()
  })
})

describe('chatStore 单房间配置读写（#210 二期：事件驱动收敛的增量原语）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    imRequestMock.mockReset()
    groupStoreMocks.getRoomIdsByUid.mockReset().mockReturnValue(['room-1', 'room-2'])
    groupStoreMocks.addGroupDetail.mockClear()
    groupStoreMocks.getGroupDetail.mockClear()
  })

  it('loadAiclawGroupConfigDetail：带 showError:false 取数并补群名/群号入库', async () => {
    imRequestMock.mockResolvedValue({ roomId: 'room-9', rateLimitPerMinute: 10 })
    groupStoreMocks.getGroupDetail.mockReturnValue({ groupName: '九号群', account: 'acc-9' })

    const chatStore = useChatStore()
    const ok = await chatStore.loadAiclawGroupConfigDetail(1001, 'room-9')

    expect(ok).toBe(true)
    expect(imRequestMock).toHaveBeenCalledTimes(1)
    expect(imRequestMock.mock.calls[0][1]).toMatchObject({ showError: false })
    expect(groupStoreMocks.addGroupDetail).toHaveBeenCalledWith('room-9', { showError: false })
    const item = chatStore.getAiclawGroupConfig(1001, 'room-9')
    expect(item).toMatchObject({ roomId: 'room-9', roomName: '九号群', account: 'acc-9' })
  })

  it('loadAiclawGroupConfigDetail：取数失败返回 false 且不落缓存（调用方闸门：失败不加卡）', async () => {
    imRequestMock.mockRejectedValue(new Error('network down'))

    const chatStore = useChatStore()
    const ok = await chatStore.loadAiclawGroupConfigDetail(1001, 'room-9')

    expect(ok).toBe(false)
    expect(chatStore.getAiclawGroupConfig(1001, 'room-9')).toBeUndefined()
  })

  it('removeAiclawGroupConfig：逐出单房间缓存（成员移除/群解散后不得复活）', async () => {
    imRequestMock
      .mockResolvedValueOnce({ roomId: 'room-1', rateLimitPerMinute: 10 })
      .mockResolvedValueOnce({ roomId: 'room-2', rateLimitPerMinute: 5 })
    const chatStore = useChatStore()
    await chatStore.loadAiclawGroupConfigs(1001)
    expect(chatStore.getAiclawGroupConfig(1001, 'room-1')).toBeTruthy()

    chatStore.removeAiclawGroupConfig(1001, 'room-1')

    expect(chatStore.getAiclawGroupConfig(1001, 'room-1')).toBeUndefined()
    expect(chatStore.getAiclawGroupConfigList(1001).map((c) => c.roomId)).toEqual(['room-2'])
  })
})

/**
 * #456 群配置读取收敛与并发有效性保护。
 * 全部走真实 store 的公开读取/更新/移除入口，用受控 Promise 决定底层响应顺序，
 * 断言「请求次数」与「最终状态」——不 mock 整个 store、不耦合私有 Map/版本实现。
 */
describe('chatStore 群配置读取收敛（#456）', () => {
  const deferred = <T>() => {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
  /** 等到 imRequest 真的发出（此刻本次读取的版本号/守卫都已捕获，后续失效必然生效） */
  const waitForRequest = async (times: number) => {
    await vi.waitFor(() => expect(imRequestMock).toHaveBeenCalledTimes(times))
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    imRequestMock.mockReset()
    groupStoreMocks.getRoomIdsByUid.mockReset().mockReturnValue(['1', '2', '3'])
    groupStoreMocks.addGroupDetail.mockReset().mockResolvedValue(undefined)
    groupStoreMocks.getGroupDetail.mockReset().mockReturnValue(undefined)
    // 重置账号上下文（watch 会顺带把 accountEpoch 推进一位，不影响断言）
    sessionBinding.value = null
  })

  it('A1：同键「基础加载」与「详情加载」并发时底层配置请求只发一次', async () => {
    const response = deferred<Record<string, unknown>>()
    imRequestMock.mockReturnValue(response.promise)

    const chatStore = useChatStore()
    // 两个入口同时发起：不能 await 第一个，否则就变成串行了
    const active = chatStore.loadAiclawGroupConfig(1001, '1')
    const detail = chatStore.loadAiclawGroupConfigDetail(1001, '1')
    await waitForRequest(1)

    response.resolve({ roomId: '1', rateLimitPerMinute: 7, dailyLimit: 70, respondToAi: true, mentionRequired: false })

    // 入口语义保留：主动版与静默版都拿到「成功」
    await expect(active).resolves.toBe(true)
    await expect(detail).resolves.toBe(true)
    expect(imRequestMock).toHaveBeenCalledTimes(1)
    expect(chatStore.getAiclawGroupConfig(1001, '1')).toMatchObject({ rateLimitPerMinute: 7, dailyLimit: 70 })
  })

  it('A2：不同助理/不同群并发读取不合并，结果各归各键', async () => {
    imRequestMock.mockResolvedValue({ roomId: '1', rateLimitPerMinute: 7 })

    const chatStore = useChatStore()
    await Promise.all([
      chatStore.loadAiclawGroupConfigDetail(1001, '1'),
      chatStore.loadAiclawGroupConfigDetail(1002, '1'),
      chatStore.loadAiclawGroupConfigDetail(1001, '2')
    ])

    expect(imRequestMock).toHaveBeenCalledTimes(3)
    expect(imRequestMock.mock.calls.map((call) => call[0].params)).toEqual([
      { aiclawUid: 1001, roomId: 1 },
      { aiclawUid: 1002, roomId: 1 },
      { aiclawUid: 1001, roomId: 2 }
    ])
    expect(chatStore.getAiclawGroupConfig(1001, '1')).toBeTruthy()
    expect(chatStore.getAiclawGroupConfig(1002, '1')).toBeTruthy()
    expect(chatStore.getAiclawGroupConfig(1001, '2')).toBeTruthy()
  })

  it('A3：在途状态用完即释放——失败可重试，成功也不做永久读取屏障', async () => {
    imRequestMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ roomId: '1', rateLimitPerMinute: 7 })
      .mockResolvedValueOnce({ roomId: '1', rateLimitPerMinute: 9 })

    const chatStore = useChatStore()
    await expect(chatStore.loadAiclawGroupConfigDetail(1001, '1')).resolves.toBe(false)
    // 失败后重试必须重新发请求（在途记录已释放）
    await expect(chatStore.loadAiclawGroupConfigDetail(1001, '1')).resolves.toBe(true)
    // 成功后再读同样重新取数：缓存不是「一次读取永久有效」的屏障
    await expect(chatStore.loadAiclawGroupConfigDetail(1001, '1')).resolves.toBe(true)
    expect(imRequestMock).toHaveBeenCalledTimes(3)
    expect(chatStore.getAiclawGroupConfig(1001, '1')).toMatchObject({ rateLimitPerMinute: 9 })
  })

  it('A5：WS 更新后，先前发起的旧读取不得覆盖新状态', async () => {
    const response = deferred<Record<string, unknown>>()
    imRequestMock.mockReturnValue(response.promise)

    const chatStore = useChatStore()
    const stale = chatStore.loadAiclawGroupConfigDetail(1001, '1')
    await waitForRequest(1)

    // WS 广播先到：缓存换成新值
    chatStore.updateAiclawGroupConfig(1001, 1, {
      rateLimitPerMinute: 99,
      dailyLimit: 990,
      respondToAi: false,
      mentionRequired: true
    } as never)

    // 旧读取后到，带着旧数据
    response.resolve({ roomId: '1', rateLimitPerMinute: 7 })
    await expect(stale).resolves.toBe(false)
    expect(chatStore.getAiclawGroupConfig(1001, '1')).toMatchObject({ rateLimitPerMinute: 99, dailyLimit: 990 })
  })

  it('A6：成员移除后，在途旧读取不得把配置复活', async () => {
    const response = deferred<Record<string, unknown>>()
    imRequestMock.mockReturnValue(response.promise)

    const chatStore = useChatStore()
    const stale = chatStore.loadAiclawGroupConfigDetail(1001, '1')
    await waitForRequest(1)

    chatStore.removeAiclawGroupConfig(1001, '1')
    response.resolve({ roomId: '1', rateLimitPerMinute: 7 })

    await expect(stale).resolves.toBe(false)
    expect(chatStore.getAiclawGroupConfig(1001, '1')).toBeUndefined()
  })

  it('A7：旧请求结束不清掉新请求的在途记录，也不破坏后续合并', async () => {
    const first = deferred<Record<string, unknown>>()
    const second = deferred<Record<string, unknown>>()
    imRequestMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const chatStore = useChatStore()
    const oldRead = chatStore.loadAiclawGroupConfigDetail(1001, '1')
    await waitForRequest(1)

    // 新数据到达 → 旧读取失去提交资格并解除合并
    chatStore.updateAiclawGroupConfig(1001, 1, { rateLimitPerMinute: 99 } as never)
    const newRead = chatStore.loadAiclawGroupConfigDetail(1001, '1')
    await waitForRequest(2)

    first.resolve({ roomId: '1', rateLimitPerMinute: 7 })
    await expect(oldRead).resolves.toBe(false)

    // 旧请求 settle 后，新请求的在途记录仍可被第三个读取复用
    const thirdRead = chatStore.loadAiclawGroupConfigDetail(1001, '1')
    expect(imRequestMock).toHaveBeenCalledTimes(2)

    second.resolve({ roomId: '1', rateLimitPerMinute: 8 })
    await expect(newRead).resolves.toBe(true)
    await expect(thirdRead).resolves.toBe(true)
    expect(chatStore.getAiclawGroupConfig(1001, '1')).toMatchObject({ rateLimitPerMinute: 8 })
  })

  it('A8：配置已回、补群详情期间切账号 → 旧配置不提交，也不当作普通补全失败吞掉', async () => {
    const enrichment = deferred<void>()
    groupStoreMocks.addGroupDetail.mockReturnValue(enrichment.promise)
    imRequestMock.mockResolvedValue({ roomId: '1', rateLimitPerMinute: 7 })

    const chatStore = useChatStore()
    const stale = chatStore.loadAiclawGroupConfigDetail(1001, '1')
    await vi.waitFor(() => expect(groupStoreMocks.addGroupDetail).toHaveBeenCalled())

    // 补全还在飞时账号切换（watch 同步推进 accountEpoch 并清缓存）
    sessionBinding.value = { backendKey: 'backend-2', uid: 'u2', sessionEpoch: 2 }
    enrichment.resolve()

    await expect(stale).resolves.toBe(false)
    expect(chatStore.getAiclawGroupConfig(1001, '1')).toBeUndefined()
  })

  it('A9：账号变化后全量循环不再为剩余旧房间发请求', async () => {
    const response = deferred<Record<string, unknown>>()
    imRequestMock.mockReturnValue(response.promise)

    const chatStore = useChatStore()
    const pending = chatStore.loadAiclawGroupConfigs(1001)
    await waitForRequest(1)

    sessionBinding.value = { backendKey: 'backend-2', uid: 'u2', sessionEpoch: 2 }
    response.resolve({ roomId: '1', rateLimitPerMinute: 7 })

    await expect(pending).resolves.toBe(false)
    // 剩下的 room-2 / room-3 不得继续请求
    expect(imRequestMock).toHaveBeenCalledTimes(1)
    expect(chatStore.getAiclawGroupConfig(1001, '1')).toBeUndefined()
  })

  it('A11：空响应不算成功加载——不落缓存、不伪造默认值', async () => {
    imRequestMock.mockResolvedValue(null)

    const chatStore = useChatStore()
    await expect(chatStore.loadAiclawGroupConfigDetail(1001, '1')).resolves.toBe(false)
    expect(chatStore.getAiclawGroupConfig(1001, '1')).toBeUndefined()
    expect(chatStore.getAiclawGroupConfigList(1001)).toEqual([])
  })

  it('A12：主动读取失败给明确反馈，后台读取同一失败保持静默', async () => {
    const errorMock = vi.fn()
    ;(window as unknown as { $message: unknown }).$message = { error: errorMock, success: vi.fn(), warning: vi.fn() }
    imRequestMock.mockRejectedValue(new Error('boom'))

    try {
      const chatStore = useChatStore()
      await expect(chatStore.loadAiclawGroupConfigDetail(1001, '1')).resolves.toBe(false)
      expect(errorMock).not.toHaveBeenCalled()

      await expect(chatStore.loadAiclawGroupConfig(1001, '1')).resolves.toBe(false)
      expect(errorMock).toHaveBeenCalledTimes(1)
      expect(errorMock).toHaveBeenCalledWith('boom')
    } finally {
      delete (window as unknown as { $message?: unknown }).$message
    }
  })
})

/**
 * #457：保存成功 = 读取代次切换点。保存之后的刷新必须重新发请求（不得并入保存前的在途读取），
 * 保存前的旧响应返回时不得回滚配置、不得被当成成功；刷新失败也不删已有有效缓存。
 */
describe('chatStore 保存/刷新代次（#457）', () => {
  const deferred = <T>() => {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
  const waitForRequest = async (times: number) => {
    await vi.waitFor(() => expect(imRequestMock).toHaveBeenCalledTimes(times))
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    imRequestMock.mockReset()
    groupStoreMocks.getRoomIdsByUid.mockReset().mockReturnValue(['1', '2', '3'])
    groupStoreMocks.addGroupDetail.mockReset().mockResolvedValue(undefined)
    groupStoreMocks.getGroupDetail.mockReset().mockReturnValue(undefined)
    sessionBinding.value = null
  })

  it('A4：保存后的刷新不复用保存前的旧读取，旧响应不回滚配置也不冒充成功', async () => {
    const stale = deferred<Record<string, unknown>>()
    imRequestMock.mockReturnValueOnce(stale.promise)

    const chatStore = useChatStore()
    const oldRead = chatStore.loadAiclawGroupConfigDetail(1001, '1')
    await waitForRequest(1)

    // 保存成功：store 作废保存前的读取代次（旧在途立即失去提交资格）
    await chatStore.saveAiclawGroupConfig(1001, '1', {
      rateLimitPerMinute: 3,
      dailyLimit: 30,
      respondToAi: true,
      mentionRequired: true,
      approved: true
    } as never)

    // 保存后的刷新必须是新请求，不能并到旧在途读取上
    const fresh = deferred<Record<string, unknown>>()
    imRequestMock.mockReturnValueOnce(fresh.promise)
    const refresh = chatStore.loadAiclawGroupConfigDetail(1001, '1')
    await waitForRequest(2)

    // 旧读取最后才回来：不回滚、不算成功
    stale.resolve({ roomId: '1', rateLimitPerMinute: 99, dailyLimit: 999, respondToAi: false, mentionRequired: false })
    await expect(oldRead).resolves.toBe(false)
    expect(chatStore.getAiclawGroupConfig(1001, '1')).toBeUndefined()

    fresh.resolve({ roomId: '1', rateLimitPerMinute: 4, dailyLimit: 40, respondToAi: true, mentionRequired: true })
    await expect(refresh).resolves.toBe(true)
    expect(chatStore.getAiclawGroupConfig(1001, '1')).toMatchObject({ rateLimitPerMinute: 4, dailyLimit: 40 })
  })

  it('A13：保存后的刷新失败不算成功、不删已有有效配置（刷新失败与保存失败是两个结果）', async () => {
    imRequestMock.mockResolvedValueOnce({
      roomId: '1',
      rateLimitPerMinute: 5,
      dailyLimit: 50,
      respondToAi: true,
      mentionRequired: true,
      approved: true
    })

    const chatStore = useChatStore()
    await expect(chatStore.loadAiclawGroupConfigDetail(1001, '1')).resolves.toBe(true)

    await chatStore.saveAiclawGroupConfig(1001, '1', {
      rateLimitPerMinute: 6,
      dailyLimit: 60,
      respondToAi: true,
      mentionRequired: true,
      approved: true
    } as never)

    imRequestMock.mockRejectedValueOnce(new Error('network down'))
    await expect(chatStore.loadAiclawGroupConfigDetail(1001, '1')).resolves.toBe(false)

    // 刷新失败不得清掉保存前已生效的配置（普通单群读取失败不主动删已有有效配置）
    expect(chatStore.getAiclawGroupConfig(1001, '1')).toMatchObject({ rateLimitPerMinute: 5, dailyLimit: 50 })
  })

  it('A4/A6：成员移除后保存返回的旧刷新不得复活该群配置', async () => {
    imRequestMock.mockResolvedValueOnce({
      roomId: '1',
      rateLimitPerMinute: 5,
      dailyLimit: 50,
      respondToAi: true,
      mentionRequired: true,
      approved: true
    })

    const chatStore = useChatStore()
    await expect(chatStore.loadAiclawGroupConfigDetail(1001, '1')).resolves.toBe(true)

    const inFlight = deferred<Record<string, unknown>>()
    imRequestMock.mockReturnValueOnce(inFlight.promise)
    const refresh = chatStore.loadAiclawGroupConfigDetail(1001, '1')
    await waitForRequest(2)

    // 成员移除：逐出缓存并作废在途读取
    chatStore.removeAiclawGroupConfig(1001, '1')

    inFlight.resolve({ roomId: '1', rateLimitPerMinute: 7, dailyLimit: 70, respondToAi: true, mentionRequired: true })
    await expect(refresh).resolves.toBe(false)
    expect(chatStore.getAiclawGroupConfig(1001, '1')).toBeUndefined()
  })
})
