import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * #482：新增的 `im_sync_request_command` 与 `im_request_command` 走同一条 IM HTTP 通道，
 * 认证路由必须同样带上发起请求时的账号绑定；public 路由保持不绑定。
 * 这条断言守住“新命令漏出账号隔离”的回归。
 */

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))

import { prepareScopedArgs } from '@/services/sessionBinding'

const identity = { backendKey: 'backend-1', uid: 'u1', sessionEpoch: 3 }

describe('#482 im_sync_request_command 账号绑定', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue({ sessionEpoch: identity.sessionEpoch, binding: { ...identity } })
  })

  it('认证路由会补齐绑定，和 im_request_command 一致', async () => {
    const args = await prepareScopedArgs('im_sync_request_command', { url: 'updateRoomInfo', body: { id: 'r1' } })
    expect((args as { binding?: unknown }).binding).toEqual(identity)
  })

  it('public 路由不会被强行绑定', async () => {
    const args = await prepareScopedArgs('im_sync_request_command', { url: 'login' })
    expect((args as { binding?: unknown }).binding).toBeUndefined()
  })

  it('两个 IM 命令得到同样的绑定结果（不因新命令而放宽或收紧）', async () => {
    const legacy = await prepareScopedArgs('im_request_command', { url: 'updateMyRoomInfo' })
    const synced = await prepareScopedArgs('im_sync_request_command', { url: 'updateMyRoomInfo' })
    expect((synced as { binding?: unknown }).binding).toEqual((legacy as { binding?: unknown }).binding)
  })
})
