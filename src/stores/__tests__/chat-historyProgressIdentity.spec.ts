import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#285 二轮返工：首屏回填完成后 progress.isLoading 卡死 true，
 * 后续 loadMore 被 `if (progress.isLoading) return` 静默吞掉，深历史无法翻页。
 *
 * 双根因（同一 symptom 家族）：
 * 1. ensureProgress 每次调用都按引用替换 messageOptions[roomId]。加载 UI
 *    （historyState/currentMessageOptions）在 IPC 等待期间求值就会孤立在途
 *    loadPageMsg 持有的引用：完成时把 isLoading=false、远端游标写到孤儿对象，
 *    留下 unknown+isLoading:true 的卡死进度（与回填成功日志矛盾）。
 * 2. 同房多流程并发（切房 watcher + 手动刷新）时去重共享同一分页任务，
 *    共享任务绑定旧浏览代次被丢弃后，没有任何链再释放手动置/进入时置的
 *    isLoading——loading 变成无主 permanently。
 * 修复：进度对象身份稳定（就地补齐/就地重置）+ isLoading 只允许被在途请求
 * 持有（releaseRoomLoadingIfIdle：无人在途即释放）。
 *
 * 本文件用真实 chat store 复现：回填在途时反复读取 historyState，
 * 断言完成后 loading 释放、远端状态落盘、loadMore 能带游标推进；
 * 并发场景断言永远不卡死（loadMore 门禁最终能打开）。
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

const loadThinkingByTriggerMock = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<any[]>>(async () => []))
const imRequestMock = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<any>>())
vi.mock('@/services/thinkingService', () => ({
  loadThinkingByTrigger: (...args: any[]) => loadThinkingByTriggerMock(...args)
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
  imRequest: (...args: any[]) => imRequestMock(...args),
  imRequestSilent: vi.fn().mockResolvedValue([])
}))
vi.mock('@/utils/RenderReplyContent.ts', () => ({
  renderReplyContent: vi.fn().mockImplementation((_name: unknown, _type: unknown, content: unknown) => content)
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

const msg = (id: string, sendTime: number) => ({
  message: { id, sendTime, sendId: 'u1', content: `c-${id}`, type: 1 }
})
const page = (ids: string[], cursor: string, isLast: boolean, base = 1000) => ({
  list: ids.map((id, i) => msg(id, base + i)),
  cursor,
  isLast,
  total: ids.length
})
const p1 = (n: number) => Array.from({ length: n }, (_, i) => `p1-${i}`)
const p2 = (n: number) => Array.from({ length: n }, (_, i) => `p2-${i}`)

/** 手动可控的 imRequest：每次调用排队一个待 resolve 的请求 */
function armImRequest() {
  const resolvers: Array<(v: any) => void> = []
  const cursors: Array<string | undefined> = []
  imRequestMock.mockImplementation(async (opts: any) => {
    cursors.push(opts?.params?.cursor)
    return new Promise((resolve) => {
      resolvers.push(resolve)
    })
  })
  return { resolvers, cursors }
}

/** 加载 UI 在请求在途时求值（旧实现在此孤立进度对象） */
function pokeLoadingUi(store: ReturnType<typeof useChatStore>) {
  void store.historyState.isLoading
  void store.currentMessageOptions.isLoading
  void store.historyState.canContinue
}

describe('aichatoverview#285 进度对象身份稳定（回填后可翻页）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    loadThinkingByTriggerMock.mockReset().mockResolvedValue([])
    imRequestMock.mockReset()
  })

  it('单流程进房：回填在途 UI 反复求值后 loading 释放且 loadMore 带游标推进', async () => {
    const { resolvers, cursors } = armImRequest()
    const globalStore = useGlobalStore()
    const store = useChatStore()

    // 生产进房路径：切房 watcher → changeRoom → 首屏本地页 + 空首屏远端回填
    globalStore.currentSessionRoomId = 'room-285-single'
    await vi.waitFor(() => expect(imRequestMock).toHaveBeenCalledTimes(1))
    pokeLoadingUi(store)
    resolvers.shift()!({ list: [], cursor: '', isLast: true, total: 0 })

    await vi.waitFor(() => expect(imRequestMock).toHaveBeenCalledTimes(2))
    pokeLoadingUi(store)
    resolvers.shift()!(page(p1(20), 'cursor-p1', false))
    await vi.waitFor(() => expect(store.currentMessageOptions.remoteStatus).toBe('more'))

    // 首屏回填完成：loading 必须释放，远端状态必须落到当前进度对象
    expect(store.currentMessageOptions.isLoading).toBe(false)
    expect(store.currentMessageOptions.error).toBe('')
    expect(Object.keys(store.currentMessageMap ?? {}).length).toBe(20)

    // 触顶翻页：必须发出第二页请求且游标推进，落盘后行数递增
    // （loadMore 等待请求完成：先起调再 resolve，避免测试侧死锁）
    const moreP = store.loadMore()
    await vi.waitFor(() => expect(imRequestMock).toHaveBeenCalledTimes(3))
    pokeLoadingUi(store)
    expect(cursors[2]).toBe('cursor-p1')
    resolvers.shift()!(page(p2(20), 'cursor-p2', false, 500))
    await moreP
    await vi.waitFor(() => expect(Object.keys(store.currentMessageMap ?? {}).length).toBe(40))

    expect(store.currentMessageOptions.isLoading).toBe(false)
    expect(store.currentMessageOptions.remoteStatus).toBe('more')
  })

  it('并发进房（切房+手动刷新共享去重任务）：永不卡死，loadMore 门禁能打开', async () => {
    const { resolvers } = armImRequest()
    const globalStore = useGlobalStore()
    const store = useChatStore()

    globalStore.currentSessionRoomId = 'room-285-race'
    await vi.waitFor(() => expect(imRequestMock).toHaveBeenCalled())
    // 手动刷新与切房链并发同房：去重共享同一本地任务
    const refresh = store.resetAndRefreshCurrentRoomMessages()
    pokeLoadingUi(store)
    // 共享任务一次 resolve 完成两条链（旧代次被丢弃，新链不再重拉）
    resolvers.shift()!({ list: [], cursor: '', isLast: true, total: 0 })
    await refresh
    pokeLoadingUi(store)

    // 无论哪条链赢下代次，结束时 loading 不得被无主持有
    await vi.waitFor(() => expect(store.currentMessageOptions.isLoading).toBe(false))

    // 门禁打开：loadMore 必须能发出请求（而不是静默吞掉）
    const callsBefore = imRequestMock.mock.calls.length
    void store.loadMore()
    await vi.waitFor(() => expect(imRequestMock.mock.calls.length).toBeGreaterThan(callsBefore))
    // 收尾：让最后的在途请求落定，避免悬挂影响后测
    while (resolvers.length) resolvers.shift()!(page(p1(5), 'cursor-r', true))
  })
})
