import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#483：当前页撤回/已知 thinking 的有界持续在线恢复（store 层）。
 *
 * 用真实 chat store，只 mock 传输层。覆盖：
 *  - 真实阅读窗口（视口相交行）驱动校准范围，而不是全房已加载列表末段；
 *  - 请求体已知 ID 用 knownMsgIds，窗口行必在回执里；
 *  - 无关高流量不让整轮降级为 partial（逐 ID 触及），被撤回的行仍单向收敛；
 *  - 分面完成语义：消息 ok 但思考未见终态 → partial；
 *  - 恢复触发：hidden/offline 不启新请求，恢复后仍有后续机会；同范围不重复触发。
 */

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
const web = vi.hoisted(() => ({
  bodies: [] as any[],
  handler: null as null | ((body: any) => unknown)
}))
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
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: any[]) => native.invoke(...args) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'home' }) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getByLabel: vi.fn(async () => null), getCurrent: () => ({ label: 'home' }) }
}))
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('@tauri-apps/plugin-notification', () => ({ sendNotification: vi.fn() }))
vi.mock('@/utils/PlatformConstants', () => ({
  isWeb: () => true,
  isMobile: () => false,
  isWindows: () => false,
  isMac: () => false
}))
vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: async (req: any) => {
    web.bodies.push(req?.body)
    return web.handler ? web.handler(req?.body) : null
  }
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

import { useChatStore } from '@/stores/chat'
import { useGlobalStore } from '@/stores/global'
import { initializeSessionBinding, type SessionIdentity } from '@/services/sessionBinding'
import type { ThinkingState } from '@/types/thinking'

const ROOM = '3'
const BASE_TIME = 1_700_000_000_000
let identity: SessionIdentity
let epoch = 900

/** 已加载 200 条，真实视口停在其中几条很旧的行上（距末尾远超 pageSize）。 */
const seedRoom = async (store: ReturnType<typeof useChatStore>) => {
  // 先切房并让切房副作用跑完，再播种消息；
  // 直接赋值会在 store 的房间切换清理里被整批删掉。
  useGlobalStore().currentSessionRoomId = ROOM
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  const rows: Record<string, unknown> = {}
  for (let i = 1; i <= 200; i++) {
    rows[String(i)] = {
      message: { id: String(i), sendTime: BASE_TIME + i * 1000, messageType: 1, content: `c${i}` }
    }
  }
  store.messageMap[ROOM] = rows as never
}

/** 按本轮请求体生成一个合法 envelope：逐条回执对齐 knownMsgIds。 */
const envelopeFor = (body: any, over: Record<string, unknown> = {}) => {
  const known: string[] = body?.knownMsgIds ?? []
  return {
    requestId: body?.requestId,
    schemaVersion: 'msg-window-v1',
    capabilities: ['messages', 'known-receipts'],
    items: [],
    complete: true,
    knownReceipts: known.map((id) => ({
      id,
      available: true,
      // 与服务端 KnownReceipt.message（ChatMessageResp）同形：外层是消息响应，内层才是 message
      message: { message: { id, sendTime: BASE_TIME + Number(id) * 1000, messageType: 1, content: `c${id}` } }
    })),
    knownComplete: true,
    thinkingAccess: true,
    thinkingTriggers: [],
    thinkingItems: [],
    thinkingComplete: true,
    thinkingKnownReceipts: [],
    thinkingKnownComplete: true,
    ...over
  }
}

const report = (store: ReturnType<typeof useChatStore>, id: string) =>
  store.reportReadingWindow(ROOM, {
    ids: [id],
    anchorId: id,
    anchorSendTime: BASE_TIME + Number(id) * 1000,
    atBottom: false
  })

beforeEach(async () => {
  setActivePinia(createPinia())
  Object.assign(window, { __TAURI_INTERNALS__: {} })
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
  identity = { backendKey: 'http://a/api', uid: '4', sessionEpoch: ++epoch }
  native.invoke.mockReset().mockImplementation(async (command: string, args: any) => {
    if (command === 'get_session_binding') return { sessionEpoch: identity.sessionEpoch, binding: { ...identity } }
    if (args?.binding && JSON.stringify(args.binding) !== JSON.stringify(identity))
      throw new Error('native origin expired')
    return undefined
  })
  web.bodies = []
  web.handler = (body: any) => envelopeFor(body)
  await initializeSessionBinding()
})

