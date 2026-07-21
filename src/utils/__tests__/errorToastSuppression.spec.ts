import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * #179 TC-03：中央错误 toast 抑制注册表 + invokeWithErrorHandler 集成合同。
 */

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: any[]) => invokeMock(...args)
}))

import {
  armBootSuppression,
  isBootSuppressionActive,
  isErrorToastSuppressed,
  isRoomErrorToastSuppressed,
  releaseBootSuppressionAfterSync,
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

describe('启动权威同步窗口（#179 Q2）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ;(window as any).$message = { error: vi.fn(), info: vi.fn() }
  })

  afterEach(async () => {
    // 关窗兜底，避免用例间泄漏
    releaseBootSuppressionAfterSync(0)
    await vi.advanceTimersByTimeAsync(1)
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('窗口生命周期：开窗生效；首次同步落地后经宽限关窗；硬超时确定性关窗', async () => {
    armBootSuppression()
    expect(isBootSuppressionActive()).toBe(true)

    // 首次同步落地：宽限期内仍抑制，宽限后关闭
    releaseBootSuppressionAfterSync()
    expect(isBootSuppressionActive()).toBe(true)
    await vi.advanceTimersByTimeAsync(4999)
    expect(isBootSuppressionActive()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(isBootSuppressionActive()).toBe(false)

    // 同步永不到达：硬超时确定性关窗（不永久武装）
    armBootSuppression()
    expect(isBootSuppressionActive()).toBe(true)
    await vi.advanceTimersByTimeAsync(19999)
    expect(isBootSuppressionActive()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(isBootSuppressionActive()).toBe(false)
  })

  it('窗口内：任意 roomId 级错误 toast 被压制；非 roomId 作用域（登录等）不受影响', () => {
    armBootSuppression()

    expect(isErrorToastSuppressed({ roomId: 'any-room' })).toBe(true)
    expect(isErrorToastSuppressed({ body: { roomId: 185796351809536 } })).toBe(true)
    expect(isErrorToastSuppressed({ params: { room_id: 'r2' } })).toBe(true)
    // 非 roomId 作用域必须照常可见（登录失败、WS 断连等全局错误）
    expect(isErrorToastSuppressed({ url: 'login' })).toBe(false)
    expect(isErrorToastSuppressed({})).toBe(false)
    expect(isErrorToastSuppressed(undefined)).toBe(false)
  })

  it('窗口外：未注册的 roomId 不再抑制', async () => {
    armBootSuppression()
    releaseBootSuppressionAfterSync(0)
    await vi.advanceTimersByTimeAsync(1)

    expect(isBootSuppressionActive()).toBe(false)
    expect(isErrorToastSuppressed({ roomId: 'any-room' })).toBe(false)
  })
})
