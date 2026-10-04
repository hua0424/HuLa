import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#351 N2：Web 直调窗口路径的应答新鲜度 fence。
 *
 * 应答 requestId 回显与本轮发送不一致（迟到/乱序旧包）即整包丢弃，
 * 不写消息、不碰思考缓存；缺回显按旧服务端形状走 unsupported（兼容）。
 * 用真实 chat store，只 mock 传输层。
 */

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
const web = vi.hoisted(() => ({ envelope: null as unknown }))
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
  isWeb: () => true,
  isMobile: () => false,
  isWindows: () => false,
  isMac: () => false
}))
vi.mock('@/utils/ImRequestUtils', () => ({ imRequest: async () => web.envelope }))
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
import type { ThinkingState } from '@/types/thinking'

let identity: SessionIdentity
let epoch = 700

const seedRoom = (store: ReturnType<typeof useChatStore>) => {
  store.messageMap['3'] = { '10': { message: { id: '10', sendTime: 1 } } as never }
  const state = {
    thinkingId: '100',
    roomId: '3',
    triggerMsgId: '10',
    aiclawId: '20',
    aiclawName: 'AI',
    aiclawAvatar: '',
    status: 'complete',
    startTime: 1,
    collapsed: true
  } as ThinkingState
  store.thinkingByTrigger.set('3', new Map([['10', [state]]]))
}

beforeEach(async () => {
  setActivePinia(createPinia())
  Object.assign(window, { __TAURI_INTERNALS__: {} })
  identity = { backendKey: 'http://a/api', uid: '4', sessionEpoch: ++epoch }
  native.invoke.mockReset().mockImplementation(async (command: string, args: any) => {
    if (command === 'get_session_binding') return { sessionEpoch: identity.sessionEpoch, binding: { ...identity } }
    if (args?.binding && JSON.stringify(args.binding) !== JSON.stringify(identity))
      throw new Error('native origin expired')
    return undefined
  })
  web.envelope = null
  await initializeSessionBinding()
})

describe('calibrateWindow Web 应答新鲜度 fence (#351 N2)', () => {
  it('旧授权重放新轮询整包丢弃（消息/思考均不动）', async () => {
    web.envelope = {
      requestId: 'wcal-old',
      schemaVersion: 'msg-window-v1',
      capabilities: ['messages', 'known-receipts'],
      items: [{ message: { id: '99', roomId: '3', sendTime: 2 } }],
      complete: true,
      knownReceipts: [],
      knownComplete: true,
      thinkingAccess: true,
      thinkingTriggers: ['99'],
      thinkingItems: [],
      thinkingComplete: true,
      thinkingKnownReceipts: [],
      thinkingKnownComplete: true
    }
    const store = useChatStore()
    seedRoom(store)
    const outcome = await store.calibrateWindow('3', { force: true, requestId: 'wcal-new' })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('已过期')
    // 本地消息与思考卡均未被旧包触及。
    expect(Object.keys(store.messageMap['3'] ?? {})).toEqual(['10'])
    expect(store.thinkingByTrigger.get('3')?.get('10')).toHaveLength(1)
  })

  it('缺回显旧形状仍走 unsupported（兼容不变）', async () => {
    web.envelope = { items: [] }
    const store = useChatStore()
    seedRoom(store)
    const outcome = await store.calibrateWindow('3', { force: true, requestId: 'wcal-new' })
    expect(outcome.ok).toBe(false)
    expect(outcome.status).toBe('unsupported')
    expect(Object.keys(store.messageMap['3'] ?? {})).toEqual(['10'])
  })
})
