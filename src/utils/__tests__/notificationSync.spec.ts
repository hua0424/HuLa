import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * #482：业务提交结果与逐目标推送接收反馈闭环（前端一侧）
 * - 写操作可选读取顶层 notificationSync；缺省字段表示没有补充信息，绝不当成已送达；
 * - INCOMPLETE 只产生一条非阻塞警告，不叠加成功 toast，也不抛错让调用方误判业务失败；
 * - 切换账号或切换会话后到达的旧响应不再弹提示。
 */

const invokeWithErrorHandlerMock = vi.hoisted(() => vi.fn().mockResolvedValue({ data: true, notificationSync: null }))
vi.mock('@/utils/TauriInvokeHandler', () => ({
  invokeWithErrorHandler: invokeWithErrorHandlerMock,
  invokeSilently: vi.fn().mockResolvedValue(null),
  ErrorType: { Network: 'Network', Unknown: 'Unknown' }
}))
vi.mock('@/utils/PlatformConstants', () => ({ isWeb: () => false }))

const chatStoreMock = vi.hoisted(() => ({ updateSession: vi.fn() }))
vi.mock('@/stores/chat', () => ({ useChatStore: () => chatStoreMock }))
const groupStoreMock = vi.hoisted(() => ({
  countInfo: { groupName: 'g', avatar: 'a', allowScanEnter: true },
  updateGroupDetail: vi.fn()
}))
vi.mock('@/stores/group', () => ({ useGroupStore: () => groupStoreMock }))
const userStoreMock = vi.hoisted(() => ({ userInfo: { uid: 'u1' } as { uid?: string } }))
vi.mock('@/stores/user', () => ({ useUserStore: () => userStoreMock }))
const sessionBindingMock = vi.hoisted(() => ({ value: { backendKey: 'b', uid: 'u1', sessionEpoch: 1 } as any }))
vi.mock('@/services/sessionBinding', () => ({ sessionBinding: sessionBindingMock }))
const globalStoreMock = vi.hoisted(() => ({ currentSessionRoomId: 'r1' }))
vi.mock('@/stores/global', () => ({ useGlobalStore: () => globalStoreMock }))

import { NOTIFICATION_SYNC_INCOMPLETE_MESSAGE, updateRoomInfo } from '@/utils/ImRequestUtils'
import { ImUrlEnum } from '@/enums'
import { webImRequest, webImRequestWithSync } from '@/utils/webImRequest'

const toast = () => (window as any).$message as { success: ReturnType<typeof vi.fn>; warning: ReturnType<typeof vi.fn> }

describe('#482 notificationSync 回执', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeWithErrorHandlerMock.mockResolvedValue({ data: true, notificationSync: null })
    userStoreMock.userInfo = { uid: 'u1' }
    sessionBindingMock.value = { backendKey: 'b', uid: 'u1', sessionEpoch: 1 }
    globalStoreMock.currentSessionRoomId = 'r1'
    ;(window as any).$message = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('INCOMPLETE：只弹一条“已保存但同步未完”的警告，不叠加成功提示', async () => {
    invokeWithErrorHandlerMock.mockResolvedValue({ data: true, notificationSync: { state: 'INCOMPLETE' } })
    const result = await updateRoomInfo({ id: 'r1', name: 'n' })
    expect(result.notificationSync?.state).toBe('INCOMPLETE')
    expect(toast().warning).toHaveBeenCalledTimes(1)
    expect(toast().warning).toHaveBeenCalledWith(NOTIFICATION_SYNC_INCOMPLETE_MESSAGE)
    expect(toast().success).not.toHaveBeenCalled()
    // 本地缓存仍按业务成功更新
    expect(chatStoreMock.updateSession).toHaveBeenCalledTimes(1)
    expect(groupStoreMock.updateGroupDetail).toHaveBeenCalledTimes(1)
  })

  it('缺省 notificationSync：保持原有单条成功提示，不推断已送达', async () => {
    const result = await updateRoomInfo({ id: 'r1', name: 'n' })
    expect(result.notificationSync).toBeNull()
    expect(toast().success).toHaveBeenCalledTimes(1)
    expect(toast().warning).not.toHaveBeenCalled()
  })

  it('切换会话后到达的旧响应不弹任何提示', async () => {
    invokeWithErrorHandlerMock.mockImplementation(async () => {
      globalStoreMock.currentSessionRoomId = 'r2'
      return { data: true, notificationSync: { state: 'INCOMPLETE' } }
    })
    await updateRoomInfo({ id: 'r1', name: 'n' })
    expect(toast().warning).not.toHaveBeenCalled()
    expect(toast().success).not.toHaveBeenCalled()
  })

  it('切换账号后到达的旧响应不弹任何提示', async () => {
    invokeWithErrorHandlerMock.mockImplementation(async () => {
      sessionBindingMock.value = { backendKey: 'b', uid: 'u1', sessionEpoch: 2 }
      return { data: true, notificationSync: null }
    })
    await updateRoomInfo({ id: 'r1', name: 'n' })
    expect(toast().success).not.toHaveBeenCalled()
    expect(toast().warning).not.toHaveBeenCalled()
  })

  it('webImRequest 保持只返回 data，webImRequestWithSync 额外暴露 notificationSync', async () => {
    vi.stubEnv('VITE_WEB_API_URL', 'http://127.0.0.1:9')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: 200, success: true, data: true, notificationSync: { state: 'INCOMPLETE' } })
      })
    )
    await expect(webImRequest<boolean>(ImUrlEnum.UPDATE_ROOM_INFO, { id: 'r1' })).resolves.toBe(true)
    await expect(webImRequestWithSync<boolean>(ImUrlEnum.UPDATE_ROOM_INFO, { id: 'r1' })).resolves.toEqual({
      data: true,
      notificationSync: { state: 'INCOMPLETE' }
    })
  })

  it('webImRequestWithSync：无信封响应（非管理端代理）时 notificationSync 为空，不伪造状态', async () => {
    vi.stubEnv('VITE_WEB_API_URL', 'http://127.0.0.1:9')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: true }) }))
    await expect(webImRequestWithSync<boolean>(ImUrlEnum.UPDATE_ROOM_INFO, { id: 'r1' })).resolves.toEqual({
      data: { data: true },
      notificationSync: null
    })
  })
})
