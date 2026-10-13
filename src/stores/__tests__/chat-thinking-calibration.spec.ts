import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#403：在线程在线校准（30s 单 in-flight、上限 64 ID、仅当前可见房间）。
 * 只用精确服务端终态 complete/error；运行中/未知保持未知，不强制结束。
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

const loadThinkingByTriggerMock = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<any[]>>(async () => []))
const loadThinkingDetailMock = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<any>>(async () => null))
const imRequestSilentMock = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<any>>(async () => []))
vi.mock('@/services/thinkingService', () => ({
  loadThinkingByTrigger: (...args: any[]) => loadThinkingByTriggerMock(...args),
  loadThinkingDetail: (...args: any[]) => loadThinkingDetailMock(...args)
}))

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

vi.mock('@/utils/ImRequestUtils', () => ({
  markMsgRead: vi.fn().mockResolvedValue(undefined),
  getSessionDetail: vi.fn().mockResolvedValue(undefined),
  imRequest: vi.fn().mockResolvedValue({ list: [], cursor: '', isLast: true }),
  imRequestSilent: (...args: any[]) => imRequestSilentMock(...args)
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

import { useChatStore } from '@/stores/chat'
import { useGlobalStore } from '@/stores/global'

const ROOM_ID = '1001'
const AICLAW_ID = 2001
const MSG_ID = 'msg-123'

const startPayload = {
  thinkingId: 'tk-001',
  fromUid: AICLAW_ID,
  roomId: Number(ROOM_ID),
  triggerMsgId: MSG_ID,
  aiclawName: 'TestBot',
  aiclawAvatar: ''
}

const terminalDetail = {
  thinkingId: 'tk-001',
  roomId: ROOM_ID,
  aiclawUid: String(AICLAW_ID),
  triggerMsgId: MSG_ID,
  clientRunId: 'run-a',
  status: 1,
  durationMs: 5593
}

describe('#403 visible-room online calibration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    loadThinkingByTriggerMock.mockReset().mockResolvedValue([])
    loadThinkingDetailMock.mockReset().mockResolvedValue(null)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    useGlobalStore().currentSessionRoomId = ROOM_ID
  })

  afterEach(() => {
    try {
      useChatStore().stopOnlineThinkingCalibration()
    } catch {
      /* store already torn down */
    }
    vi.useRealTimers()
  })

  it('dropped END converges while staying online', async () => {
    const store = useChatStore()
    store.startThinking({ ...startPayload, clientRunId: 'run-a' })
    loadThinkingDetailMock.mockResolvedValueOnce({ ...terminalDetail })
    const completed = await store.reconcileVisibleRoomThinking()
    expect(completed).toBe(1)
    expect(loadThinkingDetailMock).toHaveBeenCalledTimes(1)
    expect(store.getThinkingStatesByTriggerMsg(ROOM_ID, MSG_ID)[0]).toMatchObject({
      status: 'complete',
      durationMs: 5593
    })
  })

  it('status0 long task keeps running, query failure stays unknown', async () => {
    const store = useChatStore()
    store.startThinking({ ...startPayload, clientRunId: 'run-a' })
    loadThinkingDetailMock.mockResolvedValueOnce({ ...terminalDetail, status: 0 })
    await store.reconcileVisibleRoomThinking()
    expect(store.thinkingStreams.size).toBe(1)
    loadThinkingDetailMock.mockReset().mockResolvedValue(null)
    await store.reconcileVisibleRoomThinking()
    expect(store.thinkingStreams.size).toBe(1)
    expect(loadThinkingDetailMock).toHaveBeenCalledTimes(1)
  })

  it('has_response alone never forces completion', async () => {
    const store = useChatStore()
    store.startThinking({ ...startPayload, clientRunId: 'run-a' })
    loadThinkingDetailMock.mockResolvedValueOnce({ ...terminalDetail, status: 0, hasResponse: 1 })
    await store.reconcileVisibleRoomThinking()
    expect(store.thinkingStreams.size).toBe(1)
  })

  it('only the current visible room is calibrated', async () => {
    const store = useChatStore()
    store.startThinking({ ...startPayload, clientRunId: 'run-a' })
    store.thinkingStreams.set('other-room:bot-9', {
      thinkingId: 'tk-other',
      aiclawId: 'bot-9',
      aiclawName: 'Bot',
      aiclawAvatar: '',
      roomId: 'other-room',
      triggerMsgId: 'msg-9',
      status: 'thinking',
      startTime: Date.now(),
      collapsed: false
    })
    loadThinkingDetailMock.mockImplementation(async (thinkingId: string) =>
      thinkingId === 'tk-001' ? { ...terminalDetail } : null
    )
    await store.reconcileVisibleRoomThinking()
    expect(loadThinkingDetailMock).toHaveBeenCalledTimes(1)
    expect(store.thinkingStreams.has(`${ROOM_ID}:${AICLAW_ID}`)).toBe(false)
    expect(store.thinkingStreams.get('other-room:bot-9')?.status).toBe('thinking')
  })

  it('leaving the room pauses calibration without touching states', async () => {
    const store = useChatStore()
    store.startThinking({ ...startPayload, clientRunId: 'run-a' })
    useGlobalStore().currentSessionRoomId = ''
    await store.reconcileVisibleRoomThinking()
    expect(loadThinkingDetailMock).not.toHaveBeenCalled()
    expect(store.thinkingStreams.size).toBe(1)
  })

  it('foreign/permission-denied detail never finalizes', async () => {
    const store = useChatStore()
    store.startThinking({ ...startPayload, clientRunId: 'run-a' })
    loadThinkingDetailMock.mockResolvedValueOnce({ ...terminalDetail, roomId: '9999' })
    await store.reconcileVisibleRoomThinking()
    expect(store.thinkingStreams.size).toBe(1)
  })

  it('old run mismatch and duplicates do not regress', async () => {
    const store = useChatStore()
    store.startThinking({ ...startPayload, clientRunId: 'run-a' })
    loadThinkingDetailMock.mockResolvedValueOnce({ ...terminalDetail, clientRunId: 'run-old' })
    await store.reconcileVisibleRoomThinking()
    expect(store.thinkingStreams.size).toBe(1)
    loadThinkingDetailMock.mockReset().mockResolvedValue({ ...terminalDetail })
    await store.reconcileVisibleRoomThinking()
    expect(store.thinkingStreams.size).toBe(0)
    loadThinkingDetailMock.mockClear()
    await store.reconcileVisibleRoomThinking()
    expect(loadThinkingDetailMock).not.toHaveBeenCalled()
  })

  it('caps a single tick at 64 IDs', async () => {
    const store = useChatStore()
    for (let i = 0; i < 70; i++) {
      store.thinkingStreams.set(`${ROOM_ID}:bot-${i}`, {
        thinkingId: `tk-${i}`,
        aiclawId: `bot-${i}`,
        aiclawName: 'Bot',
        aiclawAvatar: '',
        roomId: ROOM_ID,
        triggerMsgId: `msg-${i}`,
        status: 'thinking',
        startTime: Date.now(),
        collapsed: false
      })
    }
    loadThinkingDetailMock.mockResolvedValue(null)
    await store.reconcileVisibleRoomThinking()
    expect(loadThinkingDetailMock).toHaveBeenCalledTimes(64)
  })

  it('single in-flight: concurrent ticks collapse into one', async () => {
    const store = useChatStore()
    store.startThinking({ ...startPayload, clientRunId: 'run-a' })
    let resolveFirst!: (value: unknown) => void
    loadThinkingDetailMock.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve as (value: unknown) => void))
    )
    const first = store.reconcileVisibleRoomThinking()
    const second = await store.reconcileVisibleRoomThinking()
    expect(second).toBe(0)
    expect(loadThinkingDetailMock).toHaveBeenCalledTimes(1)
    resolveFirst(null)
    await first
  })

  it('offline and background pause the tick', async () => {
    const store = useChatStore()
    store.startThinking({ ...startPayload, clientRunId: 'run-a' })
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    await store.reconcileVisibleRoomThinking()
    expect(loadThinkingDetailMock).not.toHaveBeenCalled()
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    await store.reconcileVisibleRoomThinking()
    expect(loadThinkingDetailMock).not.toHaveBeenCalled()
  })

  it('30s interval converges and stop halts further ticks', async () => {
    vi.useFakeTimers()
    const store = useChatStore()
    store.startThinking({ ...startPayload, clientRunId: 'run-a' })
    loadThinkingDetailMock.mockResolvedValue({ ...terminalDetail })
    store.startOnlineThinkingCalibration()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(store.thinkingStreams.size).toBe(0)
    const calls = loadThinkingDetailMock.mock.calls.length
    expect(calls).toBeGreaterThan(0)
    store.stopOnlineThinkingCalibration()
    loadThinkingDetailMock.mockClear()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(loadThinkingDetailMock).not.toHaveBeenCalled()
  })
})
