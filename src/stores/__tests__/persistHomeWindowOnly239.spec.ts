import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * aichatoverview#239（REQ-019）主窗持久化 storage 判定：
 * 5 脆弱 store 只让 home 主窗持久化（#237 终裁第 4 条），
 * 辅窗只读（读快照 hydrate 不变、写入 noop 防毒化），web 保持现状。
 */

const getCurrentWindowMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: (...args: unknown[]) => getCurrentWindowMock(...args)
}))
const isWebMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/PlatformConstants', () => ({ isWeb: (...args: unknown[]) => isWebMock(...args) }))

import { homeWindowOnlyStorage } from '@/stores/persistHomeWindowOnly'

describe('#239 homeWindowOnlyStorage 主窗持久化判定', () => {
  beforeEach(() => {
    getCurrentWindowMock.mockReset()
    isWebMock.mockReset()
  })

  it('web：无论窗口 label 如何都用真 localStorage（现状不变）', () => {
    isWebMock.mockReturnValue(true)
    expect(homeWindowOnlyStorage()).toBe(window.localStorage)
    expect(getCurrentWindowMock).not.toHaveBeenCalled()
  })

  it('桌面 home 主窗：用真 localStorage', () => {
    isWebMock.mockReturnValue(false)
    getCurrentWindowMock.mockReturnValue({ label: 'home' })
    expect(homeWindowOnlyStorage()).toBe(window.localStorage)
  })

  it('桌面辅窗（如 modal-invite）：只读 storage——读快照 hydrate 不变、写入 noop', () => {
    isWebMock.mockReturnValue(false)
    getCurrentWindowMock.mockReturnValue({ label: 'modal-invite' })
    const storage = homeWindowOnlyStorage()
    expect(storage).not.toBe(window.localStorage)
    // 读：透传真 localStorage（Tier3 开窗快照 hydrate 保持现状，
    // PR2 ref 化前 reactive 键的辅窗数据全靠它——只写不读会造成过渡空窗回归）
    localStorage.setItem('k', 'snapshot')
    expect(storage.getItem('k')).toBe('snapshot')
    // 写：noop（不再覆盖主窗持久态，last-writer-wins 毒化链断掉）
    storage.setItem('k', 'poisoned')
    expect(localStorage.getItem('k')).toBe('snapshot')
  })

  it('无 Tauri 运行时（getCurrentWindow 抛错）：退化 localStorage，宁多勿缺', () => {
    isWebMock.mockReturnValue(false)
    getCurrentWindowMock.mockImplementation(() => {
      throw new Error('no tauri')
    })
    expect(homeWindowOnlyStorage()).toBe(window.localStorage)
  })
})
