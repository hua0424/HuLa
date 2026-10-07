import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { MittEnum, RoomTypeEnum } from '@/enums'

/**
 * #339：openMsgSession 进入协调——点击即脱离旧房间、连选归末、失败保留重试且不复现旧房间。
 */

let currentRoom = ''
let opening: { uid: string; type: number; error: string } | null = null

const globalStoreMock = {
  get currentSessionRoomId() {
    return currentRoom
  },
  updateCurrentSessionRoomId: vi.fn((id: string) => {
    currentRoom = id
  }),
  beginSessionOpening: vi.fn((uid: string, type: number) => {
    opening = { uid, type, error: '' }
  }),
  failSessionOpening: vi.fn((message: string) => {
    if (opening) opening.error = message
  }),
  endSessionOpening: vi.fn(() => {
    opening = null
  }),
  get sessionOpening() {
    return opening
  }
}

const chatStoreMock = {
  getSession: vi.fn(),
  getSessionList: vi.fn().mockResolvedValue([]),
  updateSessionLastActiveTime: vi.fn(),
  markSessionRead: vi.fn()
}

const routeMock = vi.hoisted(() => ({ value: { name: 'friendsList', path: '/friendsList' } }))
const routerPushMock = vi.hoisted(() => vi.fn())
vi.mock('@/router', () => ({
  default: { currentRoute: routeMock, push: routerPushMock }
}))

vi.mock('@/stores/global', () => ({
  useGlobalStore: vi.fn(() => globalStoreMock)
}))
vi.mock('@/stores/chat', () => ({
  useChatStore: vi.fn(() => chatStoreMock)
}))
vi.mock('@/stores/user', () => ({
  useUserStore: vi.fn(() => ({ userInfo: { uid: '1000' } }))
}))

const handleMsgClickMock = vi.fn()
vi.mock('@/hooks/useMessage', () => ({
  useMessage: vi.fn(() => ({ handleMsgClick: handleMsgClickMock }))
}))

const getSessionDetailMock = vi.fn()
vi.mock('@/utils/ImRequestUtils', () => ({
  getSessionDetailWithFriends: (...args: unknown[]) => getSessionDetailMock(...args)
}))

const invokeMock = vi.fn()
vi.mock('@/utils/TauriInvokeHandler', () => ({
  invokeWithErrorHandler: (...args: unknown[]) => invokeMock(...args)
}))

const mittEmitMock = vi.fn()
vi.mock('@/hooks/useMitt', () => ({
  useMitt: { on: vi.fn(), off: vi.fn(), emit: (...args: unknown[]) => mittEmitMock(...args) }
}))

vi.mock('@/utils/PlatformConstants', () => ({
  isWeb: () => false,
  isMobile: () => false
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getCurrent: () => ({ label: 'home' }) }
}))
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: {},
  create: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn()
}))
vi.mock('@/utils/PathUtil.ts', () => ({
  getImageCache: vi.fn(() => '/tmp/')
}))
vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key }))
}))

import { useCommon } from '@/hooks/useCommon'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useCommon openMsgSession 进入协调（#339）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentRoom = 'room-old'
    opening = null
    routeMock.value = { name: 'friendsList', path: '/friendsList' }
    ;(window as any).$message = { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() }
    chatStoreMock.getSession.mockReturnValue(undefined)
    chatStoreMock.getSessionList.mockResolvedValue([])
    invokeMock.mockResolvedValue({})
  })

  it('点击即脱离旧房间并置位在途目标，成功后选中新房间并清除在途', async () => {
    const gate = deferred<{ roomId: string }>()
    getSessionDetailMock.mockReturnValueOnce(gate.promise)

    const { openMsgSession } = useCommon()
    const pending = openMsgSession('uid-b', RoomTypeEnum.SINGLE)
    // 同步段：旧房间已清空、在途已置位，尚未呈现新房间
    expect(currentRoom).toBe('')
    expect(opening).toMatchObject({ uid: 'uid-b', error: '' })
    expect(routerPushMock).toHaveBeenCalledWith('/message')

    gate.resolve({ roomId: 'room-b' })
    await pending
    await flushPromises()

    expect(currentRoom).toBe('room-b')
    expect(opening).toBeNull()
    expect(mittEmitMock).toHaveBeenCalledWith(MittEnum.LOCATE_SESSION, { roomId: 'room-b' })
    expect(mittEmitMock).toHaveBeenCalledWith(MittEnum.TO_SEND_MSG, { url: 'message' })
    expect(handleMsgClickMock).toHaveBeenCalled()
  })

  it('快速连选：先发后到的过期请求不覆盖最后选择', async () => {
    const gateA = deferred<{ roomId: string }>()
    const gateB = deferred<{ roomId: string }>()
    getSessionDetailMock.mockReturnValueOnce(gateA.promise).mockReturnValueOnce(gateB.promise)

    const { openMsgSession } = useCommon()
    const pendingA = openMsgSession('uid-a', RoomTypeEnum.SINGLE)
    const pendingB = openMsgSession('uid-b', RoomTypeEnum.SINGLE)

    gateB.resolve({ roomId: 'room-b' })
    await pendingB
    await flushPromises()
    expect(currentRoom).toBe('room-b')

    // A 后到：不得覆盖 B
    gateA.resolve({ roomId: 'room-a' })
    await pendingA
    await flushPromises()
    expect(currentRoom).toBe('room-b')
    expect(mittEmitMock).not.toHaveBeenCalledWith(MittEnum.LOCATE_SESSION, { roomId: 'room-a' })
  })

  it('目标查询失败：保留在途错误可重试，不复现旧房间且继续抛错', async () => {
    const gate = deferred<{ roomId: string }>()
    getSessionDetailMock.mockReturnValueOnce(gate.promise)

    const { openMsgSession } = useCommon()
    const pending = openMsgSession('uid-b', RoomTypeEnum.SINGLE)
    expect(currentRoom).toBe('')

    gate.reject(new Error('network down'))
    await expect(pending).rejects.toThrow('network down')
    expect(opening).toMatchObject({ uid: 'uid-b' })
    expect(opening?.error).toBe('network down')
    expect(currentRoom).toBe('')
    expect((window as any).$message.error).toHaveBeenCalled()

    // 重试同一目标可恢复
    getSessionDetailMock.mockResolvedValueOnce({ roomId: 'room-b' })
    await openMsgSession('uid-b', RoomTypeEnum.SINGLE)
    await flushPromises()
    expect(currentRoom).toBe('room-b')
    expect(opening).toBeNull()
  })

  it('在途期间用户手动选中其他会话：迟到结果不覆盖', async () => {
    const gate = deferred<{ roomId: string }>()
    getSessionDetailMock.mockReturnValueOnce(gate.promise)

    const { openMsgSession } = useCommon()
    const pending = openMsgSession('uid-b', RoomTypeEnum.SINGLE)
    // 用户在加载期手动点了会话列表
    currentRoom = 'room-manual'

    gate.resolve({ roomId: 'room-b' })
    await pending
    await flushPromises()
    expect(currentRoom).toBe('room-manual')
    expect(opening).toBeNull()
  })
})
