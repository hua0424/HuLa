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

const loadThinkingByTriggerMock = vi.hoisted(() => vi.fn(async () => []))
vi.mock('@/services/thinkingService', () => ({
  loadThinkingByTrigger: (...args: unknown[]) => loadThinkingByTriggerMock(...args)
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
  imRequest: vi.fn().mockResolvedValue({ list: [], cursor: '', isLast: true })
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

  it('同一 (room, aiclaw) 新思考覆盖旧思考，旧项以 error 留在桶中', () => {
    const store = useChatStore()
    store.startThinking(startPayload)
    store.startThinking({ ...startPayload, thinkingId: 'tk-002' })

    const bucket = store.thinkingByTrigger.get(ROOM_ID)?.get(MSG_ID)
    expect(bucket).toHaveLength(2)
    expect(bucket![0].thinkingId).toBe('tk-001')
    expect(bucket![0].status).toBe('error')
    expect(bucket![0].errorMsg).toBe('Superseded by new thinking')
    expect(bucket![1].thinkingId).toBe('tk-002')
    expect(bucket![1].status).toBe('thinking')

    expect(store.thinkingStreams.get(`${ROOM_ID}:${AICLAW_ID}`)!.thinkingId).toBe('tk-002')
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
  })

  const makeServerItem = (overrides: Partial<any> = {}) => ({
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
      roomId: Number(ROOM_ID),
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
