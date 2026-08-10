import { createPinia, defineStore, setActivePinia } from 'pinia'
import { PiniaSharedState } from 'pinia-shared-state'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, reactive, ref } from 'vue'

/**
 * aichatoverview#239（REQ-019）探针固化 spec —— 本仓真实安装的 pinia 3.x +
 * pinia-shared-state 1.0.1 + pinia-plugin-persistedstate 4.x，双 pinia 同频道
 * （broadcast-channel 'simulate'，单进程内存投递）复现跨窗机制，固化 #230 审计
 * 与 #237 终裁的事实基础（comment 5235420756 实证复跑）：
 *
 *   P1 ref 键收包写穿：$patch 整键替换经容器 set 写穿 ref.value → 读面可见（Tier1 活同步落地的机制）
 *   P2 reactive 键孤儿树：$patch 只换 $state 容器节点，闭包原对象成孤儿 → 读面不可见（A 类必须 ref 化的原因）
 *   P3 Map/Set 序列化恒 {}：广播载荷/persistedstate 快照均丢数据（B 类必须 omit + 事件的原因）
 *   P4 hydrate→receive 序列：建店当 tick 同步水合 persistedstate 快照（Tier3），
 *      随后收包活态覆盖 ref 键（Tier1）；reactive 键永远停在快照值
 *
 * 注意：vitest 无 app.use(pinia) 时 pinia.use() 进 toBeInstalled 不生效
 * （pinia.mjs:1013 只有 _a 存在才 push _p）——必须 createApp({}).use(pinia) flush。
 */

function piniaWithPlugins(...plugins: Parameters<ReturnType<typeof createPinia>['use']>[0][]) {
  const pinia = createPinia()
  plugins.forEach((p) => pinia.use(p))
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return pinia
}

const STORE_ID = 'probe239'

/** 与 5 脆弱 store 同形态的探针 store：ref 普通对象键 + reactive 普通对象键 + reactive Map 键 */
const makeProbeStore = () =>
  defineStore(
    STORE_ID,
    () => {
      const refKey = ref({ list: ['init'] })
      const reactiveKey = reactive({ list: ['init'] })
      const mapKey = reactive(new Map<string, string>())
      return { refKey, reactiveKey, mapKey }
    },
    { share: { enable: true, initialize: true, omit: ['mapKey'] }, persist: true }
  )

describe('#239 探针固化：pinia-shared-state 跨窗机制事实基础', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('P3 Map/Set 序列化恒 {}（传输层即丢数据，与形态无关）', () => {
    expect(JSON.stringify(new Map([['k', 'v']]))).toBe('{}')
    expect(JSON.stringify(new Set([1]))).toBe('{}')
    // 嵌在状态树里同样丢
    expect(JSON.stringify({ mapKey: new Map([['k', 'v']]) })).toBe('{"mapKey":{}}')
  })

  it('P1+P2+P4 hydrate→receive 全序列：ref 写穿活同步落地 / reactive 孤儿树停在快照', async () => {
    // ---------- 主窗 pinia：活态 ----------
    piniaWithPlugins(
      createPersistedState({ auto: true }),
      PiniaSharedState({ enable: false, initialize: false, type: 'simulate' as never })
    )
    const mainStore = makeProbeStore()()
    mainStore.refKey = { list: ['live'] }
    // 等外播 + 持久化完成
    await vi.waitFor(() => expect(localStorage.getItem(STORE_ID)).toContain('live'))

    // ---------- 人为把快照拨旧（模拟主窗持久态落后于活态）----------
    localStorage.setItem(
      STORE_ID,
      JSON.stringify({ refKey: { list: ['stale-snapshot'] }, reactiveKey: { list: ['stale-snapshot'] } })
    )

    // ---------- 新窗 pinia：同频道（频道名 = $id）----------
    piniaWithPlugins(
      createPersistedState({ auto: true }),
      PiniaSharedState({ enable: false, initialize: false, type: 'simulate' as never })
    )
    const auxStore = makeProbeStore()()

    // P4a：建店当 tick 已同步水合 persistedstate 快照（Tier3 开窗快照——hydrate 是同步 $patch）
    expect(auxStore.refKey).toEqual({ list: ['stale-snapshot'] })
    expect(auxStore.reactiveKey).toEqual({ list: ['stale-snapshot'] })

    // P1：收包后 ref 键写穿——活同步真正落地（Tier1）
    await vi.waitFor(() => expect(auxStore.refKey).toEqual({ list: ['live'] }), { timeout: 3000 })

    // P2：reactive 键孤儿树——收包整键替换只写 $state 容器节点，闭包原对象读面不可见。
    // 判据用「收到包」做同步点：refKey 已变 live 即收包已发生，此时 reactiveKey 仍停在水合值。
    expect(auxStore.reactiveKey).toEqual({ list: ['stale-snapshot'] })
    // 且收包数据只落在没人读的 $state 副本上（主窗 reactiveKey 从未写过，是 init）
    expect(auxStore.$state.reactiveKey).toEqual({ list: ['init'] })
    // 全仓无任何代码读 $state（#230 审计 grep 实证）→ reactive 键收包对所有读路径不可见
  })
})
