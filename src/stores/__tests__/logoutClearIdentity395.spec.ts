import { createPinia, setActivePinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#395：退出后清除活跃身份并支持安全无重启切号。
 * 根因：显式退出只清 localStorage 一项，live Pinia userInfo 残留，自动化又把显示 UID
 * 当有效身份报 EXISTING_DIFFERENT_ACCOUNT。
 * 本文件用真实 user store + 真实 persistence，只替换网络/IPC adapter：
 * - clearActiveIdentity 清 live + 当前持久化，保留 loginHistory，不做 localStorage.clear；
 * - 迟到 user-detail / 共享 userInfoChange 响应不得复活旧身份或写入新作用域。
 */

vi.hoisted(() => {
  class WorkerStub {
    onerror: ((e: unknown) => void) | null = null
    postMessage() {}
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  }
  globalThis.Worker = WorkerStub as unknown as typeof Worker
})

const getUserDetailMock = vi.hoisted(() => vi.fn())
const getUserByIdsMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  getUserDetail: (...args: unknown[]) => getUserDetailMock(...args),
  getUserByIds: (...args: unknown[]) => getUserByIdsMock(...args)
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'home' })
}))

import { readStoredActiveUid, useUserStore } from '@/stores/user'
import { useLoginHistoriesStore } from '@/stores/loginHistory'
import { handleUserInfoChange } from '@/utils/userInfoChange'

function piniaWithPersist() {
  const pinia = createPinia()
  pinia.use(createPersistedState({ auto: true }))
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return pinia
}

const userA = { uid: 'A-1', account: 'a1', name: 'A', token: 't', refreshToken: 'r' } as any

describe('#395 退出清除活跃身份', () => {
  beforeEach(() => {
    piniaWithPersist()
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('clearActiveIdentity 清 live + 当前持久化，保留登录历史，不清其他键', async () => {
    const userStore = useUserStore()
    const histories = useLoginHistoriesStore()
    userStore.userInfo = { ...userA }
    histories.addLoginHistory({ ...userA })
    localStorage.setItem('keep', '1')
    await vi.waitFor(() => expect(readStoredActiveUid()).toBe('A-1'))

    userStore.clearActiveIdentity()

    expect(userStore.userInfo).toBeUndefined()
    expect(readStoredActiveUid()).toBe('')
    expect(localStorage.getItem('keep')).toBe('1')
    expect(histories.loginHistories.map((h: any) => h.account)).toContain('a1')
  })

  it('重复清理幂等，不抛错', () => {
    const userStore = useUserStore()
    userStore.userInfo = { ...userA }
    userStore.clearActiveIdentity()
    expect(() => userStore.clearActiveIdentity()).not.toThrow()
    expect(userStore.userInfo).toBeUndefined()
  })

  it('迟到旧 user-detail 不复活已清理身份', async () => {
    const userStore = useUserStore()
    userStore.userInfo = { ...userA }
    let resolveDetail!: (v: any) => void
    getUserDetailMock.mockReturnValue(new Promise((resolve) => (resolveDetail = resolve)))

    userStore.getUserDetailAction()
    // 在途期间退出并清理
    userStore.clearActiveIdentity()
    resolveDetail({ uid: 'A-1', name: 'stale' })
    await vi.waitFor(() => expect(getUserDetailMock).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))

    expect(userStore.userInfo).toBeUndefined()
    expect(readStoredActiveUid()).toBe('')
  })

  it('切号后旧 userInfoChange 不写入新作用域', async () => {
    const userStore = useUserStore()
    userStore.userInfo = { ...userA }
    let resolveUsers!: (v: any) => void
    getUserByIdsMock.mockReturnValue(new Promise((resolve) => (resolveUsers = resolve)))

    const pending = handleUserInfoChange({ uid: 'A-1', changeType: 'profile' })
    // 在途期间切到 B
    userStore.userInfo = { uid: 'B-2', account: 'b2', name: 'B' } as any
    resolveUsers([{ uid: 'A-1', name: 'stale-A' }])
    await pending

    expect((userStore.userInfo as any)?.uid).toBe('B-2')
    expect((userStore.userInfo as any)?.name).toBe('B')
  })

  it('退出后 userInfoChange 旧帧直接丢弃', async () => {
    const userStore = useUserStore()
    userStore.userInfo = { ...userA }
    userStore.clearActiveIdentity()
    getUserByIdsMock.mockResolvedValue([{ uid: 'A-1', name: 'stale' }])

    await handleUserInfoChange({ uid: 'A-1', changeType: 'profile' })

    expect(userStore.userInfo).toBeUndefined()
    expect(getUserByIdsMock).not.toHaveBeenCalled()
  })
})
