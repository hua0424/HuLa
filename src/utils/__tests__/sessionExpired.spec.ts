import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-017 #198：WS_AUTH_FAILED（4001 + refresh 失败 / web 直连 4001）后的跳登录重鉴流程。
 * 桌面端：先递交 sessionExpired 载荷给登录窗（登录窗弹「登录状态已失效」），再走标准登出序列；
 * 移动/web：重置登录态 → 登出 → 跳登录页（移动端附弹窗）。重入安全：并发触发只执行一次。
 */

const platform = vi.hoisted(() => ({ isMobile: false, isWeb: false }))
vi.mock('@/utils/PlatformConstants', () => ({
  isMobile: () => platform.isMobile,
  isWeb: () => platform.isWeb,
  isDesktop: () => !platform.isMobile && !platform.isWeb
}))

const loginMocks = vi.hoisted(() => ({
  resetLoginState: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/hooks/useLogin', () => ({
  useLogin: () => loginMocks
}))

const settingStoreMock = vi.hoisted(() => ({
  toggleLogin: vi.fn(),
  login: { autoLogin: false }
}))
vi.mock('@/stores/setting', () => ({
  useSettingStore: () => settingStoreMock
}))

const routerReplaceMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/router', () => ({
  default: { replace: routerReplaceMock }
}))

const sendWindowPayloadMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/hooks/useWindow.ts', () => ({
  useWindow: () => ({ sendWindowPayload: sendWindowPayloadMock })
}))

const imLogoutMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/utils/ImRequestUtils', () => ({
  logout: imLogoutMock
}))

const showDialogMock = vi.hoisted(() => vi.fn())
vi.mock('vant', () => ({ showDialog: showDialogMock }))
vi.mock('vant/es/dialog/style', () => ({}))

import { handleSessionExpired } from '@/utils/sessionExpired'

describe('handleSessionExpired（REQ-017 #198 跳登录重鉴）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    platform.isMobile = false
    platform.isWeb = false
  })

  it('桌面端：先递交 sessionExpired 载荷给登录窗，再走 logout → resetLoginState → logout 序列', async () => {
    await handleSessionExpired()

    expect(sendWindowPayloadMock).toHaveBeenCalledWith(
      'login',
      expect.objectContaining({ sessionExpired: expect.objectContaining({ timestamp: expect.any(Number) }) })
    )
    expect(imLogoutMock).toHaveBeenCalledWith({ autoLogin: false })
    expect(loginMocks.resetLoginState).toHaveBeenCalled()
    expect(loginMocks.logout).toHaveBeenCalled()
    // 桌面端不走路由跳转（登录窗由 logout 拉起）
    expect(routerReplaceMock).not.toHaveBeenCalled()
    // 载荷必须先于登出序列递交（登录窗 mount 时读取 pending payload 弹失效提示）
    const payloadOrder = sendWindowPayloadMock.mock.invocationCallOrder[0]
    const logoutOrder = imLogoutMock.mock.invocationCallOrder[0]
    expect(payloadOrder).toBeLessThan(logoutOrder)
  })

  it('移动端：重置登录态 → 登出 → 关自动登录 → 跳登录页 → 弹「登录状态已失效」', async () => {
    platform.isMobile = true

    await handleSessionExpired()

    expect(loginMocks.resetLoginState).toHaveBeenCalled()
    expect(loginMocks.logout).toHaveBeenCalled()
    expect(settingStoreMock.toggleLogin).toHaveBeenCalledWith(false, false)
    expect(routerReplaceMock).toHaveBeenCalledWith('/mobile/login')
    expect(showDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('登录状态已失效') })
    )
    expect(sendWindowPayloadMock).not.toHaveBeenCalled()
  })

  it('web 端：跳登录页但不弹 vant 弹窗', async () => {
    platform.isWeb = true

    await handleSessionExpired()

    expect(routerReplaceMock).toHaveBeenCalledWith('/mobile/login')
    expect(showDialogMock).not.toHaveBeenCalled()
    expect(sendWindowPayloadMock).not.toHaveBeenCalled()
  })

  it('重入安全：并发两次触发只执行一次登出序列', async () => {
    await Promise.all([handleSessionExpired(), handleSessionExpired()])

    expect(loginMocks.logout).toHaveBeenCalledTimes(1)
    expect(loginMocks.resetLoginState).toHaveBeenCalledTimes(1)
  })
})
