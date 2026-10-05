import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#351：桌面(Tauri)校准路径的思考授权门禁。
 *
 * 明确 thinkingAccess=false 时隐藏本房思考卡且不读回本地缓存
 * （Rust 已清本房缓存行，重进房不复活）；缺字段/失败保持既有缓存。
 * 用真实 chat store，只 mock 原生传输层。
 */

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

import { useChatStore } from '@/stores/chat'
import { initializeSessionBinding, type SessionIdentity } from '@/services/sessionBinding'
import type { ThinkingState } from '@/types/thinking'

let identity: SessionIdentity
let epoch = 500
let thinkingAccess: boolean | undefined = false

const disk = () => ({
  items: [
    {
      metadata: {
        id: '100',
        aiclawUid: '20',
        triggerMsgId: '10',
        status: 1,
        durationMs: 5,
        hasResponse: 1,
        createTime: '2026-10-04T12:00:00'
      },
      roomId: '3',
      content: '',
      bodyLoaded: false,
      bodyETag: null,
      bodyVerifiedAt: null
    }
  ],
  loadedTriggerIds: ['10'],
  visibleTriggerIds: ['10']
})

const seedCard = (store: ReturnType<typeof useChatStore>) => {
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
  store.messageMap['3'] = { '10': { message: { id: '10', sendTime: 1 } } as never }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  Object.assign(window, { __TAURI_INTERNALS__: {} })
  identity = { backendKey: 'http://a/api', uid: '4', sessionEpoch: ++epoch }
  thinkingAccess = false
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
        thinkingTriggers: thinkingAccess ? ['10'] : [],
        thinkingComplete: false,
        thinkingKnownComplete: false,
        thinkingMerged: 0
      }
    if (command === 'read_thinking_cache') return disk()
    return undefined
  })
  await initializeSessionBinding()
})

const calls = (command: string) => native.invoke.mock.calls.filter(([name]) => name === command)

describe('calibrateWindow 桌面思考授权门禁 (#351)', () => {
  it('明确无权隐藏本房卡片且不读回（重进房不复活）', async () => {
    thinkingAccess = false
    const store = useChatStore()
    seedCard(store)
    const outcome = await store.calibrateWindow('3', { force: true })
    expect(outcome.ok).toBe(true)
    expect(store.thinkingByTrigger.get('3')).toBeUndefined()
    expect(calls('read_thinking_cache')).toHaveLength(0)
  })

  it('有权时读回并卡（既有缓存语义不变）', async () => {
    thinkingAccess = true
    const store = useChatStore()
    seedCard(store)
    const outcome = await store.calibrateWindow('3', { force: true })
    expect(outcome.ok).toBe(true)
    expect(calls('read_thinking_cache')).toHaveLength(1)
    expect(store.thinkingByTrigger.get('3')?.get('10')).toHaveLength(1)
  })
})
