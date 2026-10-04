import { beforeEach, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), unlisten: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: any[]) => native.invoke(...args) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: (...args: any[]) => native.listen(...args) }))
vi.mock('@/utils/PlatformConstants', () => ({ isWeb: () => false }))
beforeEach(() => {
  vi.resetModules()
  native.invoke.mockReset()
  native.listen.mockReset()
  native.unlisten.mockReset()
})
it('closes readiness query/listen race and releases only its listener', async () => {
  native.invoke.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  native.listen.mockResolvedValue(native.unlisten)
  const { ensureAppStateReady } = await import('@/utils/AppStateReady')
  await ensureAppStateReady()
  expect(native.invoke).toHaveBeenCalledTimes(2)
  expect(native.unlisten).toHaveBeenCalledTimes(1)
})
it('native readiness appearing after a missed event still releases startup', async () => {
  vi.useFakeTimers()
  try {
    native.invoke.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true)
    native.listen.mockResolvedValue(native.unlisten)
    const { ensureAppStateReady } = await import('@/utils/AppStateReady')
    let completed = false
    const pending = ensureAppStateReady().then(() => {
      completed = true
    })
    await vi.advanceTimersByTimeAsync(200)
    expect(completed).toBe(true)
    await pending
    expect(native.unlisten).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

it('listener failure is not readiness success; next request may retry', async () => {
  native.invoke.mockResolvedValue(false)
  native.listen.mockRejectedValueOnce(new Error('fixture listener failure')).mockResolvedValue(native.unlisten)
  const { ensureAppStateReady } = await import('@/utils/AppStateReady')
  await expect(ensureAppStateReady()).rejects.toThrow('fixture listener failure')
  native.invoke.mockResolvedValue(true)
  await ensureAppStateReady()
})