describe('#483 真实阅读窗口驱动校准范围', () => {
  it('视口停在 150 条之前的旧消息时，请求范围覆盖这些行而不是最新一页', async () => {
    const store = useChatStore()
    await seedRoom(store)
    store.reportReadingWindow(ROOM, {
      ids: ['50', '51', '52'],
      anchorId: '50',
      anchorSendTime: BASE_TIME + 50 * 1000,
      atBottom: false
    })
    const outcome = await store.calibrateWindow(ROOM, { force: true, requestId: 'req-old' })
    const body = web.bodies.at(-1)
    expect(body.fromId).toBe('50')
    expect(body.toId).toBe('52')
    expect(body.pageSize).toBeGreaterThanOrEqual(3)
    // 窗口行必须在回执里，否则服务端无法逐条纠正它们
    expect(body.knownMsgIds).toContain('50')
    expect(body.knownMsgIds).toContain('52')
    expect(outcome.ok).toBe(true)
  })

  it('未上报阅读窗口时退回 tail 快照（不虚构可见范围）', async () => {
    const store = useChatStore()
    await seedRoom(store)
    await store.calibrateWindow(ROOM, { force: true, requestId: 'req-tail' })
    const body = web.bodies.at(-1)
    expect(body.mode).toBe('tail')
    expect(body.fromId).toBe('181')
    expect(body.toId).toBe('200')
  })

  it('阅读窗口上报触发校准，同范围不重复，范围变化才再次触发', async () => {
    const store = useChatStore()
    await seedRoom(store)
    vi.useFakeTimers()
    try {
      report(store, '60')
      await vi.advanceTimersByTimeAsync(500)
      const first = web.bodies.length
      expect(first).toBeGreaterThan(0)
      report(store, '60')
      await vi.advanceTimersByTimeAsync(20_000)
      expect(web.bodies.length).toBe(first)
      report(store, '70')
      await vi.advanceTimersByTimeAsync(20_000)
      expect(web.bodies.length).toBeGreaterThan(first)
    } finally {
      vi.useRealTimers()
    }
  })

  it('hidden 时不发起新的自动请求，恢复可见后仍可补跑', async () => {
    const store = useChatStore()
    await seedRoom(store)
    vi.useFakeTimers()
    try {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      const baseline = web.bodies.length
      report(store, '80')
      await vi.advanceTimersByTimeAsync(20_000)
      expect(web.bodies.length).toBe(baseline)
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      report(store, '81')
      await vi.advanceTimersByTimeAsync(20_000)
      expect(web.bodies.length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('#483 合并与分面状态', () => {
  it('撤回单向收敛：服务端已撤回的行即使本轮被触及也照样改回撤回', async () => {
    const store = useChatStore()
    await seedRoom(store)
    web.handler = (body: any) => {
      const env = envelopeFor(body)
      ;(env as any).items = [{ message: { id: '200', sendTime: BASE_TIME + 200 * 1000, messageType: 2 } }]
      return env
    }
    store.reportReadingWindow(ROOM, {
      ids: ['199', '200'],
      anchorId: '199',
      anchorSendTime: BASE_TIME + 199 * 1000,
      atBottom: true
    })
    const outcome = await store.calibrateWindow(ROOM, { force: true, requestId: 'req-recall' })
    expect(outcome.status).toBe('ok')
    expect((store.messageMap[ROOM] as any)['200'].message.messageType).toBe(2)
    // 未被撤回的行保持可读内容
    expect((store.messageMap[ROOM] as any)['199'].message.messageType).toBe(1)
  })

  it('消息覆盖完整但仍有未终态思考 → partial，不报已校准', async () => {
    const store = useChatStore()
    await seedRoom(store)
    const thinking = {
      thinkingId: '9001',
      roomId: ROOM,
      triggerMsgId: '150',
      aiclawId: '20',
      aiclawName: 'AI',
      aiclawAvatar: '',
      status: 'thinking',
      startTime: 1,
      collapsed: false
    } as ThinkingState
    store.thinkingByTrigger.set(ROOM, new Map([['150', [thinking]]]))
    web.handler = (body: any) => {
      const env = envelopeFor(body)
      ;(env as any).thinkingItems = [{ id: '9001', aiclawUid: '20', triggerMsgId: '150', status: 0, createTime: 1 }]
      return env
    }
    store.reportReadingWindow(ROOM, {
      ids: ['150'],
      anchorId: '150',
      anchorSendTime: BASE_TIME + 150 * 1000,
      atBottom: false
    })
    const outcome = await store.calibrateWindow(ROOM, { force: true, requestId: 'req-thinking' })
    expect(outcome.facets?.messages).toBe(true)
    expect(outcome.facets?.thinkingTerminal).toBe(false)
    expect(outcome.status).toBe('partial')
  })

  it('明确无权只影响思考分面，消息仍按完整语义处理', async () => {
    const store = useChatStore()
    await seedRoom(store)
    web.handler = (body: any) => {
      const env = envelopeFor(body)
      ;(env as any).thinkingAccess = false
      return env
    }
    report(store, '5')
    const outcome = await store.calibrateWindow(ROOM, { force: true, requestId: 'req-deny' })
    expect(outcome.facets?.messages).toBe(true)
    expect(outcome.facets?.thinkingMeta).toBe(true)
    expect(outcome.status).toBe('ok')
  })

  it('回执不对齐时整包判 unsupported：不删消息、不报 ok', async () => {
    const store = useChatStore()
    await seedRoom(store)
    web.handler = (body: any) => {
      const env = envelopeFor(body)
      ;(env as any).knownReceipts = []
      ;(env as any).items = []
      return env
    }
    report(store, '5')
    const outcome = await store.calibrateWindow(ROOM, { force: true, requestId: 'req-bad' })
    expect(outcome.ok).toBe(false)
    expect(outcome.status).toBe('unsupported')
    expect(Object.keys(store.messageMap[ROOM] ?? {})).toHaveLength(200)
  })

  it('迟到应答（requestId 回显不一致）整包丢弃', async () => {
    const store = useChatStore()
    await seedRoom(store)
    web.handler = (body: any) => envelopeFor({ ...body, requestId: 'req-stale' })
    report(store, '7')
    const outcome = await store.calibrateWindow(ROOM, { force: true, requestId: 'req-fresh' })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('已过期')
    expect((store.messageMap[ROOM] as any)['200'].message.content).toBe('c200')
  })
})
