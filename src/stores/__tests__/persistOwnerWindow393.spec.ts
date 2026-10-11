import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#393 逻辑聊天主窗判定：桌面 home 与移动 mobile-home 同为
 * 合法已认证主写者；桌面其他窗口（辅窗）仍只读；web 保持现状。
 */

const label = vi.hoisted(() => ({ current: 'home' }))
const getCurrentWindowMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: (...args: unknown[]) => getCurrentWindowMock(...args)
}))
const isWebMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/PlatformConstants', () => ({ isWeb: (...args: unknown[]) => isWebMock(...args) }))

import { homeWindowOnlyStorage, isChatHomeWindow } from '@/stores/persistHomeWindowOnly'

describe('#393 逻辑聊天主窗 owner 判定', () => {
  beforeEach(() => {
    getCurrentWindowMock.mockReset().mockImplementation(() => ({ label: label.current }))
    isWebMock.mockReset()
    label.current = 'home'
  })

  it('桌面 home 仍是主写者', () => {
    isWebMock.mockReturnValue(false)
    label.current = 'home'
    expect(isChatHomeWindow()).toBe(true)
    expect(homeWindowOnlyStorage()).toBe(window.localStorage)
  })

  it('移动 mobile-home 是合法主写者：判定 true 且可写真 localStorage', () => {
    isWebMock.mockReturnValue(false)
    label.current = 'mobile-home'
    expect(isChatHomeWindow()).toBe(true)
    const storage = homeWindowOnlyStorage()
    expect(storage).toBe(window.localStorage)
    storage.setItem('mobile-owner-probe', 'writable')
    expect(localStorage.getItem('mobile-owner-probe')).toBe('writable')
    localStorage.removeItem('mobile-owner-probe')
  })

  it('桌面辅窗仍只读：判定 false，写入 noop 不污染主窗持久态', () => {
    isWebMock.mockReturnValue(false)
    label.current = 'chat-aux'
    expect(isChatHomeWindow()).toBe(false)
    const storage = homeWindowOnlyStorage()
    expect(storage).not.toBe(window.localStorage)
    localStorage.setItem('aux-probe', 'snapshot')
    storage.setItem('aux-probe', 'poisoned')
    expect(localStorage.getItem('aux-probe')).toBe('snapshot')
    localStorage.removeItem('aux-probe')
  })

  it('web 单页保持现状：不读窗口 label', () => {
    isWebMock.mockReturnValue(true)
    expect(isChatHomeWindow()).toBe(true)
    expect(homeWindowOnlyStorage()).toBe(window.localStorage)
    expect(getCurrentWindowMock).not.toHaveBeenCalled()
  })
})
