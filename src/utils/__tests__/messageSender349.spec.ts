import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  class WorkerStub {
    postMessage() {}
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  }
  globalThis.Worker = WorkerStub as unknown as typeof Worker
})
import { getSendBlockReason } from '@/utils/MessageSender'

describe('sendBlockReason349', () => {
  it('无目标会话时拦截（先选会话再发送）', () => {
    expect(getSendBlockReason('', '130516976771584')).toBe('no-session')
  })

  it('无登录身份时拦截（身份未就绪）', () => {
    expect(getSendBlockReason('175988626166784', '')).toBe('no-identity')
    expect(getSendBlockReason('175988626166784', undefined)).toBe('no-identity')
  })

  it('身份/目标有效即允许提交（不检查 WS/思考/群资料）', () => {
    expect(getSendBlockReason('175988626166784', '130516976771584')).toBeNull()
  })
})
