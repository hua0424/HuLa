import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#374：明确拒绝后旧 WS 事件重建思考卡。
 *
 * P08 时序（真实 Windows Tauri 接缝复现）：明确 thinkingAccess=false 完成并清零后，
 * 保持拒绝态重放旧协议 START（无 clientRunId）→ 卡片复活为 thinking；
 * 再重放旧 END → 卡片变为 complete。SQLite 始终为 0（仅 DOM/内存复活）。
 *
 * 本文件用真实 chat store + 受控传输层 mock，在 window 拒绝态下重放 P08 旧帧：
 * 修复前复现（卡片复活），修复后通过（不复活、不查无权 detail、不串作用域，
 * 当前上下文有效重新授权后可恢复）。
 */

const native = vi.hoisted(() => ({ invoke: vi.fn(), listeners: new Map<string, (event: any) => void>() }))
const loadThinkingDetailMock = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<any>>(async () => null))
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
vi.mock('@/services/thinkingService', () => ({
  loadThinkingByTrigger: vi.fn(async () => []),
  loadThinkingDetail: (...args: any[]) => loadThinkingDetailMock(...args)
}))
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

import { useChatStore } from '@/stores/chat'
import { initializeSessionBinding, type SessionIdentity } from '@/services/sessionBinding'

const ROOM_A = '175988626166784'
const ROOM_B = '175988626166785'
const AICLAW = '140789091499520'
const THINK = '2104835564313923584'
const TRIGGER = '211143248201216'

// P08 复现输入：旧协议形状，无 clientRunId、无正文。
const oldStart = {
  thinkingId: THINK,
  fromUid: AICLAW,
  roomId: ROOM_A,
  triggerMsgId: TRIGGER,
  aiclawName: 'verify364-old-frame'
}
const oldEnd = { ...oldStart, status: 'complete', durationMs: 6355 } as const

let identity: SessionIdentity
let epoch = 900
let thinkingAccess: boolean | undefined = false

const emptyDisk = () => ({ items: [], loadedTriggerIds: [], visibleTriggerIds: [] })

beforeEach(async () => {
  setActivePinia(createPinia())
  Object.assign(window, { __TAURI_INTERNALS__: {} })
  identity = { backendKey: 'http://a/api', uid: '4', sessionEpoch: ++epoch }
  thinkingAccess = false
  loadThinkingDetailMock.mockReset().mockResolvedValue(null)
  native.invoke.mockReset().mockImplementation(async (command: string, args: any) => {
    if (command === 'get_session_binding') return { sessionEpoch: identity.sessionEpoch, binding: { ...identity } }
    if (args?.binding && JSON.stringify(args.binding) !== JSON.stringify(identity))
      throw new Error('native origin expired')
    if (command === 'calibrate_window')
      return {
        items: [],
        unavailableIds: [],
        complete: true,
        thinkingAccess,
        thinkingTriggers: thinkingAccess ? [] : [],
        thinkingComplete: false,
        thinkingKnownComplete: false,
        thinkingMerged: 0
      }
    if (command === 'read_thinking_cache') return emptyDisk()
    return undefined
  })
  await initializeSessionBinding()
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 20))
const cardsOf = (store: ReturnType<typeof useChatStore>, roomId: string) =>
  [...(store.thinkingByTrigger.get(roomId)?.values() ?? [])].flat()
const deny = (store: ReturnType<typeof useChatStore>, roomId: string) => {
  thinkingAccess = false
  return store.calibrateWindow(roomId, { force: true })
}
const allow = (store: ReturnType<typeof useChatStore>, roomId: string) => {
  thinkingAccess = true
  return store.calibrateWindow(roomId, { force: true })
}

