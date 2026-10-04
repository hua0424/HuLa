import { createPersistedState } from 'pinia-plugin-persistedstate'
import { PiniaSharedState } from 'pinia-shared-state' // 标签页共享存储状态
import { scopedSharedState, usesScopedSharing } from '@/stores/scopedSharedState'

const legacySharing = PiniaSharedState({ enable: false, initialize: false, type: 'native' })

export const pinia = createPinia()
// 默认开启持久化存储
pinia
  .use(scopedSharedState)
  .use(
    createPersistedState({
      auto: true
    })
  )
  .use((context) => {
    if (!usesScopedSharing(context.store.$id)) legacySharing(context)
  })
