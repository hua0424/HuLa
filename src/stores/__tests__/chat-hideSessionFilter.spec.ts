import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#260：删除会话（hide=1）重新登录后复活——会话列表全链路过滤 hide 标志。
 *
 * 根因：「删除会话」= hide_contact_command 把服务端/本地 im_contact.hide 置 1，
 * 但读链路（getSessionList 落 store、addSession WS 推送补拉）从未消费 hide 字段，
 * 重登录/CONTACTS_SYNCED 全量重拉后已删会话原样回归。
 *
 * 过滤口径：仅 hide === true 剔除（false / undefined / 字段缺失一律保留），
 * 与 issue 建议的 `s.hide !== true` 一致，避免老数据缺字段被误杀。
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

// 平台开关：cycle 2 切 web 分支用
const platformState = vi.hoisted(() => ({ isWeb: false }))

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
vi.mock('@/utils/PlatformConstants', () => ({
  isWeb: () => platformState.isWeb,
  isMobile: () => false,
  isWindows: () => true,
  isMac: () => false
}))

import { useChatStore } from '@/stores/chat'
import { RoomTypeEnum } from '@/enums'
import type { SessionItem } from '@/services/types'
import { invokeWithErrorHandler } from '@/utils/TauriInvokeHandler'
import { imRequest, getSessionDetail } from '@/utils/ImRequestUtils'

const makeSession = (roomId: string, overrides: Partial<SessionItem> = {}): SessionItem =>
  ({
    roomId,
    name: `session-${roomId}`,
    type: RoomTypeEnum.GROUP,
    activeTime: 1000,
    unreadCount: 0,
    ...overrides
  }) as SessionItem

describe('useChatStore 会话列表 hide 过滤（#260）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    platformState.isWeb = false
  })

  it('getSessionList（Tauri 分支）落 store 时过滤 hide=true，其余会话字段原样保留', async () => {
    const chatStore = useChatStore()

    const visible = makeSession('room-visible', { hide: false, top: true, activeTime: 3000 })
    const legacy = makeSession('room-legacy', { activeTime: 2000 }) // hide 字段缺失（老数据）
    const hidden = makeSession('room-hidden', { hide: true, activeTime: 4000 })

    // 服务端全量下发（含 hide=1），模拟重登录/CONTACTS_SYNCED 重拉
    vi.mocked(invokeWithErrorHandler).mockResolvedValueOnce([visible, hidden, legacy])
    await chatStore.getSessionList(true)

    expect(chatStore.sessionList.map((s) => s.roomId)).toEqual(['room-visible', 'room-legacy'])
    // 隐藏会话不进 sessionMap，避免兜底查找把它回填回列表
    expect(chatStore.sessionMap['room-hidden']).toBeUndefined()
    // 未删除会话的置顶等标志不受影响
    const kept = chatStore.sessionList.find((s) => s.roomId === 'room-visible')
    expect(kept?.top).toBe(true)
  })

  it('getSessionList（web 分支）落 store 时同样过滤 hide=true', async () => {
    platformState.isWeb = true
    const chatStore = useChatStore()

    const visible = makeSession('room-visible', { hide: false, activeTime: 2000 })
    const hidden = makeSession('room-hidden', { hide: true, activeTime: 3000 })

    vi.mocked(imRequest).mockResolvedValueOnce({ list: [visible, hidden], cursor: '', isLast: true })
    await chatStore.getSessionList(true)

    expect(chatStore.sessionList.map((s) => s.roomId)).toEqual(['room-visible'])
    expect(chatStore.sessionMap['room-hidden']).toBeUndefined()
  })

  it('addSession 拉到 hide=true 的会话详情时静默跳过（隐藏会话来新消息不复活，YAGNI 不做 un-hide）', async () => {
    const chatStore = useChatStore()

    vi.mocked(getSessionDetail).mockResolvedValueOnce(makeSession('room-hidden', { hide: true }))
    await chatStore.addSession('room-hidden')

    expect(chatStore.sessionList.find((s) => s.roomId === 'room-hidden')).toBeUndefined()
    expect(chatStore.sessionMap['room-hidden']).toBeUndefined()
  })

  it('addSession 对未隐藏会话正常入列', async () => {
    const chatStore = useChatStore()

    vi.mocked(getSessionDetail).mockResolvedValueOnce(makeSession('room-new', { hide: false }))
    await chatStore.addSession('room-new')

    expect(chatStore.sessionList.map((s) => s.roomId)).toEqual(['room-new'])
    expect(chatStore.sessionMap['room-new']).toBeDefined()
  })

  it('getSessionList 对 raw 带 hide=true 的已存在会话做剔除（持久化水合/详情响应滞后双场景兜底）', async () => {
    const chatStore = useChatStore()

    // 场景 A：pinia 持久化水合的旧快照里 hide 标志缺失（老版本客户端写入的缓存）
    const hydrated = makeSession('room-hydrated', { activeTime: 9000 })
    chatStore.sessionList = [hydrated]
    chatStore.sessionMap = { 'room-hydrated': hydrated }

    // 场景 B：某会话在内存里 hide=false（详情响应早于 setHide 到达），raw 列表已置 true
    const stale = makeSession('room-stale', { hide: false, activeTime: 8000 })
    chatStore.sessionList.push(stale)
    chatStore.sessionMap['room-stale'] = stale

    const rawHydrated = makeSession('room-hydrated', { hide: true, activeTime: 9000 })
    const rawStale = makeSession('room-stale', { hide: true, activeTime: 8000 })
    const rawVisible = makeSession('room-visible', { hide: false, activeTime: 7000 })
    vi.mocked(invokeWithErrorHandler).mockResolvedValueOnce([rawHydrated, rawStale, rawVisible])

    await chatStore.getSessionList(true)

    expect(chatStore.sessionList.map((s) => s.roomId)).toEqual(['room-visible'])
    expect(chatStore.sessionMap['room-hydrated']).toBeUndefined()
    expect(chatStore.sessionMap['room-stale']).toBeUndefined()
  })
})
