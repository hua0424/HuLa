import type { PiniaPluginContext } from 'pinia'
import { watch } from 'vue'
import { StoresEnum } from '@/enums'
import { isWeb } from '@/utils/PlatformConstants'
import { isChatHomeWindow } from '@/stores/persistHomeWindowOnly'
import { isSessionCurrent, sessionBinding, type SessionIdentity } from '@/services/sessionBinding'

const scopedStores = new Set<string>([
  StoresEnum.CHAT,
  StoresEnum.GROUP,
  StoresEnum.FEED,
  StoresEnum.GLOBAL,
  StoresEnum.FILE
])
export const usesScopedSharing = (id: string) => !isWeb() && scopedStores.has(id)
type Frame = { binding: SessionIdentity; state?: Record<string, unknown> }

/** Tier1 keeps ordinary keys live; Tier2 Map/Set events and Tier3 read-only hydrate remain separate. */
export const scopedSharedState = ({ store, options }: PiniaPluginContext) => {
  if (!usesScopedSharing(store.$id)) return
  const omitted = new Set(options.share?.omit ?? [])
  const keys = Object.keys(store.$state).filter((key) => !omitted.has(key))
  const initial = JSON.parse(JSON.stringify(store.$state))
  const home = isChatHomeWindow()
  const channel = new BroadcastChannel(`aichat-scoped:${store.$id}`)
  let receiving = false
  const publish = () => {
    const binding = sessionBinding.value
    if (!binding) return
    channel.postMessage({ binding, ...(home ? { state: JSON.parse(JSON.stringify(store.$state)) } : {}) })
  }
  channel.onmessage = ({ data }: MessageEvent<Frame>) => {
    if (!data?.binding || !isSessionCurrent(data.binding)) return
    if (home) {
      if (!data.state) publish()
      return
    }
    if (!data.state) return
    receiving = true
    try {
      store.$patch((state) => {
        for (const key of keys) if (Object.hasOwn(data.state!, key)) state[key] = data.state![key]
      })
    } finally {
      receiving = false
    }
  }
  const unsubscribe = store.$subscribe(
    () => {
      if (home && !receiving) publish()
    },
    { flush: 'sync', detached: true }
  )
  const stop = watch(
    sessionBinding,
    () => {
      receiving = true
      try {
        const blank = JSON.parse(JSON.stringify(initial))
        store.$patch((state) => {
          for (const key of keys) state[key] = blank[key]
        })
        if (sessionBinding.value && (!home || store.$id !== StoresEnum.CHAT)) store.$hydrate?.()
      } finally {
        receiving = false
      }
      publish()
    },
    { flush: 'sync' }
  )
  if (!home) publish()
  const dispose = store.$dispose.bind(store)
  store.$dispose = () => {
    unsubscribe()
    stop()
    channel.close()
    dispose()
  }
}
