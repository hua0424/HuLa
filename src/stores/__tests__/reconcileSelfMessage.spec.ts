import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageStatusEnum, MsgEnum } from '@/enums'
import type { MessageType } from '@/services/types'

/**
 * #38 重复幽灵气泡 F1 修复：服务器回推的「自己发的消息」就地认领未确认的乐观气泡。
 *
 * 用真实 chat store（createPinia + useChatStore），只 mock 模块级会在 happy-dom 下
 * 加载失败 / 触发网络副作用的依赖，确保 reconcileSelfOptimisticMessage + updateMsg
 * 走真实实现，对真实 messageMap 生效。mock 风格对照 retry.spec.ts。
 */

// chat.ts line 55 在模块加载时 new Worker(timer.worker)，happy-dom 下不可用。
// vi.hoisted 会提升到所有 import 之前执行，确保 chat.ts 加载时全局 Worker 已就绪。
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

// Tauri 插件在模块加载/方法内会调原生，统一 no-op。
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getByLabel: vi.fn().mockResolvedValue(null) }
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

// vue-router useRoute 需要一个活动路由；mock 成 /message 即可（reconcile 不依赖路由）。
vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/message' }),
  useRouter: () => ({ push: vi.fn() })
}))

// 间接网络/原生副作用：mock 成 no-op，避免 pushMsg/updateSession 路径打网络。
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
import { useUserStore } from '@/stores/user'

const ROOM = 'room-9'
const ME = 'me-1'
const BASE_TIME = 1700000000000

// 构造一条「我发送的」失败态文本临时气泡（temp id 以 'T' 开头）
const makeTempMsg = (
  overrides: Partial<{ id: string; content: string; uid: string; status: MessageStatusEnum; sendTime: number }> = {}
): MessageType => ({
  fromUser: { uid: overrides.uid ?? ME, username: 'me', avatar: '', locPlace: '' },
  isCheck: false,
  sendTime: overrides.sendTime ?? BASE_TIME,
  message: {
    id: overrides.id ?? 'T1781432449441',
    roomId: ROOM,
    type: MsgEnum.TEXT,
    status: overrides.status ?? MessageStatusEnum.FAILED,
    sendTime: overrides.sendTime ?? BASE_TIME,
    body: { content: overrides.content ?? 'hello-retry' },
    messageMarks: {}
  }
})

// 构造服务器回推的同内容自发消息（带服务器雪花 id）
const makeServerMsg = (
  overrides: Partial<{ id: string; content: string; uid: string; sendTime: number }> = {}
): MessageType => ({
  fromUser: { uid: overrides.uid ?? ME, username: 'me', avatar: '', locPlace: '' },
  isCheck: false,
  sendTime: overrides.sendTime ?? BASE_TIME + 50,
  message: {
    id: overrides.id ?? '172411430087680',
    roomId: ROOM,
    type: MsgEnum.TEXT,
    status: MessageStatusEnum.SUCCESS,
    sendTime: overrides.sendTime ?? BASE_TIME + 50,
    body: { content: overrides.content ?? 'hello-retry' },
    messageMarks: {}
  }
})

const seedRoom = (store: ReturnType<typeof useChatStore>, entries: MessageType[]) => {
  const room: Record<string, MessageType> = {}
  for (const m of entries) {
    room[m.message.id] = m
  }
  store.messageMap[ROOM] = room
}

let store: ReturnType<typeof useChatStore>

beforeEach(() => {
  setActivePinia(createPinia())
  store = useChatStore()
  useGlobalStore().currentSessionRoomId = ROOM
  useUserStore().userInfo = { uid: ME } as never
})

