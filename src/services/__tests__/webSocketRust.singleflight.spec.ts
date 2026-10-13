import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UnlistenFn } from '@tauri-apps/api/event'

/**
 * aichatoverview#402：原生 WS 监听单飞初始化与失败回滚。
 *
 * 原生替身保留同事件全部 callback（append-only 数组，不以 Map 覆盖掩蔽重复），
 * 先用旧入口语义（无单飞、无回滚）复现红灯，再证明修复后绿灯。
 */

const mittEmitMock = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useMitt', () => ({
  useMitt: { emit: mittEmitMock, on: vi.fn(), off: vi.fn() }
}))
vi.mock('@/stores/contacts', () => ({
  useContactStore: () => ({ deleteContact: vi.fn() })
}))
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

type NativeRec = { event: string; cb: (e: any) => void; live: boolean }
const nativeRegs: NativeRec[] = []
// 本次运行生效的故障注入（每个测试前重置）
const faults = {
  failListen: new Set<string>(),
  failUnlisten: new Set<string>(),
  hangUnlisten: new Set<string>()
}
let listenCalls = 0

vi.mock('@/services/sessionBinding', () => ({
  invokeScoped: vi.fn().mockResolvedValue(undefined),
  listenBound: vi.fn(async (event: string, cb: (e: any) => void): Promise<UnlistenFn> => {
    listenCalls += 1
    if (faults.failListen.has(event)) throw new Error(`native listen failed: ${event}`)
    const rec: NativeRec = { event, cb, live: true }
    nativeRegs.push(rec)
    return (() => {
      if (faults.hangUnlisten.has(event)) return new Promise<void>(() => {})
      if (faults.failUnlisten.has(event)) return Promise.reject(new Error(`native unlisten failed: ${event}`))
      rec.live = false
    }) as UnlistenFn
  })
}))

import { ListenerController, RustWebSocketClient } from '@/services/webSocketRust'
import { WsResponseMessageType } from '@/services/wsType'

const liveOf = (event: string) => nativeRegs.filter((r) => r.event === event && r.live)
const distinctEvents = () => [...new Set(nativeRegs.map((r) => r.event))]
const fire = (event: string, payload: any = {}) => {
  for (const r of liveOf(event)) r.cb({ payload })
}

beforeEach(() => {
  nativeRegs.length = 0
  listenCalls = 0
  faults.failListen.clear()
  faults.failUnlisten.clear()
  faults.hangUnlisten.clear()
  mittEmitMock.mockClear()
})

