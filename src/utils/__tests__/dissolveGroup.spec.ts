import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-016 #195 F4：解散群防重 + 乐观移除（PRD #190 裁决 3）。
 * 确认即 emit DELETE_SESSION（不等 HTTP）；失败纯本地回滚（恢复会话，不发起任何 server 调用）并返回 false。
 */

const emitMock = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useMitt', () => ({
  useMitt: { emit: emitMock, on: vi.fn(), off: vi.fn() }
}))

const groupStoreMocks = vi.hoisted(() => ({
  exitGroup: vi.fn().mockResolvedValue(undefined),
  isRoomDissolved: vi.fn().mockReturnValue(false)
}))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => groupStoreMocks
}))

const chatStoreMocks = vi.hoisted(() => ({
  addSession: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/stores/chat', () => ({
  useChatStore: () => chatStoreMocks
}))

const invokeMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/utils/TauriInvokeHandler', () => ({
  invokeWithErrorHandler: (...args: unknown[]) => invokeMock(...args)
}))

import { MittEnum } from '@/enums'
import { dissolveGroupOptimistic } from '@/utils/dissolveGroup'

describe('dissolveGroupOptimistic（REQ-016 #195 F4）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    groupStoreMocks.exitGroup.mockResolvedValue(undefined)
    groupStoreMocks.isRoomDissolved.mockReturnValue(false)
    chatStoreMocks.addSession.mockResolvedValue(undefined)
    invokeMock.mockResolvedValue(undefined)
  })

  it('乐观移除：DELETE_SESSION 在 exitGroup 完成前已 emit', async () => {
    let release: (v: unknown) => void
    groupStoreMocks.exitGroup.mockReturnValue(new Promise((r) => (release = r)))

    const done = dissolveGroupOptimistic('room-1')
    // HTTP 仍在途，会话已被乐观移除
    expect(emitMock).toHaveBeenCalledWith(MittEnum.DELETE_SESSION, 'room-1')

    release!(undefined)
    await expect(done).resolves.toBe(true)
    expect(chatStoreMocks.addSession).not.toHaveBeenCalled()
  })

  // PR#55 裁决（P1）：回滚纯本地化——exit 失败说明请求未成功，server 从未 hide 过该会话，
  // 无需 unhide；断网场景 unhide 本身也必然失败。只本地 addSession 拉回会话。
  it('失败回滚：纯本地恢复会话，不发起任何 server 调用，返回 false', async () => {
    groupStoreMocks.exitGroup.mockRejectedValue(new Error('server error'))

    await expect(dissolveGroupOptimistic('room-1')).resolves.toBe(false)

    expect(emitMock).toHaveBeenCalledWith(MittEnum.DELETE_SESSION, 'room-1')
    expect(invokeMock).not.toHaveBeenCalled()
    expect(chatStoreMocks.addSession).toHaveBeenCalledWith('room-1')
  })

  it('回滚动作自身失败也不再抛出', async () => {
    groupStoreMocks.exitGroup.mockRejectedValue(new Error('server error'))
    chatStoreMocks.addSession.mockRejectedValue(new Error('session gone'))

    await expect(dissolveGroupOptimistic('room-1')).resolves.toBe(false)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  // PR#55 裁决（P1）：断网路径——exit 请求根本没到达 server，回滚同样不得发起任何 server 调用
  it('断网失败：回滚不发起任何 server 调用（含 unhide）', async () => {
    groupStoreMocks.exitGroup.mockRejectedValue(new Error('network offline'))

    await expect(dissolveGroupOptimistic('room-1')).resolves.toBe(false)

    expect(invokeMock).not.toHaveBeenCalled()
    expect(chatStoreMocks.addSession).toHaveBeenCalledWith('room-1')
  })

  // PR#55 裁决（P2 竞态）：server 已处理解散但 HTTP 响应丢失时，WS 已 markRoomDissolved，
  // 回滚必须短路——addSession 重加 = 复活幽灵会话
  it('HTTP 失败但房间已确认解散（isRoomDissolved）：回滚短路不重加，返回 true', async () => {
    groupStoreMocks.exitGroup.mockRejectedValue(new Error('response lost'))
    groupStoreMocks.isRoomDissolved.mockReturnValue(true)

    await expect(dissolveGroupOptimistic('room-1')).resolves.toBe(true)

    expect(chatStoreMocks.addSession).not.toHaveBeenCalled()
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
