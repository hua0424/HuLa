import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-014：思考卡内联锚定触发消息后的 chat store 单元测试。
 *
 * 用真实 chat store，只 mock 模块级会在 happy-dom 下加载失败 / 触发副作用的依赖。
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
import { useGroupStore } from '@/stores/group'
import { useAiclawStore } from '@/stores/aiclaw'
import type { UserItem } from '@/services/types.ts'

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

describe('useChatStore trigger-keyed thinking lifecycle (REQ-014)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    loadThinkingByTriggerMock.mockReset().mockResolvedValue([])
    loadThinkingDetailMock.mockReset().mockResolvedValue(null)
  })

  it('startThinking 创建活跃流并按 triggerMsgId 落入 thinkingByTrigger', () => {
    const store = useChatStore()
    store.startThinking(startPayload)

    expect(store.thinkingStreams.has(`${ROOM_ID}:${AICLAW_ID}`)).toBe(true)

    const bucket = store.thinkingByTrigger.get(ROOM_ID)?.get(MSG_ID)
    expect(bucket).toHaveLength(1)
    expect(bucket![0].thinkingId).toBe('tk-001')
    expect(bucket![0].status).toBe('thinking')
  })

  it('triggerMsgId 为空时落入底部桶 ""', () => {
    const store = useChatStore()
    store.startThinking({ ...startPayload, triggerMsgId: undefined })

    const bucket = store.thinkingByTrigger.get(ROOM_ID)?.get('')
    expect(bucket).toHaveLength(1)
    expect(bucket![0].triggerMsgId).toBeUndefined()
  })

  it('getBottomThinkingStates：null-trigger 进行中可见，完成后消失不入历史（P1 底部桶渲染出口）', () => {
    const store = useChatStore()

    // null-trigger（TUI 驱动 turn）进行中 → 底部可见
    store.startThinking({ ...startPayload, triggerMsgId: undefined })
    expect(store.getBottomThinkingStates(ROOM_ID)).toHaveLength(1)
    expect(store.getBottomThinkingStates(ROOM_ID)[0].thinkingId).toBe('tk-001')

    // 完成 → 从底部消失（历史不渲染，但仍留在 '' 桶中供其他语义使用）
    store.finalizeThinking('tk-001', { status: 'complete', durationMs: 800 })
    expect(store.getBottomThinkingStates(ROOM_ID)).toHaveLength(0)
    expect(store.thinkingByTrigger.get(ROOM_ID)?.get('')).toHaveLength(1)

    // error 同样不渲染
    store.startThinking({ ...startPayload, thinkingId: 'tk-002', triggerMsgId: undefined })
    expect(store.getBottomThinkingStates(ROOM_ID)).toHaveLength(1)
    store.finalizeThinking('tk-002', { status: 'error', errorMsg: 'x' })
    expect(store.getBottomThinkingStates(ROOM_ID)).toHaveLength(0)

    // 有 triggerMsgId 的思考不进入底部出口
    store.startThinking({ ...startPayload, thinkingId: 'tk-003' })
    expect(store.getBottomThinkingStates(ROOM_ID)).toHaveLength(0)
  })

  it('finalizeThinking(complete) 更新 thinkingByTrigger 并移除活跃流', () => {
    const store = useChatStore()
    store.startThinking(startPayload)

    store.finalizeThinking('tk-001', { status: 'complete', durationMs: 2500 })

    expect(store.thinkingStreams.has(`${ROOM_ID}:${AICLAW_ID}`)).toBe(false)

    const bucket = store.thinkingByTrigger.get(ROOM_ID)?.get(MSG_ID)
    expect(bucket).toHaveLength(1)
    expect(bucket![0].status).toBe('complete')
    expect(bucket![0].durationMs).toBe(2500)
    expect(bucket![0].collapsed).toBe(true)
  })

  it('finalizeThinking(error) 更新为错误状态', () => {
    const store = useChatStore()
    store.startThinking(startPayload)

    store.finalizeThinking('tk-001', { status: 'error', errorMsg: 'Rate limited' })

    const bucket = store.thinkingByTrigger.get(ROOM_ID)?.get(MSG_ID)
    expect(bucket![0].status).toBe('error')
    expect(bucket![0].errorMsg).toBe('Rate limited')
  })

  it('同房间不同 ID START 须核实旧终态与新活态，不凭抵达顺序覆盖', async () => {
    const store = useChatStore()
    store.startThinking(startPayload)
    loadThinkingDetailMock
      .mockResolvedValueOnce({
        thinkingId: 'tk-002',
        roomId: ROOM_ID,
        aiclawUid: String(AICLAW_ID),
        triggerMsgId: MSG_ID,
        status: 0
      })
      .mockResolvedValueOnce({
        thinkingId: 'tk-001',
        roomId: ROOM_ID,
        aiclawUid: String(AICLAW_ID),
        triggerMsgId: MSG_ID,
        status: 1
      })
    store.startThinking({ ...startPayload, thinkingId: 'tk-002' })
    expect(store.thinkingStreams.get(`${ROOM_ID}:${AICLAW_ID}`)?.thinkingId).toBe('tk-001')
    await vi.waitFor(() => expect(store.thinkingStreams.get(`${ROOM_ID}:${AICLAW_ID}`)?.thinkingId).toBe('tk-002'))
    const bucket = store.thinkingByTrigger.get(ROOM_ID)?.get(MSG_ID)
    expect(bucket).toHaveLength(2)
    expect(bucket![0].status).toBe('complete')
    expect(bucket![1].status).toBe('thinking')
  })

  it('both server states active never attributes late conflicting START to current run', async () => {
    const store = useChatStore()
    store.startThinking({ ...startPayload, thinkingId: 'tk-b', clientRunId: 'run-b' })
    loadThinkingDetailMock
      .mockResolvedValueOnce({
        thinkingId: 'tk-a',
        roomId: ROOM_ID,
        aiclawUid: String(AICLAW_ID),
        triggerMsgId: MSG_ID,
        clientRunId: 'run-a',
        status: 0
      })
      .mockResolvedValueOnce({
        thinkingId: 'tk-b',
        roomId: ROOM_ID,
        aiclawUid: String(AICLAW_ID),
        triggerMsgId: MSG_ID,
        clientRunId: 'run-b',
        status: 0
      })
    store.startThinking({ ...startPayload, thinkingId: 'tk-a', clientRunId: 'run-a' })
    await vi.waitFor(() => expect(loadThinkingDetailMock).toHaveBeenCalledTimes(2))
    expect(store.thinkingStreams.get(`${ROOM_ID}:${AICLAW_ID}`)?.thinkingId).toBe('tk-b')
    expect(store.getThinkingStatesByTriggerMsg(ROOM_ID, MSG_ID)).toHaveLength(1)
    store.clearThinking()
  })

  it('getThinkingStatesByTriggerMsg 返回对应消息下的思考数组', () => {
    const store = useChatStore()
    store.startThinking(startPayload)

    expect(store.getThinkingStatesByTriggerMsg(ROOM_ID, MSG_ID)).toHaveLength(1)
    expect(store.getThinkingStatesByTriggerMsg(ROOM_ID, 'other')).toHaveLength(0)
    expect(store.getThinkingStatesByTriggerMsg('9999', MSG_ID)).toHaveLength(0)
  })

  it('isCurrentRoomThinking 仅当存在 thinking 状态时为 true', () => {
    const store = useChatStore()
    const globalStore = useGlobalStore()
    globalStore.currentSessionRoomId = ROOM_ID

    store.startThinking(startPayload)
    expect(store.isCurrentRoomThinking).toBe(true)

    store.finalizeThinking('tk-001', { status: 'complete', durationMs: 1000 })
    expect(store.isCurrentRoomThinking).toBe(false)
  })

  it('string wire ID duplicate START is idempotent even after END/new run; wrong actor/room/run never closes', () => {
    const store = useChatStore()
    const start = { ...startPayload, roomId: ROOM_ID, fromUid: String(AICLAW_ID), clientRunId: 'run-a' }
    store.startThinking(start)
    const first = store.getThinkingStatesByTriggerMsg(ROOM_ID, MSG_ID)[0]
    const startTime = first.startTime
    store.startThinking(start)
    expect(first.status).toBe('thinking')
    expect(first.startTime).toBe(startTime)
    store.finalizeThinking('tk-001', {
      roomId: '9999',
      fromUid: String(AICLAW_ID),
      clientRunId: 'run-a',
      status: 'complete'
    })
    store.finalizeThinking('tk-001', { roomId: ROOM_ID, fromUid: '9999', clientRunId: 'run-a', status: 'complete' })
    store.finalizeThinking('tk-001', {
      roomId: ROOM_ID,
      fromUid: String(AICLAW_ID),
      clientRunId: 'run-b',
      status: 'complete'
    })
    expect(first.status).toBe('thinking')
    store.finalizeThinking('tk-001', {
      roomId: ROOM_ID,
      fromUid: String(AICLAW_ID),
      clientRunId: 'run-a',
      status: 'complete'
    })
    store.startThinking({ ...start, thinkingId: 'tk-002', clientRunId: 'run-b' })
    store.startThinking(start)
    expect(first.status).toBe('complete')
    expect(store.thinkingStreams.get(`${ROOM_ID}:${AICLAW_ID}`)?.thinkingId).toBe('tk-002')
    expect(store.getThinkingStatesByTriggerMsg(ROOM_ID, MSG_ID)).toHaveLength(2)
  })

  it('metadata-only thinking promotes to live stream when same START arrives', async () => {
    const store = useChatStore()
    loadThinkingByTriggerMock.mockResolvedValueOnce([
      {
        id: 'tk-001',
        aiclawUid: String(AICLAW_ID),
        triggerMsgId: MSG_ID,
        status: 0,
        createTime: '2026-07-20T10:00:00.000Z'
      }
    ])
    await store.loadThinkingByTriggerForMessages(ROOM_ID, [{ message: { id: MSG_ID } } as any])
    const state = store.getThinkingStatesByTriggerMsg(ROOM_ID, MSG_ID)[0]
    store.startThinking({ ...startPayload, roomId: ROOM_ID, fromUid: String(AICLAW_ID), clientRunId: 'run-a' })
    expect(store.thinkingStreams.get(`${ROOM_ID}:${AICLAW_ID}`)).toBe(state)
    expect(state.startTime).toBe(new Date('2026-07-20T10:00:00.000Z').getTime())
    store.finalizeThinking('tk-001', { roomId: ROOM_ID, clientRunId: 'run-a', status: 'complete' })
    expect(state.status).toBe('complete')
  })

  it('old END recovered after next START preserves next active run', async () => {
    const store = useChatStore()
    store.startThinking({
      ...startPayload,
      thinkingId: 'tk-next',
      roomId: ROOM_ID,
      fromUid: String(AICLAW_ID),
      clientRunId: 'run-next'
    })
    loadThinkingDetailMock.mockResolvedValueOnce({
      thinkingId: 'tk-old',
      roomId: ROOM_ID,
      aiclawUid: String(AICLAW_ID),
      triggerMsgId: 'msg-old',
      clientRunId: 'run-old',
      status: 1
    })
    store.finalizeThinking('tk-old', {
      roomId: ROOM_ID,
      fromUid: String(AICLAW_ID),
      clientRunId: 'run-old',
      status: 'complete'
    })
    await vi.waitFor(() => expect(store.getThinkingStatesByTriggerMsg(ROOM_ID, 'msg-old')[0]?.status).toBe('complete'))
    expect(store.thinkingStreams.get(`${ROOM_ID}:${AICLAW_ID}`)?.thinkingId).toBe('tk-next')
    expect(store.getThinkingStatesByTriggerMsg(ROOM_ID, MSG_ID)[0]?.status).toBe('thinking')
    store.clearThinking()
  })

  it('unseen old START after new START cannot supersede active new run', async () => {
    const store = useChatStore()
    store.startThinking({ ...startPayload, thinkingId: 'tk-new', clientRunId: 'run-new' })
    loadThinkingDetailMock.mockResolvedValueOnce({
      thinkingId: 'tk-old',
      roomId: ROOM_ID,
      aiclawUid: String(AICLAW_ID),
      triggerMsgId: 'msg-old',
      clientRunId: 'run-old',
      status: 1
    })
    store.startThinking({ ...startPayload, thinkingId: 'tk-old', triggerMsgId: 'msg-old', clientRunId: 'run-old' })
    expect(store.thinkingStreams.get(`${ROOM_ID}:${AICLAW_ID}`)?.thinkingId).toBe('tk-new')
    await vi.waitFor(() => expect(store.getThinkingStatesByTriggerMsg(ROOM_ID, 'msg-old')[0]?.status).toBe('complete'))
    expect(store.thinkingStreams.get(`${ROOM_ID}:${AICLAW_ID}`)?.status).toBe('thinking')
    store.clearThinking()
  })

  it('unverified collision remains pending; reconnect verifies dropped old END then admits new START', async () => {
    const store = useChatStore()
    store.startThinking({ ...startPayload, thinkingId: 'tk-old', clientRunId: 'run-old' })
    loadThinkingDetailMock.mockResolvedValueOnce(null)
    store.startThinking({ ...startPayload, thinkingId: 'tk-new', clientRunId: 'run-new' })
    await vi.waitFor(() => expect(loadThinkingDetailMock).toHaveBeenCalledTimes(1))
    expect(store.thinkingStreams.get(`${ROOM_ID}:${AICLAW_ID}`)?.thinkingId).toBe('tk-old')
    loadThinkingDetailMock
      .mockResolvedValueOnce({
        thinkingId: 'tk-old',
        roomId: ROOM_ID,
        aiclawUid: String(AICLAW_ID),
        triggerMsgId: MSG_ID,
        clientRunId: 'run-old',
        status: 1
      })
      .mockResolvedValueOnce({
        thinkingId: 'tk-new',
        roomId: ROOM_ID,
        aiclawUid: String(AICLAW_ID),
        triggerMsgId: MSG_ID,
        clientRunId: 'run-new',
        status: 0
      })
    await store.reconcileThinkingAfterReconnect()
    expect(store.getThinkingStatesByTriggerMsg(ROOM_ID, MSG_ID)[0]?.status).toBe('complete')
    expect(store.thinkingStreams.get(`${ROOM_ID}:${AICLAW_ID}`)?.thinkingId).toBe('tk-new')
    store.clearThinking()
  })

  it('null trigger detail recovers dropped START+END only into bottom history bucket', async () => {
    const store = useChatStore()
    loadThinkingDetailMock.mockResolvedValueOnce({
      thinkingId: 'tk-cli',
      roomId: ROOM_ID,
      aiclawUid: String(AICLAW_ID),
      triggerMsgId: null,
      clientRunId: 'run-cli',
      status: 1
    })
    store.finalizeThinking('tk-cli', {
      roomId: ROOM_ID,
      fromUid: String(AICLAW_ID),
      clientRunId: 'run-cli',
      status: 'complete'
    })
    await vi.waitFor(() => expect(store.thinkingByTrigger.get(ROOM_ID)?.get('')?.[0]?.status).toBe('complete'))
    expect(store.getBottomThinkingStates(ROOM_ID)).toHaveLength(0)
    store.clearThinking()
  })

  it('wrong-actor END cannot block later legitimate END for same ID', () => {
    const store = useChatStore()
    store.finalizeThinking('tk-001', {
      roomId: ROOM_ID,
      fromUid: 'wrong',
      clientRunId: 'run-wrong',
      status: 'complete'
    })
    store.finalizeThinking('tk-001', {
      roomId: ROOM_ID,
      fromUid: String(AICLAW_ID),
      clientRunId: 'run-a',
      status: 'complete'
    })
    store.startThinking({ ...startPayload, roomId: ROOM_ID, fromUid: String(AICLAW_ID), clientRunId: 'run-a' })
    expect(store.getThinkingStatesByTriggerMsg(ROOM_ID, MSG_ID)[0]?.status).toBe('complete')
    expect(store.thinkingStreams.size).toBe(0)
  })

  it('opaque IDs above JS safe integer retain exact room/actor/trigger correlation', () => {
    const store = useChatStore()
    const roomId = '9007199254740993'
    const fromUid = '9007199254740995'
    const thinkingId = '9007199254740997'
    store.startThinking({ thinkingId, roomId, fromUid, triggerMsgId: '9007199254740999', clientRunId: 'run-big' })
    store.finalizeThinking(thinkingId, { roomId: '9007199254740994', fromUid, status: 'complete' })
    expect(store.thinkingStreams.get(`${roomId}:${fromUid}`)?.status).toBe('thinking')
    store.finalizeThinking(thinkingId, { roomId, fromUid, clientRunId: 'run-big', status: 'complete' })
    expect(store.getThinkingStatesByTriggerMsg(roomId, '9007199254740999')[0]?.status).toBe('complete')
  })

  it('END before START buffers by exact ID+room and preserves the trigger anchor', () => {
    const store = useChatStore()
    store.finalizeThinking('tk-001', {
      roomId: ROOM_ID,
      fromUid: String(AICLAW_ID),
      clientRunId: 'run-a',
      status: 'complete'
    })
    expect(store.getThinkingStatesByTriggerMsg(ROOM_ID, MSG_ID)).toHaveLength(0)
    store.startThinking({ ...startPayload, roomId: ROOM_ID, fromUid: String(AICLAW_ID), clientRunId: 'run-a' })
    const state = store.getThinkingStatesByTriggerMsg(ROOM_ID, MSG_ID)[0]
    expect(state.status).toBe('complete')
    expect(state.triggerMsgId).toBe(MSG_ID)
    expect(store.thinkingStreams.size).toBe(0)
  })

  it('buffer rejects wrong actor/run, expires and evicts oldest at 64', () => {
    vi.useFakeTimers()
    try {
      const store = useChatStore()
      store.finalizeThinking('tk-001', { roomId: ROOM_ID, fromUid: 'other', status: 'complete' })
      store.startThinking(startPayload)
      expect(store.thinkingStreams.size).toBe(1)
      store.clearThinking()
      for (let i = 0; i < 65; i++) store.finalizeThinking(`unseen-${i}`, { roomId: ROOM_ID, status: 'complete' })
      store.startThinking({ ...startPayload, thinkingId: 'unseen-0' })
      expect(store.thinkingStreams.get(`${ROOM_ID}:${AICLAW_ID}`)?.status).toBe('thinking')
      store.finalizeThinking('late', { roomId: ROOM_ID, status: 'complete' })
      vi.advanceTimersByTime(30_001)
      store.startThinking({ ...startPayload, thinkingId: 'late' })
      expect(store.thinkingStreams.get(`${ROOM_ID}:${AICLAW_ID}`)?.status).toBe('thinking')
      store.clearThinking()
    } finally {
      vi.useRealTimers()
    }
  })

  it('authenticated detail recovers dropped START only with matching terminal owner/anchor/run', async () => {
    const store = useChatStore()
    const end = {
      thinkingId: 'tk-001',
      roomId: ROOM_ID,
      fromUid: String(AICLAW_ID),
      clientRunId: 'run-a',
      status: 'complete' as const
    }
    loadThinkingDetailMock.mockResolvedValueOnce({
      thinkingId: 'tk-001',
      roomId: ROOM_ID,
      aiclawUid: String(AICLAW_ID),
      triggerMsgId: MSG_ID,
      clientRunId: 'run-a',
      status: 1
    })
    store.finalizeThinking(end.thinkingId, end)
    await vi.waitFor(() => expect(store.getThinkingStatesByTriggerMsg(ROOM_ID, MSG_ID)[0]?.status).toBe('complete'))
    store.finalizeThinking('foreign', { ...end, roomId: '9999' })
    loadThinkingDetailMock.mockResolvedValueOnce({
      thinkingId: 'wrong',
      roomId: ROOM_ID,
      aiclawUid: String(AICLAW_ID),
      triggerMsgId: MSG_ID,
      clientRunId: 'run-a',
      status: 1
    })
    store.finalizeThinking('wrong-room', { ...end, roomId: '9998' })
    await vi.waitFor(() => expect(loadThinkingDetailMock).toHaveBeenCalledTimes(3))
    expect(store.thinkingByTrigger.has('9998')).toBe(false)
    expect(store.thinkingByTrigger.has('9999')).toBe(false)
    store.clearThinking()
  })

  it('unknown END never reconstructs from wrong actor/run, malformed anchor or nonterminal detail', async () => {
    const store = useChatStore()
    const detail = {
      thinkingId: 'tk-001',
      roomId: ROOM_ID,
      aiclawUid: String(AICLAW_ID),
      triggerMsgId: MSG_ID,
      clientRunId: 'run-a',
      status: 1
    }
    for (const [thinkingId, mismatch] of [
      ['wrong-actor', { aiclawUid: '9999' }],
      ['wrong-run', { clientRunId: 'run-b' }],
      ['malformed-anchor', { triggerMsgId: Number.MAX_SAFE_INTEGER + 1 }],
      ['still-running', { status: 0 }]
    ] as const) {
      loadThinkingDetailMock.mockResolvedValueOnce({ ...detail, thinkingId, ...mismatch })
      store.finalizeThinking(thinkingId, {
        roomId: ROOM_ID,
        fromUid: String(AICLAW_ID),
        clientRunId: 'run-a',
        status: 'complete'
      })
      await Promise.resolve()
    }
    expect(store.thinkingByTrigger.has(ROOM_ID)).toBe(false)
    store.clearThinking()
  })

  it('late authorized detail is retried once after immediate miss, but not after clearance', async () => {
    vi.useFakeTimers()
    try {
      const store = useChatStore()
      loadThinkingDetailMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
        thinkingId: 'tk-001',
        roomId: ROOM_ID,
        aiclawUid: String(AICLAW_ID),
        triggerMsgId: MSG_ID,
        clientRunId: 'run-a',
        status: 1
      })
      store.finalizeThinking('tk-001', {
        roomId: ROOM_ID,
        fromUid: String(AICLAW_ID),
        clientRunId: 'run-a',
        status: 'complete'
      })
      await Promise.resolve()
      expect(store.thinkingByTrigger.has(ROOM_ID)).toBe(false)
      await vi.advanceTimersByTimeAsync(1000)
      expect(store.getThinkingStatesByTriggerMsg(ROOM_ID, MSG_ID)[0]?.status).toBe('complete')
      expect(loadThinkingDetailMock).toHaveBeenCalledTimes(2)
      store.clearThinking()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reconnect reconciles only exact owned server ID and terminal status after lost END', async () => {
    const store = useChatStore()
    store.startThinking({ ...startPayload, roomId: ROOM_ID, fromUid: String(AICLAW_ID), clientRunId: 'run-a' })
    loadThinkingDetailMock
      .mockResolvedValueOnce({
        thinkingId: 'tk-001',
        roomId: '9999',
        aiclawUid: String(AICLAW_ID),
        triggerMsgId: MSG_ID,
        clientRunId: 'run-a',
        status: 1
      })
      .mockResolvedValueOnce({
        thinkingId: 'tk-001',
        roomId: ROOM_ID,
        aiclawUid: String(AICLAW_ID),
        triggerMsgId: MSG_ID,
        clientRunId: 'run-a',
        status: 1,
        durationMs: 42
      })
    await store.reconcileThinkingAfterReconnect()
    expect(store.thinkingStreams.size).toBe(1)
    await store.reconcileThinkingAfterReconnect()
    expect(store.thinkingStreams.size).toBe(0)
    expect(store.getThinkingStatesByTriggerMsg(ROOM_ID, MSG_ID)[0]).toMatchObject({
      status: 'complete',
      durationMs: 42
    })
  })

  it('clearThinking(roomId) 清理该房间的 byTrigger 与 metadata', () => {
    const store = useChatStore()
    store.startThinking(startPayload)
    store.thinkingMetadataLoaded.set(ROOM_ID, new Set([MSG_ID]))

    store.clearThinking(ROOM_ID)

    expect(store.thinkingByTrigger.has(ROOM_ID)).toBe(false)
    expect(store.thinkingMetadataLoaded.has(ROOM_ID)).toBe(false)
  })
})

