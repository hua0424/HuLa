import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#352：房间阅读位置——持久化（reading 快照）、重登恢复、
 * 锚点回填/邻近兜底、思考无权不退房。用真实 chat store，只 mock 传输层。
 */

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
const ipc = vi.hoisted(() => ({
  handler: null as null | ((command: string, args: any) => Promise<any>),
  cached: null as any
}))
vi.hoisted(() => {
  class WorkerStub {
    postMessage() {}
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  }
  globalThis.Worker = WorkerStub as unknown as typeof Worker
})
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: any[]) => native.invoke(...args) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'home' }) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getByLabel: vi.fn(async () => null), getCurrent: () => ({ label: 'home' }) }
}))
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('@tauri-apps/plugin-notification', () => ({ sendNotification: vi.fn() }))
vi.mock('@/utils/PlatformConstants', () => ({
  isWeb: () => false,
  isMobile: () => false,
  isWindows: () => true,
  isMac: () => false
}))
vi.mock('@/utils/TauriInvokeHandler', () => ({
  invokeWithErrorHandler: (command: string, args: any) => {
    if (ipc.handler) return ipc.handler(String(command), args)
    return Promise.resolve(undefined)
  },
  invokeSilently: vi.fn(async () => undefined)
}))
vi.mock('@/services/thinkingService', () => ({
  loadThinkingByTrigger: async () => [],
  loadThinkingDetail: async () => ({ content: '', status: 4 })
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/message' }), useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/utils/ImRequestUtils', () => ({
  markMsgRead: vi.fn(async () => undefined),
  getSessionDetail: vi.fn(async () => undefined),
  imRequest: vi.fn(async () => ({ list: [], cursor: '', isLast: true }))
}))
vi.mock('@/utils/RenderReplyContent.ts', () => ({ renderReplyContent: (_n: unknown, _t: unknown, c: unknown) => c }))
vi.mock('@/utils/UnreadCountManager', () => ({
  unreadCountManager: {
    refreshBadge: vi.fn(),
    calculateTotal: vi.fn(),
    setUpdateCallback: vi.fn(),
    requestUpdate: vi.fn()
  }
}))

import { useChatStore } from '@/stores/chat'
import { useGlobalStore } from '@/stores/global'
import { initializeSessionBinding, type SessionIdentity } from '@/services/sessionBinding'
import { RoomTypeEnum } from '@/enums'
import type { SessionItem } from '@/services/types'
import type { ThinkingState } from '@/types/thinking'

const makeSession = (roomId: string): SessionItem =>
  ({
    roomId,
    name: `session-${roomId}`,
    type: RoomTypeEnum.GROUP,
    activeTime: Date.now(),
    unreadCount: 0
  }) as SessionItem

let identity: SessionIdentity
let epoch = 900

const msg = (id: string, sendTime: number) => ({
  message: { id, sendTime, sendId: 'u1', content: `c-${id}`, type: 1 },
  fromUser: { uid: 'u1' }
})

beforeEach(async () => {
  setActivePinia(createPinia())
  Object.assign(window, { __TAURI_INTERNALS__: {} })
  identity = { backendKey: 'http://a/api', uid: '4', sessionEpoch: ++epoch }
  native.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === 'get_session_binding') return { sessionEpoch: identity.sessionEpoch, binding: { ...identity } }
    return undefined
  })
  ipc.handler = null
  ipc.cached = null
  await initializeSessionBinding()
})

/** 默认 IPC：空分页 + 空思考缓存；各用例按需覆盖 page_msg。 */
const armDefaultIpc = (pageImpl?: (args: any) => any) => {
  ipc.handler = async (command: string, args: any) => {
    if (command === 'page_msg') return pageImpl ? pageImpl(args) : { list: [], cursor: '', isLast: true, total: 0 }
    if (command === 'read_thinking_cache') return { items: [], loadedTriggerIds: [], visibleTriggerIds: [] }
    if (command === 'calibrate_window')
      return { items: [], unavailableIds: [], complete: true, thinkingAccess: undefined }
    return undefined
  }
}