describe('明确拒绝后旧 WS 事件不重建思考卡 (#374 P08)', () => {
  it('拒绝态重放旧 START 不建卡（修复前复现：card=1/status=thinking）', async () => {
    const store = useChatStore()
    const outcome = await deny(store, ROOM_A)
    expect(outcome.ok).toBe(true)
    expect(cardsOf(store, ROOM_A)).toHaveLength(0)

    store.startThinking({ ...oldStart })

    expect(store.thinkingStreams.has(`${ROOM_A}:${AICLAW}`)).toBe(false)
    expect(cardsOf(store, ROOM_A)).toHaveLength(0)
    await flush()
    expect(loadThinkingDetailMock).not.toHaveBeenCalled()
  })

  it('拒绝态重放旧 END 不建卡、不排 pending、不读无权 detail', async () => {
    const store = useChatStore()
    await deny(store, ROOM_A)

    store.finalizeThinking(THINK, { ...oldEnd })

    expect(cardsOf(store, ROOM_A)).toHaveLength(0)
    await flush()
    expect(loadThinkingDetailMock).not.toHaveBeenCalled()
    // 重复 END 同样幂等无事。
    store.finalizeThinking(THINK, { ...oldEnd })
    expect(cardsOf(store, ROOM_A)).toHaveLength(0)
  })

  it('START→拒绝清零→重放同 ID START/END 不复活', async () => {
    const store = useChatStore()
    store.startThinking({ ...oldStart })
    expect(cardsOf(store, ROOM_A)).toHaveLength(1)

    await deny(store, ROOM_A)
    expect(cardsOf(store, ROOM_A)).toHaveLength(0)

    store.startThinking({ ...oldStart })
    store.finalizeThinking(THINK, { ...oldEnd })
    expect(cardsOf(store, ROOM_A)).toHaveLength(0)
    await flush()
    expect(loadThinkingDetailMock).not.toHaveBeenCalled()
  })

  it('拒绝只隔离本房：他房正常建卡，旧上下文事件不污染', async () => {
    const store = useChatStore()
    await deny(store, ROOM_A)

    store.startThinking({ ...oldStart, roomId: ROOM_B, thinkingId: '999', triggerMsgId: '888' })
    expect(cardsOf(store, ROOM_B)).toHaveLength(1)
    expect(cardsOf(store, ROOM_A)).toHaveLength(0)

    // 旧会话绑定的本房事件仍被来源 fence 丢弃，不会解除或触及拒绝态。
    store.startThinking({
      ...oldStart,
      _sessionBinding: { backendKey: 'http://a/api', uid: '4', sessionEpoch: identity.sessionEpoch - 1 }
    } as never)
    expect(cardsOf(store, ROOM_A)).toHaveLength(0)
  })

  it('当前上下文有效重新授权后合法事件恢复展示', async () => {
    const store = useChatStore()
    await deny(store, ROOM_A)
    store.startThinking({ ...oldStart })
    expect(cardsOf(store, ROOM_A)).toHaveLength(0)

    const outcome = await allow(store, ROOM_A)
    expect(outcome.ok).toBe(true)
    store.startThinking({ ...oldStart })
    expect(cardsOf(store, ROOM_A)).toHaveLength(1)
    store.finalizeThinking(THINK, { ...oldEnd })
    expect(cardsOf(store, ROOM_A)[0].status).toBe('complete')
  })

  it('换账号后旧拒绝不误禁新上下文', async () => {
    const store = useChatStore()
    await deny(store, ROOM_A)
    store.startThinking({ ...oldStart })
    expect(cardsOf(store, ROOM_A)).toHaveLength(0)

    identity = { backendKey: 'http://a/api', uid: '7', sessionEpoch: ++epoch }
    await initializeSessionBinding()
    const next = useChatStore()
    next.startThinking({ ...oldStart })
    expect(cardsOf(next, ROOM_A)).toHaveLength(1)
  })

  it('网络失败/缺字段不判失权：不断言拒绝，后续事件正常', async () => {
    const store = useChatStore()
    store.startThinking({ ...oldStart })
    expect(cardsOf(store, ROOM_A)).toHaveLength(1)

    thinkingAccess = undefined
    const outcome = await store.calibrateWindow(ROOM_A, { force: true })
    expect(outcome.ok).toBe(true)
    // 缺字段保持既有缓存（沿 #351 语义）。
    expect(cardsOf(store, ROOM_A)).toHaveLength(1)

    store.startThinking({ ...oldStart, thinkingId: '555', fromUid: '140789091499521' })
    expect(cardsOf(store, ROOM_A)).toHaveLength(2)
  })
})
