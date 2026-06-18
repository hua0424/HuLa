import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/ImRequestUtils', () => ({
  imRequestSilent: vi.fn()
}))

import { useAiclawStore } from '@/stores/aiclaw'
import { imRequestSilent } from '@/utils/ImRequestUtils'

const mockImRequestSilent = vi.mocked(imRequestSilent)

describe('useAiclawStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockImRequestSilent.mockReset()
  })

  it('未就绪时 isMyAiclaw 安全降级为 false', () => {
    const store = useAiclawStore()
    expect(store.isMyAiclaw('1001')).toBe(false)
    expect(store.isMyAiclaw(1001)).toBe(false)
    expect(store.isMyAiclaw(undefined)).toBe(false)
    expect(store.isMyAiclaw(null)).toBe(false)
  })

  it('ensureLoaded 加载成功后，可同步判断归属', async () => {
    mockImRequestSilent.mockResolvedValue([{ uid: '1001' }, { uid: 1002 }])
    const store = useAiclawStore()

    await store.ensureLoaded()

    expect(store.isMyAiclaw('1001')).toBe(true)
    expect(store.isMyAiclaw(1001)).toBe(true)
    expect(store.isMyAiclaw('1002')).toBe(true)
    expect(store.isMyAiclaw(1002)).toBe(true)
    expect(store.isMyAiclaw('1003')).toBe(false)
    expect(store.loaded).toBe(true)
  })

  it('ensureLoaded 是幂等的：已加载且未失效时不重复请求', async () => {
    mockImRequestSilent.mockResolvedValue([{ uid: '1001' }])
    const store = useAiclawStore()

    await store.ensureLoaded()
    await store.ensureLoaded()
    await store.ensureLoaded()

    expect(mockImRequestSilent).toHaveBeenCalledTimes(1)
  })

  it('invalidate 后再次 ensureLoaded 会重新拉取', async () => {
    mockImRequestSilent.mockResolvedValueOnce([{ uid: '1001' }]).mockResolvedValueOnce([{ uid: '1002' }])
    const store = useAiclawStore()

    await store.ensureLoaded()
    expect(store.isMyAiclaw('1001')).toBe(true)

    store.invalidate()
    expect(store.loaded).toBe(false)
    expect(store.isMyAiclaw('1001')).toBe(false)

    await store.ensureLoaded()
    expect(store.isMyAiclaw('1002')).toBe(true)
    expect(mockImRequestSilent).toHaveBeenCalledTimes(2)
  })

  it('预取失败时静默降级，不抛错，且下次仍可重试', async () => {
    mockImRequestSilent.mockRejectedValueOnce(new Error('network error'))
    const store = useAiclawStore()

    await expect(store.ensureLoaded()).resolves.toBeUndefined()
    expect(store.loaded).toBe(false)
    expect(store.isMyAiclaw('1001')).toBe(false)

    mockImRequestSilent.mockResolvedValueOnce([{ uid: '1001' }])
    await store.ensureLoaded()
    expect(store.isMyAiclaw('1001')).toBe(true)
    expect(mockImRequestSilent).toHaveBeenCalledTimes(2)
  })

  it('并发调用 ensureLoaded 只发一次请求', async () => {
    let resolveRequest!: (value: Array<{ uid: string }>) => void
    const requestPromise = new Promise<Array<{ uid: string }>>((resolve) => {
      resolveRequest = resolve
    })
    mockImRequestSilent.mockReturnValueOnce(requestPromise)

    const store = useAiclawStore()
    const p1 = store.ensureLoaded()
    const p2 = store.ensureLoaded()
    const p3 = store.ensureLoaded()

    resolveRequest([{ uid: '1001' }])
    await Promise.all([p1, p2, p3])

    expect(mockImRequestSilent).toHaveBeenCalledTimes(1)
    expect(store.isMyAiclaw('1001')).toBe(true)
  })
})
