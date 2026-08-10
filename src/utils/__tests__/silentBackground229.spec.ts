import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#229（#209 review 遗留 tranche-2）：同噪声类后台调用断网静默。
 * - getFriendPage / getBadgesBatch 支持 showError:false 透传（getContactList /
 *   cached.getAllBadgeList 静默的载体），不传选项时保持默认行为不变
 *
 * store 级行为锁在 silentBackground229Stores.spec.ts。
 * getSessionList（重连重拉）涉 ISS-009 领域 UX 边界，不在本 spec——待 manager 确认后另案。
 */

const invokeWithErrorHandlerMock = vi.hoisted(() => vi.fn().mockResolvedValue({}))
const invokeSilentlyMock = vi.hoisted(() => vi.fn().mockResolvedValue(null))
vi.mock('@/utils/TauriInvokeHandler', () => ({
  invokeWithErrorHandler: invokeWithErrorHandlerMock,
  invokeSilently: invokeSilentlyMock,
  ErrorType: { Network: 'Network', Unknown: 'Unknown' }
}))
vi.mock('@/utils/PlatformConstants', () => ({ isWeb: () => false }))

// ImRequestUtils 顶层会传递引入 chat store（模块级 new Worker，happy-dom 无 Worker）——与 #209 spec 同款隔离
const chatStoreMock = vi.hoisted(() => ({ updateSession: vi.fn() }))
vi.mock('@/stores/chat', () => ({ useChatStore: () => chatStoreMock }))
const groupStoreMock = vi.hoisted(() => ({
  countInfo: null as null | object,
  updateGroupDetail: vi.fn()
}))
vi.mock('@/stores/group', () => ({ useGroupStore: () => groupStoreMock }))

import { getBadgesBatch, getFriendPage } from '@/utils/ImRequestUtils'

describe('#229 后台调用静默（showError:false 透传）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getFriendPage 支持 showError:false 透传（getContactList 静默的载体）', async () => {
    await getFriendPage({ cursor: '' }, { showError: false })
    expect(invokeWithErrorHandlerMock).toHaveBeenCalledWith(
      'im_request_command',
      expect.anything(),
      expect.objectContaining({ showError: false })
    )
  })

  it('getFriendPage 不传选项时保持默认（showError 缺省，既有行为不变）', async () => {
    await getFriendPage({ cursor: '' })
    const opts = invokeWithErrorHandlerMock.mock.calls[0][2]
    expect(opts?.showError).toBeUndefined()
  })

  it('getBadgesBatch 支持 showError:false 透传', async () => {
    await getBadgesBatch([], { showError: false })
    expect(invokeWithErrorHandlerMock).toHaveBeenCalledWith(
      'im_request_command',
      expect.anything(),
      expect.objectContaining({ showError: false })
    )
  })
})