describe('阅读位置持久化与重登恢复 (#352)', () => {
  it('上报+落盘写入 reading 快照（房间/锚点/偏移/是否在底）', async () => {
    armDefaultIpc()
    ipc.handler = async (command: string, args: any) => {
      if (command === 'cache_local_snapshot') {
        ipc.cached = args
        return undefined
      }
      if (command === 'page_msg') return { list: [], cursor: '', isLast: true, total: 0 }
      if (command === 'read_thinking_cache') return { items: [], loadedTriggerIds: [], visibleTriggerIds: [] }
      if (command === 'calibrate_window')
        return { items: [], unavailableIds: [], complete: true, thinkingAccess: undefined }
      return undefined
    }
    const store = useChatStore()
    store.sessionList = [makeSession('r1')]
    store.reportReadingAnchor('r1', { anchorMsgId: 'm5', anchorSendTime: 50, offsetPx: 12, wasAtBottom: false })
    expect(store.getSavedReadPosition('r1')?.anchorMsgId).toBe('m5')
    await store.flushReadingPositions()
    expect(ipc.cached?.name).toBe('reading')
    expect(ipc.cached?.payload?.version).toBe(1)
    expect(ipc.cached?.payload?.positions?.['r1']?.anchorMsgId).toBe('m5')
    expect(ipc.cached?.payload?.positions?.['r1']?.offsetPx).toBe(12)
  })

  it('重登选中上次房间并对缺失锚点有界回填后 pin 住', async () => {
    const newer = Array.from({ length: 20 }, (_, i) => msg(`m${11 + i}`, 110 + i * 10))
    const older = Array.from({ length: 10 }, (_, i) => msg(`m${1 + i}`, 10 + i * 10))
    armDefaultIpc((args: any) => {
      if (args?.param?.source === 'remote') return { list: [], cursor: '', isLast: true, total: 0 }
      if (args?.param?.cursor) return { list: older, cursor: '', isLast: true, total: older.length }
      return { list: newer, cursor: 'c1', isLast: false, total: newer.length }
    })
    // reading 快照：上次房间 r1，锚点 m5（不在首屏内，需要回填一页）。
    const snapshot = {
      version: 1,
      lastRoomId: 'r1',
      positions: { r1: { anchorMsgId: 'm5', anchorSendTime: 50, offsetPx: 12, wasAtBottom: false, updatedAt: 1 } }
    }
    const store = useChatStore()
    const globalStore = useGlobalStore()
    store.sessionList = [makeSession('r1')]
    const prevHandler = ipc.handler
    ipc.handler = async (command: string, args: any) => {
      if (command === 'read_local_snapshot' && args?.name === 'reading') return snapshot
      return prevHandler!(command, args)
    }
    const result = await store.restoreLastReading('')
    expect(result).toBe('restored:r1')
    expect(globalStore.currentSessionRoomId).toBe('r1')
    await vi.waitFor(() =>
      expect(store.pendingScrollRestore).toEqual({ roomId: 'r1', anchorMsgId: 'm5', offsetPx: 12 })
    )
    // 回填页已合并，锚点真实存在。
    expect(store.messageMap['r1']?.['m5']).toBeTruthy()
  })

  it('锚点真删选时间邻近可读位置（撤回占位保留 id 则直接命中）', async () => {
    armDefaultIpc(() => ({ list: [msg('m1', 10), msg('m3', 30)], cursor: '', isLast: true, total: 2 }))
    const snapshot = {
      version: 1,
      lastRoomId: 'r1',
      positions: { r1: { anchorMsgId: 'gone', anchorSendTime: 28, offsetPx: 5, wasAtBottom: false, updatedAt: 1 } }
    }
    const store = useChatStore()
    const globalStore = useGlobalStore()
    store.sessionList = [makeSession('r1')]
    const prevHandler = ipc.handler
    ipc.handler = async (command: string, args: any) => {
      if (command === 'read_local_snapshot' && args?.name === 'reading') return snapshot
      return prevHandler!(command, args)
    }
    expect(await store.restoreLastReading('')).toBe('restored:r1')
    expect(globalStore.currentSessionRoomId).toBe('r1')
    await vi.waitFor(() => expect(store.pendingScrollRestore).toEqual({ roomId: 'r1', anchorMsgId: 'm3', offsetPx: 5 }))
  })

  it('目标明确不存在且本地无缓存回列表（gone）；网络失败保留本地目标', async () => {
    armDefaultIpc()
    const store = useChatStore()
    const globalStore = useGlobalStore()
    store.sessionList = [makeSession('r2')]
    const prevHandler = ipc.handler
    ipc.handler = async (command: string, args: any) => {
      if (command === 'read_local_snapshot' && args?.name === 'reading')
        return { version: 1, lastRoomId: 'r9', positions: {} }
      return prevHandler!(command, args)
    }
    globalStore.currentSessionRoomId = ''
    expect(await store.restoreLastReading('')).toBe('gone:r9')
    expect(globalStore.currentSessionRoomId).toBe('')

    // 网络失败（isError）：本地目标保留并选中，不当成消失。
    store.sessionOptions.isError = true
    expect(await store.restoreLastReading('')).toBe('local-only:r9')
    expect(globalStore.currentSessionRoomId).toBe('r9')
  })

  it('思考明确无权只隐藏卡片：消息与选中房间不受影响', async () => {
    armDefaultIpc()
    const prevHandler = ipc.handler
    ipc.handler = async (command: string, args: any) => {
      if (command === 'calibrate_window')
        return { items: [], unavailableIds: [], complete: true, thinkingAccess: false }
      return prevHandler!(command, args)
    }
    const store = useChatStore()
    const globalStore = useGlobalStore()
    store.sessionList = [makeSession('r3')]
    globalStore.currentSessionRoomId = 'r3'
    // 切房 watcher 的后台 changeRoom 会先清空重建本房消息区：等其落定后再播种，
    // 之后显式校准只应隐藏思考卡，不碰消息、不退房。
    await vi.waitFor(() => expect(store.messageMap['r3']).toBeTruthy())
    store.messageMap['r3'] = { '10': { message: { id: '10', sendTime: 1 } } as never }
    const state = {
      thinkingId: '100',
      roomId: 'r3',
      triggerMsgId: '10',
      aiclawId: '20',
      aiclawName: 'AI',
      aiclawAvatar: '',
      status: 'complete',
      startTime: 1,
      collapsed: true
    } as ThinkingState
    store.thinkingByTrigger.set('r3', new Map([['10', [state]]]))
    const outcome = await store.calibrateWindow('r3', { force: true })
    expect(outcome.ok).toBe(true)
    // 思考卡隐藏，合法消息与选中房间保留（不误退列表）。
    expect(store.thinkingByTrigger.get('r3')?.size ?? 0).toBe(0)
    expect(Object.keys(store.messageMap['r3'] ?? {})).toEqual(['10'])
    expect(globalStore.currentSessionRoomId).toBe('r3')
  })
})
