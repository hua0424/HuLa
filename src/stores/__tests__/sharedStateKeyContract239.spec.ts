import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, toRaw } from 'vue'

/**
 * aichatoverview#239（REQ-019）键类型契约测试——5 脆弱 store 逐键形态断言，变更即红。
 *
 * 契约（#237 终裁 + reviewer 可行性补审 comment 5235420756）：
 *   A 类 9 个普通对象键（跨窗活同步依赖键）：
 *     group.userListMap / group.userListOptions / chat.sessionOptions /
 *     feed.feedOptions / feed.feedStats / feed.feedUnreadStatus /
 *     global.unReadMark / global.currentReadUnreadList / file.roomFilesMap
 *     —— PR2 将 reactive→ref（收包整键替换写穿 ref.value，活同步落地）。
 *     PR1 基线断言其当前为 reactive（!isRef）；PR2 把断言翻转为 isRef。
 *   B 类 8 个 Map/Set 键（序列化恒 {}，永不 ref 化）：
 *     group.dissolvedRoomIds[Set] / group.friendInfoCache[Map] /
 *     chat.streamingMessages[Set] / chat.thinkingStreams[Map] /
 *     chat.thinkingByTrigger[Map] / chat.thinkingMetadataLoaded[Map] /
 *     chat.autoReplyMessages[Set] / chat.aiclawGroupConfigs[Map]
 *     —— 必须保持 reactive Map/Set 且逐键出现在 share.omit（跨窗只走 Tauri 事件）。
 *   5 store 全部：share.enable+initialize 开启、persist.storage 为主窗持久化判定。
 *
 * 形态取数面：toRaw(store.$state)[key] 拿容器原始绑定（绕开容器代理 get 解包），
 * isRef 判 ref 形态，instanceof Map/Set 判集合形态。
 */

// ---- chat store 模块级副作用桩（Worker / Tauri 插件，先例 silentBackground229Session.spec.ts）----
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

vi.mock('@/utils/TauriInvokeHandler', () => ({
  invokeWithErrorHandler: vi.fn().mockResolvedValue(undefined),
  invokeSilently: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getByLabel: vi.fn().mockResolvedValue(null), getCurrent: vi.fn() }
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'home' })
}))
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
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
  getSessionDetail: vi.fn(),
  markMsgRead: vi.fn(),
  imRequest: vi.fn(),
  imRequestSilent: vi.fn(),
  getAnnouncementList: vi.fn(),
  getBadgesBatch: vi.fn(),
  getUserDetail: vi.fn(),
  feedList: vi.fn(),
  feedDetail: vi.fn(),
  pushFeed: vi.fn(),
  delFeed: vi.fn(),
  editFeed: vi.fn(),
  feedLikeToggle: vi.fn(),
  feedLikeList: vi.fn(),
  feedLikeCount: vi.fn(),
  feedLikeHasLiked: vi.fn(),
  feedCommentAdd: vi.fn(),
  feedCommentDelete: vi.fn(),
  feedCommentAll: vi.fn(),
  feedCommentCount: vi.fn()
}))
vi.mock('@/utils/UnreadCountManager', () => ({
  unreadCountManager: {
    refreshBadge: vi.fn(),
    calculateTotal: vi.fn(),
    setUpdateCallback: vi.fn(),
    requestUpdate: vi.fn()
  }
}))
vi.mock('@/utils/PlatformConstants', () => ({ isWeb: () => false, isDesktop: () => true, isMobile: () => false }))

import { useChatStore } from '@/stores/chat'
import { useFeedStore } from '@/stores/feed'
import { useFileStore } from '@/stores/file'
import { useGlobalStore } from '@/stores/global'
import { useGroupStore } from '@/stores/group'
import { isRef } from 'vue'

/** 捕获各 store 的插件 options（share/persist 第三参） */
type CapturedOptions = { share?: { enable?: boolean; initialize?: boolean; omit?: string[] }; persist?: unknown }

function captureOptions(createStores: () => void): Record<string, CapturedOptions> {
  const captured: Record<string, CapturedOptions> = {}
  const pinia = createPinia()
  pinia.use(({ store, options }) => {
    captured[store.$id] = options as CapturedOptions
  })
  createApp({}).use(pinia)
  setActivePinia(pinia)
  createStores()
  return captured
}

/** 容器原始绑定：绕开 $state 代理 get 解包，isRef 才能区分 ref/reactive 形态 */
const rawBinding = (store: { $state: object }, key: string) => toRaw(store.$state)[key as keyof object]

