import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-016 #195 F4：解散群防重 + 乐观移除（PRD #190 裁决 3，PR#55 P1 裁决）。
 * 乐观移除 = 纯本地 removeSession；失败回滚 = 快照纯本地 restoreSession，全程零网络。
 * 这里使用**真实** chat store（不回放 mock addSession），只在网络边界
 * （ImRequestUtils / TauriInvokeHandler）打桩，断言回滚不发起任何 server 调用。
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

const getSessionDetailMock = vi.hoisted(() => vi.fn())
const imRequestMock = vi.hoisted(() => vi.fn().mockResolvedValue({ list: [], cursor: '', isLast: true }))
vi.mock('@/utils/ImRequestUtils', () => ({
  markMsgRead: vi.fn().mockResolvedValue(undefined),
  getSessionDetail: getSessionDetailMock,
  imRequest: imRequestMock
}))
vi.mock('@/utils/UnreadCountManager', () => ({
  unreadCountManager: {
    refreshBadge: vi.fn(),
    calculateTotal: vi.fn(),
    setUpdateCallback: vi.fn(),
    requestUpdate: vi.fn()
  }
}))
const invokeWithErrorHandlerMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const invokeSilentlyMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/utils/TauriInvokeHandler', () => ({
  invokeWithErrorHandler: invokeWithErrorHandlerMock,
  invokeSilently: invokeSilentlyMock
}))
vi.mock('@/utils/PlatformConstants', () => ({
  isWeb: () => false,
  isMobile: () => false,
  isWindows: () => true,
  isMac: () => false
}))

// group store 只 mock 解散链路用到的两个方法（exitGroup = 解散 HTTP，合法打桩）
const groupStoreMocks = vi.hoisted(() => ({
  exitGroup: vi.fn().mockResolvedValue(undefined),
  isRoomDissolved: vi.fn().mockReturnValue(false),
  getUserInfo: vi.fn().mockReturnValue(undefined),
  removeGroupDetail: vi.fn(),
  markRoomDissolved: vi.fn(),
  getRoomIdsByUid: vi.fn().mockReturnValue([]),
  addGroupDetail: vi.fn().mockResolvedValue(undefined),
  getGroupDetail: vi.fn().mockReturnValue(undefined)
}))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => groupStoreMocks
}))

import { RoomTypeEnum } from '@/enums'
import type { SessionItem } from '@/services/types'
import { useChatStore } from '@/stores/chat'
import { dissolveGroupOptimistic } from '@/utils/dissolveGroup'

const makeSession = (roomId: string, unreadCount = 0): SessionItem =>
  ({
    roomId,
    name: `session-${roomId}`,
    type: RoomTypeEnum.GROUP,
    activeTime: 1000,
    unreadCount
  }) as SessionItem

const expectNoServerCalls = () => {
  expect(getSessionDetailMock).not.toHaveBeenCalled()
  expect(imRequestMock).not.toHaveBeenCalled()
  expect(invokeWithErrorHandlerMock).not.toHaveBeenCalled()
  expect(invokeSilentlyMock).not.toHaveBeenCalled()
}

