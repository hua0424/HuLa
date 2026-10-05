import { describe, expect, it, vi } from 'vitest'
import { createBootAttempt, createRequestId, getCurrentBootAttempt, logBoot, scheduleIdle } from '@/utils/bootAttempt'

describe('bootAttempt349', () => {
  it('bootAttempt 唯一且成为当前引用', () => {
    const a = createBootAttempt()
    const b = createBootAttempt()
    expect(a).not.toBe(b)
    expect(getCurrentBootAttempt()).toBe(b)
  })

  it('requestId 携带 bootAttempt 与 phase', () => {
    const id = createRequestId('boot-x', 'local_readable')
    expect(id.startsWith('boot-x/local_readable-')).toBe(true)
  })

  it('logBoot 单行结构化输出', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logBoot('boot-x', 'boot-x/send_ready-1', 'send_ready', 'room=1')
    expect(spy).toHaveBeenCalledOnce()
    const line = String(spy.mock.calls[0][0])
    expect(line).toContain('attempt=boot-x')
    expect(line).toContain('phase=send_ready')
    expect(line).toContain('room=1')
    spy.mockRestore()
  })

  it('scheduleIdle 无 requestIdleCallback 时降级执行', async () => {
    const fn = vi.fn()
    scheduleIdle(fn)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fn).toHaveBeenCalledOnce()
  })
})