describe('#239 键类型契约（5 脆弱 store 逐键形态，变更即红）', () => {
  let stores: {
    chat: ReturnType<typeof useChatStore>
    group: ReturnType<typeof useGroupStore>
    feed: ReturnType<typeof useFeedStore>
    global: ReturnType<typeof useGlobalStore>
    file: ReturnType<typeof useFileStore>
  }
  let options: Record<string, CapturedOptions>

  beforeEach(() => {
    options = captureOptions(() => {
      stores = {
        chat: useChatStore(),
        group: useGroupStore(),
        feed: useFeedStore(),
        global: useGlobalStore(),
        file: useFileStore()
      }
    })
  })

  /** 契约只覆盖 5 个脆弱 store（建店过程会传递实例化 user/sessionUnread 等，不在断言面） */
  const FRAGILE_IDS = ['chat', 'group', 'feed', 'global', 'file']

  it('5 store 全部开启 share.enable + initialize', () => {
    for (const id of FRAGILE_IDS) {
      expect(options[id]?.share?.enable, `${id} share.enable`).toBe(true)
      expect(options[id]?.share?.initialize, `${id} share.initialize`).toBe(true)
    }
  })

  it('5 store 全部配置主窗持久化 storage（#237 终裁第 4 条）', () => {
    for (const id of FRAGILE_IDS) {
      const persist = options[id]?.persist as { storage?: unknown } | undefined
      expect(persist?.storage, `${id} persist.storage`).toBeDefined()
    }
  })

  it('B 类键逐键出现在 share.omit（chat 6 状态键 + group 2 前向防御；feed/global/file 无 omit）', () => {
    expect(options.chat?.share?.omit?.sort()).toEqual(
      [
        'streamingMessages',
        'thinkingStreams',
        'thinkingByTrigger',
        'thinkingMetadataLoaded',
        'autoReplyMessages',
        'aiclawGroupConfigs'
      ].sort()
    )
    // group 两键当前是 setup 闭包内部状态（未 return），omit 为前向防御（防未来暴露即广播 {}）
    expect(options.group?.share?.omit?.sort()).toEqual(['dissolvedRoomIds', 'friendInfoCache'].sort())
    expect(options.feed?.share?.omit ?? []).toEqual([])
    expect(options.global?.share?.omit ?? []).toEqual([])
    expect(options.file?.share?.omit ?? []).toEqual([])
  })

  it('B 类 Map/Set 状态键保持 reactive 集合形态（永不 ref 化）', () => {
    // chat 6 键是 $state 状态键，可经容器原始绑定断言
    expect(rawBinding(stores.chat, 'streamingMessages')).toBeInstanceOf(Set)
    expect(rawBinding(stores.chat, 'thinkingStreams')).toBeInstanceOf(Map)
    expect(rawBinding(stores.chat, 'thinkingByTrigger')).toBeInstanceOf(Map)
    expect(rawBinding(stores.chat, 'thinkingMetadataLoaded')).toBeInstanceOf(Map)
    expect(rawBinding(stores.chat, 'autoReplyMessages')).toBeInstanceOf(Set)
    expect(rawBinding(stores.chat, 'aiclawGroupConfigs')).toBeInstanceOf(Map)
    // group 的 dissolvedRoomIds/friendInfoCache 未 return（闭包内部），不在 $state 断言面——
    // 其形态约束由上一条 omit 断言前向锁定
  })

  it('A 类 9 键形态基线（PR1：reactive；PR2 翻转为 ref 断言）', () => {
    // PR2 改造后本组断言应翻转为 isRef(...) === true——届时同步翻转即完成契约锁定
    expect(isRef(rawBinding(stores.group, 'userListMap'))).toBe(false)
    expect(isRef(rawBinding(stores.group, 'userListOptions'))).toBe(false)
    expect(isRef(rawBinding(stores.chat, 'sessionOptions'))).toBe(false)
    expect(isRef(rawBinding(stores.feed, 'feedOptions'))).toBe(false)
    expect(isRef(rawBinding(stores.feed, 'feedStats'))).toBe(false)
    expect(isRef(rawBinding(stores.feed, 'feedUnreadStatus'))).toBe(false)
    expect(isRef(rawBinding(stores.global, 'unReadMark'))).toBe(false)
    expect(isRef(rawBinding(stores.global, 'currentReadUnreadList'))).toBe(false)
    expect(isRef(rawBinding(stores.file, 'roomFilesMap'))).toBe(false)
  })
})