describe('useChatStore loadThinkingByTriggerForMessages (REQ-014)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    loadThinkingByTriggerMock.mockReset().mockResolvedValue([])
    loadThinkingDetailMock.mockReset().mockResolvedValue(null)
  })

  const makeServerItem = (
    overrides: Partial<{
      id: number | string
      aiclawUid: number | string
      triggerMsgId: number | string
      status: number
      durationMs: number
      createTime: string
    }> = {}
  ) => ({
    id: 3001,
    aiclawUid: AICLAW_ID,
    triggerMsgId: MSG_ID,
    status: 1,
    durationMs: 1200,
    createTime: '2026-07-20T10:00:00.000Z',
    ...overrides
  })

  const seedMember = () => {
    const groupStore = useGroupStore()
    groupStore.updateMemberCache(ROOM_ID, [
      {
        uid: String(AICLAW_ID),
        name: 'SrvBot',
        avatar: 'srv.png',
        activeStatus: 1,
        lastOptTime: Date.now(),
        account: 'bot'
      } as UserItem
    ])
  }

  it('首次加载调用 by-trigger 并按 triggerMsgId 归入桶', async () => {
    const store = useChatStore()
    seedMember()
    loadThinkingByTriggerMock.mockResolvedValueOnce([makeServerItem()])

    await store.loadThinkingByTriggerForMessages(ROOM_ID, [{ message: { id: MSG_ID } } as any])

    expect(loadThinkingByTriggerMock).toHaveBeenCalledTimes(1)
    expect(loadThinkingByTriggerMock).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      triggerMsgIds: [MSG_ID]
    })

    const bucket = store.thinkingByTrigger.get(ROOM_ID)?.get(MSG_ID)
    expect(bucket).toHaveLength(1)
    expect(bucket![0].thinkingId).toBe('3001')
    expect(bucket![0].aiclawName).toBe('SrvBot')
    expect(bucket![0].status).toBe('complete')
    expect(store.thinkingMetadataLoaded.get(ROOM_ID)?.has(MSG_ID)).toBe(true)
  })

  it('已加载过的 msgId 不再重复请求', async () => {
    const store = useChatStore()
    seedMember()
    loadThinkingByTriggerMock.mockResolvedValueOnce([makeServerItem()])

    await store.loadThinkingByTriggerForMessages(ROOM_ID, [{ message: { id: MSG_ID } } as any])
    await store.loadThinkingByTriggerForMessages(ROOM_ID, [{ message: { id: MSG_ID } } as any])

    expect(loadThinkingByTriggerMock).toHaveBeenCalledTimes(1)
  })

  it('与已有 thinkingId 去重，不覆盖现有状态', async () => {
    const store = useChatStore()
    seedMember()
    store.startThinking({
      thinkingId: '3001',
      fromUid: AICLAW_ID,
      roomId: Number(ROOM_ID),
      triggerMsgId: MSG_ID,
      aiclawName: 'LiveBot',
      aiclawAvatar: ''
    })

    loadThinkingByTriggerMock.mockResolvedValueOnce([makeServerItem({ id: 3001, aiclawUid: 9999 })])

    await store.loadThinkingByTriggerForMessages(ROOM_ID, [{ message: { id: MSG_ID } } as any])

    const bucket = store.thinkingByTrigger.get(ROOM_ID)?.get(MSG_ID)
    expect(bucket).toHaveLength(1)
    expect(bucket![0].aiclawName).toBe('LiveBot')
  })

  it('同 trigger 多 aiclaw 按开始时间升序排列', async () => {
    const store = useChatStore()
    seedMember()

    loadThinkingByTriggerMock.mockResolvedValueOnce([
      makeServerItem({ id: 3001, aiclawUid: AICLAW_ID, createTime: '2026-07-20T10:00:02.000Z', durationMs: 1000 }),
      makeServerItem({ id: 3002, aiclawUid: AICLAW_ID + 1, createTime: '2026-07-20T10:00:01.000Z', durationMs: 500 })
    ])

    await store.loadThinkingByTriggerForMessages(ROOM_ID, [{ message: { id: MSG_ID } } as any])

    const bucket = store.thinkingByTrigger.get(ROOM_ID)?.get(MSG_ID)
    expect(bucket).toHaveLength(2)
    expect(bucket![0].thinkingId).toBe('3002')
    expect(bucket![1].thinkingId).toBe('3001')
  })
})

