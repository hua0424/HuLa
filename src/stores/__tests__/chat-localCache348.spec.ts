import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ImUrlEnum, MessageStatusEnum, MsgEnum } from '@/enums'

const native = vi.hoisted(() => ({ invoke: vi.fn(), listeners: new Map<string, (event: any) => void>() }))
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
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, callback: (event: any) => void) => {
    native.listeners.set(name, callback)
    return () => native.listeners.delete(name)
  })
}))
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
vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/message' }), useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/utils/UnreadCountManager', () => ({
  unreadCountManager: {
    refreshBadge: vi.fn(),
    calculateTotal: vi.fn(),
    setUpdateCallback: vi.fn(),
    requestUpdate: vi.fn()
  }
}))

// Only native transport is controlled. Chat store, session guard, HTTP adapter and cache services are real.
import { useChatStore } from '@/stores/chat'
import {
  captureSessionBinding,
  initializeSessionBinding,
  listenBound,
  sessionBinding,
  SessionExpiredError,
  type SessionIdentity
} from '@/services/sessionBinding'
import { loadThinkingBody } from '@/services/localCache'
import type { ThinkingState } from '@/types/thinking'
import type { SessionItem } from '@/services/types'

let identity: SessionIdentity
const message = (id = '10') => ({
  fromUser: { uid: '2', username: 'fixture', avatar: '', locPlace: '' },
  message: {
    id,
    roomId: '3',
    type: MsgEnum.TEXT,
    body: { content: 'fixture' },
    sendTime: 1,
    messageMarks: {},
    status: MessageStatusEnum.SUCCESS
  },
  sendTime: 1
})
const metadata = (status = 0, id = '100', actor = '20') => ({
  id,
  aiclawUid: actor,
  triggerMsgId: '10',
  status,
  durationMs: 5,
  hasResponse: 1,
  createTime: '2026-10-02T01:00:00'
})
const disk = (status = 0) => ({
  items: [
    {
      metadata: metadata(status),
      roomId: '3',
      content: '',
      bodyLoaded: status === 1,
      bodyETag: null,
      bodyVerifiedAt: null
    }
  ],
  loadedTriggerIds: ['10'],
  visibleTriggerIds: ['10']
})
const state = (): ThinkingState => ({
  thinkingId: '100',
  roomId: '3',
  triggerMsgId: '10',
  aiclawId: '20',
  aiclawName: 'AI',
  aiclawAvatar: '',
  status: 'complete',
  startTime: 1,
  collapsed: false
})
let handle: (command: string, args: any) => any
let epoch = 100

beforeEach(async () => {
  setActivePinia(createPinia())
  Object.assign(window, { __TAURI_INTERNALS__: {} })
  identity = { backendKey: 'http://a/api', uid: '4', sessionEpoch: ++epoch }
  handle = (command) => {
    if (command === 'page_msg') return { list: [message()], cursor: '', isLast: true, total: 1 }
    if (command === 'read_thinking_cache') return disk()
    if (command === 'cache_thinking_metadata') return ['10']
    if (command === 'im_request_command') return []
    return undefined
  }
  native.invoke.mockReset().mockImplementation(async (command: string, args: any) => {
    if (command === 'get_session_binding') return { sessionEpoch: identity.sessionEpoch, binding: { ...identity } }
    if (args?.binding && JSON.stringify(args.binding) !== JSON.stringify(identity))
      throw new Error('native origin expired')
    return handle(command, args)
  })
  await initializeSessionBinding()
})

const switchIdentity = async (backendKey = identity.backendKey) => {
  identity = { ...identity, backendKey, sessionEpoch: ++epoch }
  await initializeSessionBinding()
}
const calls = (command: string) => native.invoke.mock.calls.filter(([name]) => name === command)
const loadLocalPage = (store: ReturnType<typeof useChatStore>) => {
  store.sessionList = [
    {
      account: '',
      activeTime: 1,
      avatar: '',
      id: '3',
      detailId: '3',
      hotFlag: 0,
      name: 'fixture',
      roomId: '3',
      text: '',
      type: 1,
      unreadCount: 0,
      top: false,
      operate: 0,
      hide: false,
      muteNotification: 0,
      shield: false,
      allowScanEnter: false
    }
  ]
  return store.setAllSessionMsgList(20)
}

