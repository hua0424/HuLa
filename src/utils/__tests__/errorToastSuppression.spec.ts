import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * #179 TC-03：中央错误 toast 抑制注册表 + invokeWithErrorHandler 集成合同。
 */

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: any[]) => invokeMock(...args)
}))

import {
  isErrorToastSuppressed,
  isRoomErrorToastSuppressed,
  releaseErrorToastsForRoom,
  suppressErrorToastsForRoom
} from '@/utils/errorToastSuppression'
import { invokeWithErrorHandler } from '@/utils/TauriInvokeHandler'

describe('errorToastSuppression 注册表（#179 TC-03）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ;(window as any).$message = { error: vi.fn(), info: vi.fn() }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('suppress 后按 roomId 命中；release 延迟 5s 后恢复；重复 suppress 取消释放', async () => {
    suppressErrorToastsForRoom('r1')
    expect(isRoomErrorToastSuppressed('r1')).toBe(true)
    expect(isErrorToastSuppressed({ roomId: 'r1' })).toBe(true)
    // 数字 roomId 归一化为字符串
    expect(isErrorToastSuppressed({ roomId: 'r1' })).toBe(true)
    expect(isErrorToastSuppressed({ body: { roomId: 'r1' } })).toBe(true)
    expect(isErrorToastSuppressed({ params: { roomId: 'r1' } })).toBe(true)
    expect(isErrorToastSuppressed({ roomId: 'other' })).toBe(false)
    expect(isErrorToastSuppressed({})).toBe(false)
    expect(isErrorToastSuppressed(undefined)).toBe(false)

    releaseErrorToastsForRoom('r1')
    expect(isRoomErrorToastSuppressed('r1')).toBe(true) // 延迟窗口内仍抑制

    // 窗口内再次 suppress 取消释放计时
    await vi.advanceTimersByTimeAsync(3000)
    suppressErrorToastsForRoom('r1')
    releaseErrorToastsForRoom('r1')
    await vi.advanceTimersByTimeAsync(4999)
    expect(isRoomErrorToastSuppressed('r1')).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(isRoomErrorToastSuppressed('r1')).toBe(false)
  })

  it('invokeWithErrorHandler：抑制窗口内失败不弹错误 toast，窗口外正常弹', async () => {
    invokeMock.mockRejectedValue(new Error('房间号有误'))

    suppressErrorToastsForRoom('room-ghost')
    await expect(invokeWithErrorHandler('im_request_command', { body: { roomId: 'room-ghost' } })).rejects.toThrow(
      '房间号有误'
    )
    expect((window as any).$message.error).not.toHaveBeenCalled()

    releaseErrorToastsForRoom('room-ghost', 0)
    await vi.advanceTimersByTimeAsync(1)

    await expect(invokeWithErrorHandler('im_request_command', { body: { roomId: 'room-ghost' } })).rejects.toThrow(
      '房间号有误'
    )
    expect((window as any).$message.error).toHaveBeenCalledTimes(1)
  })
})
