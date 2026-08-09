import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#209：后台自动调用（已读上报 / 已读计数轮询 / 未读数刷新）断网时
 * 不弹 network_error toast——与用户操作无关、无领域语义，静默+记日志即可。
 *
 * 这三个 wrapper 的全部调用点都是后台路径：
 * - markMsgRead：chat store 已读上报队列（3 处 .catch(console.error)）、移动端滑动
 *   标记已读（自带领域文案 mark_as_read_failed）
 * - getMsgReadCount：ReadCountQueue 10s 轮询（catch + console.error）
 * - getNoticeUnreadCount：contacts.getApplyUnReadCount，WS 推送/窗口初始化后台刷新
 */

const invokeWithErrorHandlerMock = vi.hoisted(() => vi.fn().mockResolvedValue({}))
const invokeSilentlyMock = vi.hoisted(() => vi.fn().mockResolvedValue(null))
vi.mock('@/utils/TauriInvokeHandler', () => ({
  invokeWithErrorHandler: invokeWithErrorHandlerMock,
  invokeSilently: invokeSilentlyMock,
  ErrorType: { Network: 'Network', Unknown: 'Unknown' }
}))
vi.mock('@/utils/PlatformConstants', () => ({ isWeb: () => false }))

const chatStoreMock = vi.hoisted(() => ({ updateSession: vi.fn() }))
vi.mock('@/stores/chat', () => ({ useChatStore: () => chatStoreMock }))
const groupStoreMock = vi.hoisted(() => ({
  countInfo: null as null | object,
  updateGroupDetail: vi.fn()
}))
vi.mock('@/stores/group', () => ({ useGroupStore: () => groupStoreMock }))

import { getMsgReadCount, getNoticeUnreadCount, markMsgRead } from '@/utils/ImRequestUtils'

describe('#209 后台自动调用默认静默（showError:false 透传）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const cases: Array<[string, () => Promise<unknown>]> = [
    ['markMsgRead 已读上报', () => markMsgRead('r1')],
    ['getMsgReadCount 已读计数轮询', () => getMsgReadCount([1, 2])]
  ]

  for (const [name, call] of cases) {
    it(`${name}：底层调用带 showError:false（不弹裸 network_error toast）`, async () => {
      await call()
      expect(invokeWithErrorHandlerMock).toHaveBeenCalledWith(
        'im_request_command',
        expect.anything(),
        expect.objectContaining({ showError: false })
      )
    })
  }

  it('getNoticeUnreadCount 未读数刷新：走 invokeSilently（既有静默行为回归锁）', async () => {
    await getNoticeUnreadCount()
    expect(invokeSilentlyMock).toHaveBeenCalledWith('im_request_command', expect.anything())
    expect(invokeWithErrorHandlerMock).not.toHaveBeenCalled()
  })
})
