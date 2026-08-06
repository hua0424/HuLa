import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-017 #198：WS 假在线修复 —— web 侧收到 4001（token 失效专属关闭码，server #206 契约）
 * 必须停止无限裸重连并发出 WS_AUTH_FAILED（跳登录重鉴）；普通断线（1006 等）维持原有退避重连。
 */

const mittEmitMock = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useMitt', () => ({
  useMitt: { emit: mittEmitMock, on: vi.fn(), off: vi.fn() }
}))
vi.mock('@/services/fingerprint', () => ({
  getEnhancedFingerprint: vi.fn().mockResolvedValue('fp-test')
}))
vi.mock('@/stores/user', () => ({
  useUserStore: () => ({ userInfo: { token: 'tok-test' } })
}))
vi.mock('@/stores/contacts', () => ({
  useContactStore: () => ({ deleteContact: vi.fn() })
}))

class MockWebSocket {
  static readonly OPEN = 1
  static instances: MockWebSocket[] = []

  readonly url: string
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: ((err: unknown) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(_data: string) {}

  close() {
    this.readyState = 3
    this.onclose?.({ code: 1005 })
  }

  /** 测试辅助：模拟已握手成功 */
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  /** 测试辅助：模拟服务端关闭帧 */
  simulateClose(code: number) {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

import webSocketWebClient, { WebConnectionState } from '@/services/webSocketWeb'
import { WsResponseMessageType } from '@/services/wsType'

describe('webSocketWeb #198 鉴权失败降级（4001 契约）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    mittEmitMock.mockClear()
    vi.stubGlobal('WebSocket', MockWebSocket)
    import.meta.env.VITE_WEB_WS_URL = 'ws://test.local/ws'
    webSocketWebClient.disconnect()
  })

  afterEach(() => {
    webSocketWebClient.disconnect()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('收到 4001：停止重连（不再新建 WebSocket），发出 WS_AUTH_FAILED，状态收敛 ERROR', async () => {
    await webSocketWebClient.initConnect()
    expect(MockWebSocket.instances).toHaveLength(1)

    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()
    ws.simulateClose(4001)

    expect(mittEmitMock).toHaveBeenCalledWith(
      WsResponseMessageType.WS_AUTH_FAILED,
      expect.objectContaining({ reason: expect.any(String) })
    )
    expect(await webSocketWebClient.getState()).toBe(WebConnectionState.ERROR)

    // 推进足够长的时间（远超最大退避 30s），不得有任何重连
    await vi.advanceTimersByTimeAsync(120000)
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('4001 后心跳不再发送', async () => {
    await webSocketWebClient.initConnect()
    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()
    const sendSpy = vi.spyOn(ws, 'send')
    ws.simulateClose(4001)

    await vi.advanceTimersByTimeAsync(60000)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('普通断线（1006）：维持指数退避重连（回归守护）', async () => {
    await webSocketWebClient.initConnect()
    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()
    ws.simulateClose(1006)

    expect(mittEmitMock).not.toHaveBeenCalledWith(WsResponseMessageType.WS_AUTH_FAILED, expect.anything())

    await vi.advanceTimersByTimeAsync(5000)
    expect(MockWebSocket.instances.length).toBeGreaterThan(1)
  })

  it('主动 disconnect 后收到 4001 也不再重连、不发事件', async () => {
    await webSocketWebClient.initConnect()
    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()
    webSocketWebClient.disconnect()
    mittEmitMock.mockClear()

    ws.simulateClose(4001)

    await vi.advanceTimersByTimeAsync(60000)
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(mittEmitMock).not.toHaveBeenCalledWith(WsResponseMessageType.WS_AUTH_FAILED, expect.anything())
  })
})