describe('webSocketRust #402 单飞初始化与失败回滚', () => {
  it('红灯记录（旧入口语义）：两次无守卫全量注册 → 同事件 2 callback，一帧分发 2 次', async () => {
    // 旧 setupBusinessMessageListeners 公共入口 = 每次调用各自全量注册（仅 ready 守卫）。
    // 此处用同一注册体绕过新入口复现，断言重复分发真实发生（期望 2，记录缺陷）。
    const a = new RustWebSocketClient()
    const b = new RustWebSocketClient()
    await Promise.all([(a as any).registerBusinessListeners(), (b as any).registerBusinessListeners()])
    expect(liveOf('ws-thinking-end')).toHaveLength(2)

    fire('ws-thinking-end', { thinkingId: 't-red' })
    expect(mittEmitMock.mock.calls.filter((c) => c[0] === WsResponseMessageType.THINKING_END)).toHaveLength(2)
  })

  it('顺序重复 setup：只注册一批，第二次不再注册', async () => {
    const client = new RustWebSocketClient()
    await client.setupBusinessMessageListeners()
    const firstCalls = listenCalls
    expect(firstCalls).toBeGreaterThan(0)

    await client.setupBusinessMessageListeners()
    expect(listenCalls).toBe(firstCalls)
    for (const event of distinctEvents()) expect(liveOf(event)).toHaveLength(1)
  })

  it('并发两次 setup：同一尝试、同一成功，只有一批注册', async () => {
    const client = new RustWebSocketClient()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { listenBound } = await import('@/services/sessionBinding')
    const orig = (listenBound as any).getMockImplementation()
    ;(listenBound as any).mockImplementationOnce(async (event: string, cb: (e: any) => void) => {
      await gate
      return orig(event, cb)
    })

    const p1 = client.setupBusinessMessageListeners()
    const p2 = client.setupBusinessMessageListeners()
    release()
    await Promise.all([p1, p2])

    for (const event of distinctEvents()) expect(liveOf(event)).toHaveLength(1)
  })

  it('中途注册失败：等待者同拒绝、已注册项全部回滚、未提前 ready', async () => {
    const client = new RustWebSocketClient()
    faults.failListen.add('ws-thinking-end')
    const p1 = client.setupBusinessMessageListeners()
    const p2 = client.setupBusinessMessageListeners()
    await expect(p1).rejects.toThrow('native listen failed: ws-thinking-end')
    await expect(p2).rejects.toThrow('native listen failed: ws-thinking-end')

    expect(nativeRegs.filter((r) => r.live)).toHaveLength(0)
    expect((client as any).businessListenersReady).toBe(false)
    expect((client as any).businessListenersPromise).toBeNull()
  })

  it('失败清理确认后重试：只有一份监听', async () => {
    const client = new RustWebSocketClient()
    faults.failListen.add('ws-thinking-end')
    await expect(client.setupBusinessMessageListeners()).rejects.toThrow()

    faults.failListen.clear()
    await client.setupBusinessMessageListeners()
    for (const event of distinctEvents()) expect(liveOf(event)).toHaveLength(1)
  })

  it('unlisten 失败可见：错误上报回滚未确认、未确认项保留、盲重试被拒', async () => {
    const client = new RustWebSocketClient()
    faults.failListen.add('ws-receive-message')
    faults.failUnlisten.add('ws-login-success')
    await expect(client.setupBusinessMessageListeners()).rejects.toThrow(/回滚未确认/)

    // 未确认项不得丢失
    expect((client as any).pendingCleanup).toHaveLength(1)

    // 盲重试被拒绝：不再新增注册
    const callsBefore = listenCalls
    await expect(client.setupBusinessMessageListeners()).rejects.toThrow(/仍未确认/)
    expect(listenCalls).toBe(callsBefore)

    // 残留释放成功后重试恢复单份
    faults.failListen.clear()
    faults.failUnlisten.clear()
    await client.setupBusinessMessageListeners()
    for (const event of distinctEvents()) expect(liveOf(event)).toHaveLength(1)
  })

  it('unlisten 超时可见：永不完成的清理按超时计未确认', async () => {
    vi.useFakeTimers()
    try {
      const client = new RustWebSocketClient()
      faults.failListen.add('ws-receive-message')
      faults.hangUnlisten.add('ws-login-success')
      const p = client.setupBusinessMessageListeners()
      await vi.advanceTimersByTimeAsync(6000)
      await expect(p).rejects.toThrow(/回滚未确认/)
      expect((client as any).pendingCleanup).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('每个原生帧恰一次 mitt 分发（START/END、receive、recall、stream）', async () => {
    const client = new RustWebSocketClient()
    await client.setupBusinessMessageListeners()

    fire('ws-thinking-start', { thinkingId: 't1' })
    fire('ws-thinking-end', { thinkingId: 't1' })
    fire('ws-receive-message', { id: 'm1' })
    fire('ws-msg-recall', { id: 'm1' })
    fire('ws-stream-start', { id: 's1' })
    fire('ws-stream-delta', { id: 's1' })
    fire('ws-stream-end', { id: 's1' })

    const count = (type: string) => mittEmitMock.mock.calls.filter((c) => c[0] === type).length
    expect(count(WsResponseMessageType.THINKING_START)).toBe(1)
    expect(count(WsResponseMessageType.THINKING_END)).toBe(1)
    expect(count(WsResponseMessageType.RECEIVE_MESSAGE)).toBe(1)
    expect(count(WsResponseMessageType.MSG_RECALL)).toBe(1)
    expect(count(WsResponseMessageType.STREAM_START)).toBe(1)
    expect(count(WsResponseMessageType.STREAM_DELTA)).toBe(1)
    expect(count(WsResponseMessageType.STREAM_END)).toBe(1)
  })

  it('ListenerController.abort：仅移除确认项，未确认保留并返回', async () => {
    const controller = new ListenerController()
    const okUnlisten = vi.fn()
    const badUnlisten = vi.fn().mockRejectedValue(new Error('nope'))
    controller.add(okUnlisten as unknown as UnlistenFn)
    controller.add(badUnlisten as unknown as UnlistenFn)

    const unconfirmed = await controller.abort()
    expect(okUnlisten).toHaveBeenCalledTimes(1)
    expect(unconfirmed).toHaveLength(1)
    expect(controller.size).toBe(1)
  })
})