const readSession = (roomId: string): SessionItem => ({
  account: '',
  activeTime: 1,
  avatar: '',
  id: roomId,
  detailId: roomId,
  hotFlag: 0,
  name: 'fixture',
  roomId,
  text: '',
  type: 1,
  unreadCount: 2,
  top: false,
  operate: 0,
  hide: false,
  muteNotification: 0,
  shield: false,
  allowScanEnter: false
})

describe('#348 real chat-store / native-IPC adapter seam', () => {
  it.each(['http://a/api', 'http://b/api'])(
    'queued read retains enqueue origin and settles after same UID switch to %s',
    async (backend) => {
      let finishFirst!: (value: unknown) => void
      handle = (command, args) => {
        if (command === 'im_request_command' && args.url === ImUrlEnum.MARK_MSG_READ) {
          if (args.body.roomId === '101')
            return new Promise((resolve) => {
              finishFirst = resolve
            })
          return true
        }
      }
      const store = useChatStore()
      const firstSession = readSession('101'),
        queuedSession = readSession('102')
      store.sessionList = [firstSession, queuedSession]
      store.sessionMap = { '101': firstSession, '102': queuedSession }
      const first = store.markSessionRead('101')
      const queued = store.markSessionRead('102')
      const origin = { ...identity }
      try {
        await vi.waitFor(() => expect(finishFirst).toBeTypeOf('function'))
        await switchIdentity(backend)
        const freshSession = readSession('103')
        store.sessionList = [freshSession]
        store.sessionMap = { '103': freshSession }
        const fresh = store.markSessionRead('103')
        finishFirst(true)
        await Promise.all([first, queued, fresh])
        await flushPromises()
        const reads = calls('im_request_command').filter(([, args]) => args.url === ImUrlEnum.MARK_MSG_READ)
        expect(reads.map(([, args]) => [args.body.roomId, args.binding])).toEqual([
          ['101', origin],
          ['103', identity]
        ])
      } finally {
        finishFirst?.(true)
      }
    }
  )
  it('a delayed identity lookup cannot adopt a new account scope for an old local-page action', async () => {
    let finishLookup!: (value: unknown) => void
    native.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve
        })
    )
    const store = useChatStore()
    const page = loadLocalPage(store)
    await vi.waitFor(() => expect(finishLookup).toBeTypeOf('function'))
    await switchIdentity('http://b/api')
    finishLookup({ sessionEpoch: identity.sessionEpoch, binding: { ...identity } })
    await page
    await flushPromises()
    expect(calls('page_msg')).toHaveLength(0)
    expect(store.messageMap['3']).toBeUndefined()
  })

  it('same-session reads keep their original rooms while waiting in FIFO', async () => {
    let finishFirst!: (value: unknown) => void
    handle = (command, args) => {
      if (command === 'im_request_command' && args.url === ImUrlEnum.MARK_MSG_READ) {
        if (args.body.roomId === '101')
          return new Promise((resolve) => {
            finishFirst = resolve
          })
        return true
      }
    }
    const store = useChatStore()
    const a = readSession('101'),
      b = readSession('102')
    store.sessionList = [a, b]
    store.sessionMap = { '101': a, '102': b }
    const first = store.markSessionRead('101'),
      second = store.markSessionRead('102')
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf('function'))
    b.roomId = '999'
    finishFirst(true)
    await Promise.all([first, second])
    await flushPromises()
    const reads = calls('im_request_command').filter(([, args]) => args.url === ImUrlEnum.MARK_MSG_READ)
    expect(reads.map(([, args]) => [args.body.roomId, args.binding])).toEqual([
      ['101', identity],
      ['102', identity]
    ])
  })

  it('a failed first read does not strand the next queued read', async () => {
    let failFirst!: (reason: unknown) => void
    handle = (command, args) => {
      if (command === 'im_request_command' && args.url === ImUrlEnum.MARK_MSG_READ) {
        if (args.body.roomId === '101')
          return new Promise((_resolve, reject) => {
            failFirst = reject
          })
        return true
      }
    }
    const store = useChatStore()
    const a = readSession('101'),
      b = readSession('102')
    store.sessionList = [a, b]
    store.sessionMap = { '101': a, '102': b }
    const first = store.markSessionRead('101'),
      second = store.markSessionRead('102')
    await vi.waitFor(() => expect(failFirst).toBeTypeOf('function'))
    failFirst(new Error('fixture read transport failure'))
    await Promise.all([first, second])
    await flushPromises()
    const reads = calls('im_request_command').filter(([, args]) => args.url === ImUrlEnum.MARK_MSG_READ)
    expect(reads.map(([, args]) => args.body.roomId)).toEqual(['101', '102'])
  })

  it('numeric server createTime crosses the real cache adapter as a lossless timestamp string', async () => {
    handle = (command, args) => {
      if (command === 'page_msg') return { list: [message()], cursor: '', isLast: true, total: 1 }
      if (command === 'read_thinking_cache') return { items: [], loadedTriggerIds: [], visibleTriggerIds: ['10'] }
      if (command === 'im_request_command') return [{ ...metadata(1), createTime: 1700000000000 }]
      if (command === 'cache_thinking_metadata') {
        if (typeof args.items[0].createTime !== 'string') throw new Error('native DTO requires createTime string')
        return ['10']
      }
    }
    const store = useChatStore()
    await loadLocalPage(store)
    await vi.waitFor(() => expect(store.thinkingMetadataLoaded.get('3')?.has('10')).toBe(true))
    expect(calls('cache_thinking_metadata')[0][1].items[0].createTime).toBe('2023-11-14T22:13:20.000Z')
    expect(store.getThinkingStatesByTriggerMsg('3', '10')[0].endTime).toBe(1700000000000)
  })

  it('local page and successful thinking body are readable while metadata HTTP is still pending', async () => {
    let finish!: (value: unknown) => void
    handle = (command) => {
      if (command === 'page_msg') return { list: [message()], cursor: '', isLast: true, total: 1 }
      if (command === 'read_thinking_cache') return disk(1)
      if (command === 'im_request_command')
        return new Promise((resolve) => {
          finish = resolve
        })
      if (command === 'cache_thinking_metadata') return ['10']
    }
    const store = useChatStore()
    await loadLocalPage(store)
    expect(store.messageMap['3']['10']).toBeDefined()
    expect(store.getThinkingStatesByTriggerMsg('3', '10')[0].cachedBody).toBe('')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(store.thinkingMetadataLoaded.get('3')?.has('10')).toBe(false)
    finish([])
    await vi.waitFor(() => expect(store.thinkingMetadataLoaded.get('3')?.has('10')).toBe(true))
  })

  it.each(['http://a/api', 'http://b/api'])(
    'same UID relogin/backend %s drops late page and metadata instead of binding to the new scope',
    async (backend) => {
      let finish!: (value: unknown) => void
      handle = (command) =>
        command === 'page_msg'
          ? new Promise((resolve) => {
              finish = resolve
            })
          : disk()
      const store = useChatStore()
      const page = loadLocalPage(store)
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
      const origin = { ...identity }
      await switchIdentity(backend)
      finish({ list: [message()], cursor: '', isLast: true, total: 1 })
      await page
      expect(store.messageMap['3']).toBeUndefined()
      expect(calls('page_msg')[0][1].binding).toEqual(origin)
      expect(calls('cache_thinking_metadata')).toHaveLength(0)
    }
  )

  it('failed metadata keeps successful cache, creates no receipt, and is retryable; successful empty creates a receipt', async () => {
    let failed = true
    handle = (command) => {
      if (command === 'page_msg') return { list: [message()], cursor: '', isLast: true, total: 1 }
      if (command === 'read_thinking_cache') return disk(1)
      if (command === 'im_request_command') {
        if (failed) throw new Error('fixture HTTP failure')
        return []
      }
      if (command === 'cache_thinking_metadata') return ['10']
    }
    const store = useChatStore()
    await loadLocalPage(store)
    await vi.waitFor(() => expect(store.thinkingCacheErrors['3']).toBeDefined())
    expect(store.getThinkingStatesByTriggerMsg('3', '10')[0].cachedBody).toBe('')
    expect(calls('cache_thinking_metadata')).toHaveLength(0)
    failed = false
    await store.loadThinkingByTriggerForMessages('3', [message()])
    expect(store.thinkingMetadataLoaded.get('3')?.has('10')).toBe(true)
    expect(calls('cache_thinking_metadata')).toHaveLength(1)
  })

  it('pending disk state without START/RUN is confirmed by exact END detail, not a mismatching run', async () => {
    handle = (command, args) => {
      if (command === 'page_msg') return { list: [message()], cursor: '', isLast: true, total: 1 }
      if (command === 'read_thinking_cache') return disk()
      if (command === 'im_request_command')
        return args.url === ImUrlEnum.AICLAW_THINKING_DETAIL
          ? { thinkingId: '100', roomId: '3', triggerMsgId: '10', aiclawUid: '20', clientRunId: 'real-run', status: 1 }
          : []
      if (command === 'cache_thinking_metadata') return ['10']
    }
    const store = useChatStore()
    await loadLocalPage(store)
    expect(store.getThinkingStatesByTriggerMsg('3', '10')[0].status).toBe('pending')
    store.finalizeThinking('100', { roomId: '3', fromUid: '20', clientRunId: 'wrong-run', status: 'complete' })
    await vi.waitFor(() =>
      expect(calls('im_request_command').some(([, args]) => args.url === ImUrlEnum.AICLAW_THINKING_DETAIL)).toBe(true)
    )
    expect(store.getThinkingStatesByTriggerMsg('3', '10')[0].status).toBe('pending')
    store.finalizeThinking('100', { roomId: '3', fromUid: '20', clientRunId: 'real-run', status: 'complete' })
    await vi.waitFor(() => expect(store.getThinkingStatesByTriggerMsg('3', '10')[0].status).toBe('complete'))
    expect(store.getThinkingStatesByTriggerMsg('3', '10')[0].clientRunId).toBe('real-run')
    store.clearThinking()
  })

  it('deleted/cleared triggers suppress queued START and late metadata in the same session', async () => {
    let finish!: (value: unknown) => void
    handle = (command) => {
      if (command === 'page_msg') return { list: [message()], cursor: '', isLast: true, total: 1 }
      if (command === 'read_thinking_cache') return disk(1)
      if (command === 'im_request_command')
        return new Promise((resolve) => {
          finish = resolve
        })
    }
    const store = useChatStore()
    await loadLocalPage(store)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    store.clearRoomMessages('3')
    store.startThinking({ thinkingId: '101', fromUid: '20', roomId: '3', triggerMsgId: '10' })
    finish([metadata(1)])
    await vi.waitFor(() => expect(store.thinkingByTrigger.get('3')).toBeUndefined())
    expect(calls('cache_thinking_metadata')).toHaveLength(0)
  })

  it('successful empty body is persisted; transport failure is not bodyLoaded success and can retry', async () => {
    let failed = true
    handle = (command, args) => {
      if (command === 'read_thinking_cache') return { items: [], loadedTriggerIds: [] }
      if (command === 'im_request_command') {
        if (args.url === ImUrlEnum.AICLAW_THINKING_BY_TRIGGER) return [metadata(1)]
        if (failed) throw new Error('fixture detail failure')
        return { thinkingId: '100', roomId: '3', triggerMsgId: '10', aiclawUid: '20', status: 1, content: null }
      }
      if (command === 'cache_thinking_metadata') return ['10']
    }
    const binding = await captureSessionBinding()
    await expect(loadThinkingBody(state(), binding)).rejects.toThrow()
    expect(calls('cache_thinking_body')).toHaveLength(0)
    failed = false
    const [a, b] = await Promise.all([loadThinkingBody(state(), binding), loadThinkingBody(state(), binding)])
    expect(a.content).toBe('')
    expect(b).toEqual(a)
    expect(calls('cache_thinking_body')).toHaveLength(1)
  })

  it('a delayed unbound snapshot cannot erase an installed binding from the same native login epoch', async () => {
    identity = { ...identity, sessionEpoch: ++epoch }
    native.listeners.get('session-binding-changed')!({ payload: { sessionEpoch: epoch, binding: null } })
    let finish!: (value: unknown) => void
    native.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = initializeSessionBinding()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    native.listeners.get('session-binding-changed')!({ payload: { sessionEpoch: epoch, binding: identity } })
    finish({ sessionEpoch: epoch, binding: null })
    await pending
    expect(sessionBinding.value).toEqual(identity)
  })

  it('queued old WS envelope and supplied old IPC binding are rejected after same UID relogin', async () => {
    const consume = vi.fn()
    await listenBound('fixture-ws', consume)
    const binding = await captureSessionBinding()
    await switchIdentity()
    await native.listeners.get('fixture-ws')!({ payload: { binding, payload: { id: '10' } } })
    expect(consume).not.toHaveBeenCalled()
    await expect(loadThinkingBody(state(), binding)).rejects.toBeInstanceOf(SessionExpiredError)
    expect(calls('cache_thinking_body')).toHaveLength(0)
  })
})
