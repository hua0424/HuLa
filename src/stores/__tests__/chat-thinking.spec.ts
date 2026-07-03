import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-010 S2：思考-回复解耦的 store 层单元测试。
 *
 * 用真实 chat store（createPinia + useChatStore），只 mock 模块级会在 happy-dom 下
 * 加载失败 / 触发网络副作用的依赖。
 */

// chat.ts line 55 在模块加载时 new Worker(timer.worker)，happy-dom 下不可用。
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
import { ImUrlEnum } from '@/enums'
import { imRequest } from '@/utils/ImRequestUtils'
import type { UserItem } from '@/services/types.ts'

const ROOM_ID = '1001'
const AICLAW_ID = 2001

const startPayload = {
  thinkingId: 'tk-001',
  fromUid: AICLAW_ID,
  roomId: Number(ROOM_ID),
  triggerMsgId: 'msg-123',
  aiclawName: 'TestBot',
  aiclawAvatar: ''
}

describe('useChatStore thinking lifecycle (REQ-010 S2)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('startThinking 创建活动思考项', () => {
    const store = useChatStore()
    store.startThinking(startPayload)

    const key = `${ROOM_ID}:${AICLAW_ID}`
    expect(store.thinkingStreams.has(key)).toBe(true)
    const state = store.thinkingStreams.get(key)!
    expect(state.thinkingId).toBe('tk-001')
    expect(state.status).toBe('thinking')
    expect(state.collapsed).toBe(false)
  })

  it('finalizeThinking(complete) 立即归档并从 thinkingStreams 移除', () => {
    const store = useChatStore()
    store.startThinking(startPayload)

    store.finalizeThinking('tk-001', { status: 'complete', durationMs: 2500 })

    expect(store.thinkingStreams.has(`${ROOM_ID}:${AICLAW_ID}`)).toBe(false)

    const archive = store.thinkingArchive.get(ROOM_ID)
    expect(archive).toBeDefined()
    expect(archive!.length).toBe(1)
    expect(archive![0].thinkingId).toBe('tk-001')
    expect(archive![0].status).toBe('complete')
    expect(archive![0].durationMs).toBe(2500)
    expect(archive![0].collapsed).toBe(true)
  })

  it('finalizeThinking(error) 也立即归档', () => {
    const store = useChatStore()
    store.startThinking(startPayload)

    store.finalizeThinking('tk-001', { status: 'error', errorMsg: 'Rate limited' })

    expect(store.thinkingStreams.has(`${ROOM_ID}:${AICLAW_ID}`)).toBe(false)
    const archive = store.thinkingArchive.get(ROOM_ID)
    expect(archive!.length).toBe(1)
    expect(archive![0].status).toBe('error')
    expect(archive![0].errorMsg).toBe('Rate limited')
  })

  it('同一 (room, aiclaw) 新思考覆盖旧思考，旧项以 error 归档', () => {
    const store = useChatStore()
    store.startThinking(startPayload)

    store.startThinking({
      ...startPayload,
      thinkingId: 'tk-002'
    })

    const archive = store.thinkingArchive.get(ROOM_ID)
    expect(archive!.length).toBe(1)
    expect(archive![0].thinkingId).toBe('tk-001')
    expect(archive![0].status).toBe('error')
    expect(archive![0].errorMsg).toBe('Superseded by new thinking')

    expect(store.thinkingStreams.get(`${ROOM_ID}:${AICLAW_ID}`)!.thinkingId).toBe('tk-002')
  })

  it('finalizeThinking 后 currentRoomThinkings 为空（无 zombie card）', () => {
    const store = useChatStore()
    const globalStore = useGlobalStore()
    globalStore.currentSessionRoomId = ROOM_ID

    store.startThinking(startPayload)
    expect(store.currentRoomThinkings.length).toBe(1)

    store.finalizeThinking('tk-001', { status: 'complete', durationMs: 1000 })
    expect(store.currentRoomThinkings.length).toBe(0)
  })

  it('归档按房间最多保留 10 条', () => {
    const store = useChatStore()
    for (let i = 0; i < 12; i++) {
      store.startThinking({ ...startPayload, thinkingId: `tk-${i}`, fromUid: AICLAW_ID + i })
      store.finalizeThinking(`tk-${i}`, { status: 'complete', durationMs: 100 })
    }

    const archive = store.thinkingArchive.get(ROOM_ID)
    expect(archive!.length).toBe(10)
    expect(archive![0].thinkingId).toBe('tk-11')
  })

  it('clearThinking 直接丢弃活动思考，不归档', () => {
    const store = useChatStore()
    store.startThinking(startPayload)

    store.clearThinking(ROOM_ID, AICLAW_ID)

    expect(store.thinkingStreams.has(`${ROOM_ID}:${AICLAW_ID}`)).toBe(false)
    expect(store.thinkingArchive.get(ROOM_ID)?.length ?? 0).toBe(0)
  })

  it('未知 thinkingId 的 finalizeThinking 为 no-op', () => {
    const store = useChatStore()
    store.startThinking(startPayload)

    store.finalizeThinking('non-existent', { status: 'complete' })

    expect(store.thinkingStreams.has(`${ROOM_ID}:${AICLAW_ID}`)).toBe(true)
    expect(store.thinkingArchive.get(ROOM_ID)?.length ?? 0).toBe(0)
  })
})

