import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-016 #195 F4：解散群防重 + 乐观移除（PRD #190 裁决 3）。
 * 确认即 emit DELETE_SESSION（不等 HTTP）；失败回滚（取消隐藏 + 恢复会话）并返回 false。
 */

const emitMock = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useMitt', () => ({
  useMitt: { emit: emitMock, on: vi.fn(), off: vi.fn() }
}))

const groupStoreMocks = vi.hoisted(() => ({
  exitGroup: vi.fn().mockResolvedValue(undefined)
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

  it('失败回滚：取消隐藏 + 恢复会话，返回 false', async () => {
    groupStoreMocks.exitGroup.mockRejectedValue(new Error('server error'))

    await expect(dissolveGroupOptimistic('room-1')).resolves.toBe(false)

    expect(emitMock).toHaveBeenCalledWith(MittEnum.DELETE_SESSION, 'room-1')
    expect(invokeMock).toHaveBeenCalledWith('hide_contact_command', { data: { roomId: 'room-1', hide: false } })
    expect(chatStoreMocks.addSession).toHaveBeenCalledWith('room-1')
  })

  it('回滚动作自身失败也不再抛出', async () => {
    groupStoreMocks.exitGroup.mockRejectedValue(new Error('server error'))
    invokeMock.mockRejectedValue(new Error('invoke fail'))
    chatStoreMocks.addSession.mockRejectedValue(new Error('session gone'))

    await expect(dissolveGroupOptimistic('room-1')).resolves.toBe(false)
  })
})