/**
 * aichatoverview#222：无共同群的 AI（CodexAI/ClaudeCodeAI 这类只存在于单聊的好友）
 * 进不了 userListMap，思考卡标题曾泛化显示「AI」。回退链应为：
 * payload.aiclawName → groupStore（成员表/friendInfoCache）→ aiclawStore 管理面板名 → 'AI'。
 */
describe('#222 思考卡标题名字回退链', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    loadThinkingByTriggerMock.mockReset().mockResolvedValue([])
    loadThinkingDetailMock.mockReset().mockResolvedValue(null)
    imRequestSilentMock.mockReset().mockResolvedValue([])
  })

  const loadAiclawNames = async (list: Array<{ uid: string; name: string; adapterType?: string }>) => {
    imRequestSilentMock.mockResolvedValue(list)
    await useAiclawStore().ensureLoaded()
  }

  it('startThinking：payload 缺名时经 friendInfoCache 解析真名（getContactList 播种路径）', () => {
    useGroupStore().cacheFriendInfo(String(AICLAW_ID), { name: 'CodexAI' } as any)

    const store = useChatStore()
    store.startThinking({ thinkingId: 'tk-ai-1', fromUid: AICLAW_ID, roomId: Number(ROOM_ID), triggerMsgId: MSG_ID })

    const bucket = store.thinkingByTrigger.get(ROOM_ID)?.get(MSG_ID)
    expect(bucket![0].aiclawName).toBe('CodexAI')
  })

  it('startThinking：groupStore 无任何信息时回退 aiclawStore 管理面板名，不泛化为 AI', async () => {
    await loadAiclawNames([{ uid: String(AICLAW_ID), name: 'ClaudeCodeAI', adapterType: 'claudecode' }])

    const store = useChatStore()
    store.startThinking({ thinkingId: 'tk-ai-2', fromUid: AICLAW_ID, roomId: Number(ROOM_ID), triggerMsgId: MSG_ID })

    const bucket = store.thinkingByTrigger.get(ROOM_ID)?.get(MSG_ID)
    expect(bucket![0].aiclawName).toBe('ClaudeCodeAI')
  })

  it('历史元数据路径：无成员信息时同样回退 aiclawStore 管理面板名', async () => {
    await loadAiclawNames([{ uid: String(AICLAW_ID), name: 'ClaudeCodeAI', adapterType: 'claudecode' }])
    loadThinkingByTriggerMock.mockResolvedValueOnce([
      {
        id: 3001,
        aiclawUid: AICLAW_ID,
        triggerMsgId: MSG_ID,
        status: 1,
        durationMs: 1200,
        createTime: '2026-07-20T10:00:00.000Z'
      }
    ])

    const store = useChatStore()
    await store.loadThinkingByTriggerForMessages(ROOM_ID, [{ message: { id: MSG_ID } } as any])

    const bucket = store.thinkingByTrigger.get(ROOM_ID)?.get(MSG_ID)
    expect(bucket![0].aiclawName).toBe('ClaudeCodeAI')
  })

  it('payload 自带 aiclawName 时保持最高优先级（既有行为不变）', async () => {
    await loadAiclawNames([{ uid: String(AICLAW_ID), name: '面板名', adapterType: 'codex' }])
    useGroupStore().cacheFriendInfo(String(AICLAW_ID), { name: '缓存名' } as any)

    const store = useChatStore()
    store.startThinking({ ...startPayload, thinkingId: 'tk-ai-3' })

    const bucket = store.thinkingByTrigger.get(ROOM_ID)?.get(MSG_ID)
    expect(bucket![0].aiclawName).toBe('TestBot')
  })
})