describe('#38 reconcileSelfOptimisticMessage', () => {
  it('唯一匹配：就地认领失败临时气泡 -> 返回被认领的 tempId，temp 改名为服务器 id 且状态 SUCCESS，无重复气泡', () => {
    seedRoom(store, [makeTempMsg()])

    const result = store.reconcileSelfOptimisticMessage(makeServerMsg())

    expect(result).toBe('T1781432449441')
    const room = store.messageMap[ROOM]
    expect(Object.keys(room)).toHaveLength(1)
    expect(room['172411430087680']).toBeDefined()
    expect(room['172411430087680'].message.status).toBe(MessageStatusEnum.SUCCESS)
    expect(room['T1781432449441']).toBeUndefined()
  })

  it('内容不同：返回 null，两条都保留', () => {
    seedRoom(store, [makeTempMsg({ content: 'hello-retry' })])

    const result = store.reconcileSelfOptimisticMessage(makeServerMsg({ content: 'different-text' }))

    expect(result).toBeNull()
    expect(store.messageMap[ROOM]['T1781432449441']).toBeDefined()
  })

  it('候选已是 SUCCESS：返回 null，不动已确认消息', () => {
    seedRoom(store, [makeTempMsg({ status: MessageStatusEnum.SUCCESS })])

    const result = store.reconcileSelfOptimisticMessage(makeServerMsg())

    expect(result).toBeNull()
    expect(store.messageMap[ROOM]['T1781432449441']).toBeDefined()
  })

  it('发送者不同：返回 null', () => {
    seedRoom(store, [makeTempMsg({ uid: 'other-2' })])

    const result = store.reconcileSelfOptimisticMessage(makeServerMsg({ uid: ME }))

    expect(result).toBeNull()
    expect(store.messageMap[ROOM]['T1781432449441']).toBeDefined()
  })

  it('sendTime 超出放宽后的窗口（差 360000ms > 5 分钟）：返回 null', () => {
    seedRoom(store, [makeTempMsg({ sendTime: BASE_TIME })])

    const result = store.reconcileSelfOptimisticMessage(makeServerMsg({ sendTime: BASE_TIME + 360000 }))

    expect(result).toBeNull()
    expect(store.messageMap[ROOM]['T1781432449441']).toBeDefined()
  })

  it('sendTime 时钟偏差在放宽窗口内（差 120000ms < 5 分钟）：仍命中认领（旧 60s 窗口会漏配）', () => {
    seedRoom(store, [makeTempMsg({ sendTime: BASE_TIME })])

    const result = store.reconcileSelfOptimisticMessage(makeServerMsg({ sendTime: BASE_TIME + 120000 }))

    expect(result).toBe('T1781432449441')
    expect(store.messageMap[ROOM]['T1781432449441']).toBeUndefined()
    expect(store.messageMap[ROOM]['172411430087680']).toBeDefined()
  })

  it('多个同内容 T 临时候选（>=2）：启发式不可靠 -> 返回 null，两条都保留', () => {
    seedRoom(store, [makeTempMsg({ id: 'T1781432449441' }), makeTempMsg({ id: 'T1781432449999' })])

    const result = store.reconcileSelfOptimisticMessage(makeServerMsg())

    expect(result).toBeNull()
    expect(store.messageMap[ROOM]['T1781432449441']).toBeDefined()
    expect(store.messageMap[ROOM]['T1781432449999']).toBeDefined()
  })

  it('候选 id 非 T 前缀（纯数字文件临时 id，超出 #38 范围）：返回 null，不改名', () => {
    seedRoom(store, [makeTempMsg({ id: '1781432449441000' })])

    const result = store.reconcileSelfOptimisticMessage(makeServerMsg())

    expect(result).toBeNull()
    expect(store.messageMap[ROOM]['1781432449441000']).toBeDefined()
  })

  it('roomId 缺失 / 房间不存在：返回 null', () => {
    const result = store.reconcileSelfOptimisticMessage(makeServerMsg({ id: '172411430087680' }))
    expect(result).toBeNull()
  })

  it('toNum 归一化：sendTime 为数字字符串仍能匹配 -> 命中返回 tempId', () => {
    const temp = makeTempMsg({ sendTime: BASE_TIME })
    // 模拟本地持久化往返后 sendTime 退化为数字字符串
    temp.message.sendTime = String(BASE_TIME) as unknown as number
    temp.sendTime = String(BASE_TIME) as unknown as number
    seedRoom(store, [temp])

    const server = makeServerMsg({ sendTime: BASE_TIME + 50 })
    server.message.sendTime = String(BASE_TIME + 50) as unknown as number
    server.sendTime = String(BASE_TIME + 50) as unknown as number

    const result = store.reconcileSelfOptimisticMessage(server)

    expect(result).toBe('T1781432449441')
    expect(store.messageMap[ROOM]['172411430087680']).toBeDefined()
  })

  it('toNum 归一化：server sendTime 为非法串（-> NaN）时返回 null，不匹配', () => {
    seedRoom(store, [makeTempMsg({ sendTime: BASE_TIME })])

    const server = makeServerMsg({ sendTime: BASE_TIME + 50 })
    server.message.sendTime = 'not-a-date' as unknown as number
    server.sendTime = 'not-a-date' as unknown as number

    const result = store.reconcileSelfOptimisticMessage(server)

    expect(result).toBeNull()
    expect(store.messageMap[ROOM]['T1781432449441']).toBeDefined()
  })

  it('toNum 归一化：候选 sendTime 为 undefined（-> NaN）时返回 null，不匹配', () => {
    const temp = makeTempMsg({ sendTime: BASE_TIME })
    temp.message.sendTime = undefined as unknown as number
    temp.sendTime = undefined as unknown as number
    seedRoom(store, [temp])

    const result = store.reconcileSelfOptimisticMessage(makeServerMsg())

    expect(result).toBeNull()
    expect(store.messageMap[ROOM]['T1781432449441']).toBeDefined()
  })
})
