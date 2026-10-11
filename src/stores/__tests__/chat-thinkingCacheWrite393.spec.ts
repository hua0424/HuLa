import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'mobile-home' }) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getByLabel: vi.fn(async () => null), getCurrent: () => ({ label: 'mobile-home' }) }
}))
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('@tauri-apps/plugin-notification', () => ({ sendNotification: vi.fn() }))
vi.mock('@/utils/PlatformConstants', () => ({
  isWeb: () => false,
  isMobile: () => true,
  isWindows: () => false,
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
import { captureSessionBinding, initializeSessionBinding, type SessionIdentity } from '@/services/sessionBinding'
import { loadThinkingBody } from '@/services/localCache'
import type { ThinkingState } from '@/types/thinking'

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
const metadata = (status = 1, id = '100', actor = '20') => ({
  id,
  aiclawUid: actor,
  triggerMsgId: '10',
  status,
  durationMs: 5,
  hasResponse: 1,
  createTime: '2026-10-02T01:00:00'
})
const diskNoBody = () => ({
  items: [
    {
      metadata: metadata(1),
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
const detail = (content: string | null = '远端正文fixture') => ({
  thinkingId: '100',
  roomId: '3',
  triggerMsgId: '10',
  aiclawUid: '20',
  status: 1,
  content
})
let handle: (command: string, args: any) => any
let epoch = 500

beforeEach(async () => {
  setActivePinia(createPinia())
  Object.assign(window, { __TAURI_INTERNALS__: {} })
  identity = { backendKey: 'http://a/api', uid: '4', sessionEpoch: ++epoch }
  handle = (command) => {
    if (command === 'read_thinking_cache') return diskNoBody()
    if (command === 'im_request_command') return detail()
    if (command === 'cache_thinking_metadata') return ['10']
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

const calls = (command: string) => native.invoke.mock.calls.filter(([name]) => name === command)

describe('#393 移动主窗缓存归属与写容错', () => {
  it('mobile-home 是合法主写者：元数据分支正常获取并持久化，不被守卫拒绝', async () => {
    handle = (command) => {
      if (command === 'page_msg') return { list: [message()], cursor: '', isLast: true, total: 1 }
      if (command === 'read_thinking_cache') return { items: [], loadedTriggerIds: [], visibleTriggerIds: ['10'] }
      if (command === 'im_request_command') return [metadata(1)]
      if (command === 'cache_thinking_metadata') return ['10']
    }
    const store = useChatStore()
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
    await store.setAllSessionMsgList(20)
    await vi.waitFor(() => expect(store.thinkingMetadataLoaded.get('3')?.has('10')).toBe(true))
    expect(calls('im_request_command').some(([, args]) => args.url === ImUrlEnum.AICLAW_THINKING_BY_TRIGGER)).toBe(true)
    expect(calls('cache_thinking_metadata')).toHaveLength(1)
    expect(store.thinkingCacheErrors['3']).toBeUndefined()
  })

  it('正文写守卫拒绝不掩盖已验证远端正文：返回内容且下次进入可重试持久化', async () => {
    let guardOn = true
    handle = (command) => {
      if (command === 'read_thinking_cache') return diskNoBody()
      if (command === 'im_request_command') return detail()
      if (command === 'cache_thinking_metadata') return ['10']
      if (command === 'cache_thinking_body') {
        if (guardOn) throw new Error('只有聊天主窗可持久化账号缓存')
        return undefined
      }
      return undefined
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const binding = await captureSessionBinding()
      const first = await loadThinkingBody(state(), binding)
      expect(first.content).toBe('远端正文fixture')
      expect(first.status).toBe(1)
      expect(calls('cache_thinking_body')).toHaveLength(1)
      expect(warn).toHaveBeenCalled()
      guardOn = false
      const second = await loadThinkingBody(state(), binding)
      expect(second.content).toBe('远端正文fixture')
      expect(calls('cache_thinking_body')).toHaveLength(2)
    } finally {
      warn.mockRestore()
    }
  })

  it('元数据保存失败不阻断已验证正文：归属/状态校验仍执行并返回内容', async () => {
    handle = (command) => {
      if (command === 'read_thinking_cache') return diskNoBody()
      if (command === 'im_request_command') return detail()
      if (command === 'cache_thinking_metadata') throw new Error('fixture metadata disk failure')
      return undefined
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const binding = await captureSessionBinding()
      const result = await loadThinkingBody(state(), binding)
      expect(result.content).toBe('远端正文fixture')
      expect(result.status).toBe(1)
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('归属不匹配的迟到正文仍被拒绝：写容错不绕过归属/结束状态校验', async () => {
    handle = (command) => {
      if (command === 'read_thinking_cache') return diskNoBody()
      if (command === 'im_request_command')
        return { thinkingId: '100', roomId: '3', triggerMsgId: '10', aiclawUid: '999', status: 1, content: '串号' }
      return undefined
    }
    const binding = await captureSessionBinding()
    await expect(loadThinkingBody(state(), binding)).rejects.toThrow('思考正文归属或结束状态未确认')
    expect(calls('cache_thinking_body')).toHaveLength(0)
  })
})