describe('useChatStore loadThinkingArchive (#136)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(imRequest).mockClear()
  })

  const makeServerItem = (
    overrides: Partial<{
      id: number
      aiclawUid: number
      triggerMsgId: number
      status: number
      durationMs: number
      createTime: string
    }> = {}
  ) => ({
    id: 3001,
    aiclawUid: AICLAW_ID,
    triggerMsgId: 9001,
    status: 1,
    durationMs: 1200,
    createTime: '2026-07-04T10:00:00.000Z',
    ...overrides
  })

  it('首次加载调用 AICLAW_THINKING_LIST 并按元数据映射为 ThinkingState', async () => {
    const store = useChatStore()
    vi.mocked(imRequest).mockResolvedValueOnce({
      list: [makeServerItem({ id: 3001, status: 1, durationMs: 1200 })],
      cursor: '',
      isLast: true
    })

    const result = await store.loadThinkingArchive(ROOM_ID)

    expect(result).toBe(true)
    expect(imRequest).toHaveBeenCalledTimes(1)
    expect(imRequest).toHaveBeenLastCalledWith({
      url: ImUrlEnum.AICLAW_THINKING_LIST,
      params: { roomId: Number(ROOM_ID), pageSize: 10 }
    })

    const archive = store.thinkingArchive.get(ROOM_ID)
    expect(archive?.length).toBe(1)
    expect(archive![0].thinkingId).toBe('3001')
    expect(archive![0].aiclawId).toBe(AICLAW_ID)
    expect(archive![0].status).toBe('complete')
    expect(archive![0].durationMs).toBe(1200)
    expect(archive![0].collapsed).toBe(true)
    expect(store.thinkingArchiveLoaded.has(ROOM_ID)).toBe(true)
  })

  it('已加载/加载中的房间不再重复请求', async () => {
    const store = useChatStore()
    vi.mocked(imRequest).mockResolvedValueOnce({
      list: [makeServerItem()],
      cursor: '',
      isLast: true
    })

    await store.loadThinkingArchive(ROOM_ID)
    const result = await store.loadThinkingArchive(ROOM_ID)

    expect(result).toBe(true)
    expect(imRequest).toHaveBeenCalledTimes(1)
  })

  it('合并服务端列表时与现有归档去重并按结束时间倒序', async () => {
    const store = useChatStore()
    // 预置一条同 thinkingId 的现有归档（时间更晚），验证不会被服务端条目覆盖/重复
    store.thinkingArchive.set(ROOM_ID, [
      {
        thinkingId: '3001',
        aiclawId: AICLAW_ID,
        aiclawName: 'Old',
        aiclawAvatar: '',
        roomId: ROOM_ID,
        status: 'complete',
        startTime: new Date('2026-07-04T10:55:00.000Z').getTime(),
        endTime: new Date('2026-07-04T11:00:00.000Z').getTime(),
        collapsed: true
      }
    ])

    vi.mocked(imRequest).mockResolvedValueOnce({
      list: [
        makeServerItem({ id: 3001, createTime: '2026-07-04T10:00:01.000Z' }),
        makeServerItem({ id: 3002, createTime: '2026-07-04T09:00:00.000Z', durationMs: 800 })
      ],
      cursor: '',
      isLast: true
    })

    await store.loadThinkingArchive(ROOM_ID)

    const archive = store.thinkingArchive.get(ROOM_ID)
    expect(archive?.length).toBe(2)
    // 3001 已存在应保留，不重复
    expect(archive!.filter((i) => i.thinkingId === '3001').length).toBe(1)
    // 按结束时间倒序：3001（11:00:00）在前，3002（09:00:00）在后
    expect(archive![0].thinkingId).toBe('3001')
    expect(archive![0].aiclawName).toBe('Old')
    expect(archive![1].thinkingId).toBe('3002')
  })

  it('groupStore 命中时回填 aiclaw 名称和头像，否则回退到默认值', async () => {
    const store = useChatStore()
    const globalStore = useGlobalStore()
    const groupStore = useGroupStore()

    globalStore.currentSessionRoomId = ROOM_ID
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

    vi.mocked(imRequest).mockResolvedValueOnce({
      list: [makeServerItem({ id: 4001 })],
      cursor: '',
      isLast: true
    })

    await store.loadThinkingArchive(ROOM_ID)

    const item = store.thinkingArchive.get(ROOM_ID)![0]
    expect(item.aiclawName).toBe('SrvBot')
    expect(item.aiclawAvatar).toBe('srv.png')

    // 另一个不存在的 uid 应回退
    vi.mocked(imRequest).mockResolvedValueOnce({
      list: [makeServerItem({ id: 4002, aiclawUid: 9999 })],
      cursor: '',
      isLast: true
    })
    await store.loadThinkingArchive('9999')
    const fallback = store.thinkingArchive.get('9999')![0]
    expect(fallback.aiclawName).toBe('AI')
    expect(fallback.aiclawAvatar).toBe('')
  })
})
