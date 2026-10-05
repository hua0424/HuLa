import { createPinia, defineStore } from 'pinia'
import { createApp, reactive, ref } from 'vue'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoresEnum } from '@/enums'

const runtime = vi.hoisted(() => ({
  label: 'home',
  epoch: 100,
  backend: 'http://a/api',
  uid: '4',
  listener: undefined as ((event: any) => void) | undefined
}))
vi.mock('@/utils/PlatformConstants', () => ({ isWeb: () => false }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: runtime.label }) }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async () => ({
    sessionEpoch: runtime.epoch,
    binding: { backendKey: runtime.backend, uid: runtime.uid, sessionEpoch: runtime.epoch }
  })
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_name: string, callback: (event: any) => void) => {
    runtime.listener = callback
    return () => {}
  }
}))
import { scopedChatStorage } from '@/stores/persistHomeWindowOnly'
import { initializeSessionBinding, sessionBinding } from '@/services/sessionBinding'
import { scopedSharedState } from '@/stores/scopedSharedState'

class TestChannel {
  static instances: TestChannel[] = []
  onmessage?: (event: any) => void
  postMessage = vi.fn()
  close = vi.fn()
  constructor(readonly name: string) {
    TestChannel.instances.push(this)
  }
}
const makeStore = () => {
  const pinia = createPinia().use(scopedSharedState).use(createPersistedState())
  createApp({ render: () => null }).use(pinia)
  const useStore = defineStore(
    StoresEnum.CHAT,
    () => {
      const sessionList = ref<string[]>([])
      const thinkingStreams = reactive(new Map<string, string>())
      const optional = ref<string>()
      return { sessionList, thinkingStreams, optional }
    },
    {
      share: { enable: true, initialize: true, omit: ['thinkingStreams'] },
      persist: { storage: scopedChatStorage(), pick: ['sessionList'] }
    }
  )
  return useStore(pinia)
}
const key = () => `${StoresEnum.CHAT}:${JSON.stringify([runtime.backend, runtime.uid])}`
const stores: Array<ReturnType<typeof makeStore>> = []
const open = () => {
  const store = makeStore()
  stores.push(store)
  return store
}
beforeEach(async () => {
  vi.stubGlobal('BroadcastChannel', TestChannel)
  Object.assign(window, { __TAURI_INTERNALS__: {} })
  TestChannel.instances = []
  localStorage.clear()
  runtime.label = 'home'
  runtime.backend = 'http://a/api'
  runtime.uid = '4'
  runtime.epoch++
  await initializeSessionBinding()
})
afterEach(() => {
  for (const store of stores.splice(0)) store.$dispose()
  vi.unstubAllGlobals()
})

describe('#348 three-tier scoped snapshots', () => {
  it('preserves unknown raw snapshots, uses cold scope, and permits only main-window writes', () => {
    localStorage.setItem(StoresEnum.CHAT, JSON.stringify({ sessionList: ['unknown-backend'] }))
    const home = open()
    expect(home.sessionList).toEqual([])
    home.sessionList.push('scope-a')
    home.$persist()
    expect(localStorage.getItem(StoresEnum.CHAT)).toContain('unknown-backend')
    expect(localStorage.getItem(key())).toContain('scope-a')
    runtime.label = 'modal-invite'
    const aux = open()
    expect(aux.sessionList).toEqual(['scope-a'])
    aux.sessionList.push('aux-poison')
    aux.$persist()
    expect(localStorage.getItem(key())).not.toContain('aux-poison')
  })

  it('auxiliary Tier1 accepts same binding only; Map/Set stays Tier2 and old queued frames cannot cross relogin/backend', async () => {
    runtime.label = 'modal-invite'
    const aux = open()
    aux.thinkingStreams.set('native', 'tier2')
    const channel = TestChannel.instances[0]
    const origin = { ...sessionBinding.value! }
    channel.onmessage!({
      data: { binding: origin, state: { sessionList: ['live'], thinkingStreams: {}, optional: 'active' } }
    })
    expect(aux.sessionList).toEqual(['live'])
    expect(aux.thinkingStreams.get('native')).toBe('tier2')
    runtime.epoch++
    await initializeSessionBinding()
    expect(aux.sessionList).toEqual([])
    expect(aux.optional).toBeUndefined()
    channel.onmessage!({ data: { binding: origin, state: { sessionList: ['old-epoch'] } } })
    expect(aux.sessionList).toEqual([])
    runtime.backend = 'http://b/api'
    runtime.epoch++
    await initializeSessionBinding()
    channel.onmessage!({ data: { binding: origin, state: { sessionList: ['old-backend'] } } })
    expect(aux.sessionList).toEqual([])
    expect(channel.postMessage).toHaveBeenCalledWith({ binding: sessionBinding.value })
  })

  it('main ignores auxiliary writes and provides current snapshot on a bound request', () => {
    const home = open()
    home.sessionList.push('authoritative')
    const channel = TestChannel.instances[0]
    channel.onmessage!({ data: { binding: sessionBinding.value, state: { sessionList: ['poison'] } } })
    expect(home.sessionList).toEqual(['authoritative'])
    channel.onmessage!({ data: { binding: sessionBinding.value } })
    expect(channel.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        binding: sessionBinding.value,
        state: expect.objectContaining({ sessionList: ['authoritative'] })
      })
    )
  })
})