describe('dissolveGroupOptimistic（REQ-016 #195 F4，PR#55 P1）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    groupStoreMocks.exitGroup.mockResolvedValue(undefined)
    groupStoreMocks.isRoomDissolved.mockReturnValue(false)
  })

  it('乐观移除：exitGroup 在途时会话已从列表消失；成功后保持移除并静默 hide', async () => {
    const chatStore = useChatStore()
    chatStore.sessionList = [makeSession('room-1'), makeSession('room-2')]
    chatStore.sessionMap = { 'room-1': chatStore.sessionList[0], 'room-2': chatStore.sessionList[1] }

    let release: (v: unknown) => void
    groupStoreMocks.exitGroup.mockReturnValue(new Promise((r) => (release = r)))

    const done = dissolveGroupOptimistic('room-1')

    // HTTP 仍在途，会话已被本地移除（无快照泄漏、无网络等待）
    expect(chatStore.sessionList.map((s) => s.roomId)).toEqual(['room-2'])
    expect(chatStore.sessionMap['room-1']).toBeUndefined()

    release!(undefined)
    await expect(done).resolves.toBe(true)

    // 成功终态：会话保持移除，contact 隐藏走静默 best-effort（失败不阻塞、由同步自愈）
    expect(chatStore.sessionList.map((s) => s.roomId)).toEqual(['room-2'])
    expect(invokeSilentlyMock).toHaveBeenCalledWith('hide_contact_command', { data: { roomId: 'room-1', hide: true } })
    expect(getSessionDetailMock).not.toHaveBeenCalled()
    expect(imRequestMock).not.toHaveBeenCalled()
  })

  it('失败回滚：快照纯本地还原到原位置，不发起任何 server 调用，返回 false', async () => {
    const chatStore = useChatStore()
    chatStore.sessionList = [makeSession('room-1'), makeSession('room-2')]
    chatStore.sessionMap = { 'room-1': chatStore.sessionList[0], 'room-2': chatStore.sessionList[1] }
    groupStoreMocks.exitGroup.mockRejectedValue(new Error('server error'))

    await expect(dissolveGroupOptimistic('room-1')).resolves.toBe(false)

    // 还原到原位置（index 0），数据不变
    expect(chatStore.sessionList.map((s) => s.roomId)).toEqual(['room-1', 'room-2'])
    expect(chatStore.sessionMap['room-1']?.name).toBe('session-room-1')
    expectNoServerCalls()
  })

  // PR#55 裁决（P1）：断网路径——exit 请求根本没到达 server，回滚同样不得发起任何网络调用，
  // 且被 removeSession 清掉的未读数按快照回补
  it('断网失败：回滚零网络调用，会话与未读数完整还原', async () => {
    const chatStore = useChatStore()
    chatStore.sessionList = [makeSession('room-1', 5), makeSession('room-2')]
    chatStore.sessionMap = { 'room-1': chatStore.sessionList[0], 'room-2': chatStore.sessionList[1] }
    groupStoreMocks.exitGroup.mockRejectedValue(new Error('network offline'))

    await expect(dissolveGroupOptimistic('room-1')).resolves.toBe(false)

    expect(chatStore.sessionList.map((s) => s.roomId)).toEqual(['room-1', 'room-2'])
    expect(chatStore.sessionMap['room-1']?.unreadCount).toBe(5)
    expectNoServerCalls()
  })

  it('回滚无快照（会话本就不在列表）：不崩溃、不新增会话、零网络调用', async () => {
    const chatStore = useChatStore()
    chatStore.sessionList = [makeSession('room-2')]
    chatStore.sessionMap = { 'room-2': chatStore.sessionList[0] }
    groupStoreMocks.exitGroup.mockRejectedValue(new Error('server error'))

    await expect(dissolveGroupOptimistic('room-9')).resolves.toBe(false)

    expect(chatStore.sessionList.map((s) => s.roomId)).toEqual(['room-2'])
    expectNoServerCalls()
  })

  // PR#55 裁决（P2 竞态）：server 已处理解散但 HTTP 响应丢失时，WS 已 markRoomDissolved，
  // 回滚必须短路——还原 = 复活幽灵会话
  it('HTTP 失败但房间已确认解散（isRoomDissolved）：回滚短路不还原，返回 true', async () => {
    const chatStore = useChatStore()
    chatStore.sessionList = [makeSession('room-1'), makeSession('room-2')]
    chatStore.sessionMap = { 'room-1': chatStore.sessionList[0], 'room-2': chatStore.sessionList[1] }
    groupStoreMocks.exitGroup.mockRejectedValue(new Error('response lost'))
    groupStoreMocks.isRoomDissolved.mockReturnValue(true)

    await expect(dissolveGroupOptimistic('room-1')).resolves.toBe(true)

    expect(chatStore.sessionList.map((s) => s.roomId)).toEqual(['room-2'])
    expectNoServerCalls()
  })
})

describe('chatStore.restoreSession（PR#55 P1 纯本地还原原语）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('按指定位置插入并重建 sessionMap，全程零网络', () => {
    const chatStore = useChatStore()
    chatStore.sessionList = [makeSession('room-1'), makeSession('room-3')]
    chatStore.sessionMap = { 'room-1': chatStore.sessionList[0], 'room-3': chatStore.sessionList[1] }

    chatStore.restoreSession(makeSession('room-2'), 1)

    expect(chatStore.sessionList.map((s) => s.roomId)).toEqual(['room-1', 'room-2', 'room-3'])
    expect(chatStore.sessionMap['room-2']).toBeDefined()
    expectNoServerCalls()
  })

  it('会话已被其他链路恢复时幂等，不重复插入', () => {
    const chatStore = useChatStore()
    const existing = { ...makeSession('room-1'), name: 'original' } as SessionItem
    chatStore.sessionList = [existing]
    chatStore.sessionMap = { 'room-1': existing }

    chatStore.restoreSession({ ...makeSession('room-1'), name: 'duplicate' } as SessionItem, 0)

    expect(chatStore.sessionList.filter((s) => s.roomId === 'room-1')).toHaveLength(1)
    // 既有引用不被替换（响应式代理下用字段区分两个候选对象）
    expect(chatStore.sessionMap['room-1'].name).toBe('original')
  })
})
