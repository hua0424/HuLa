import { getCurrentWindow } from '@tauri-apps/api/window'
import type { StorageLike } from 'pinia-plugin-persistedstate'
import { isWeb } from '@/utils/PlatformConstants'

/**
 * aichatoverview#239（REQ-019）主窗持久化——#230 审计 §1 伴生隐患的收口：
 * persistedstate auto:true 下多窗各自在 $subscribe 时整店写 localStorage，
 * last-writer-wins 互相覆盖——被 pinia-shared-state 收包毒化的窗口会用陈旧快照
 * 覆盖主窗的新鲜持久态，导致后开的窗 hydrate 到更旧的数据（快照倒退）。
 *
 * 裁决（#237 终裁第 4 条）：5 个脆弱 store（chat/group/feed/global/file）只让
 * home 主窗持久化。辅窗 storage = **只读**：getItem 走真 localStorage
 * （Tier3 开窗快照 hydrate 保持现状——PR2 ref 化前 reactive 键的辅窗数据全靠它；
 * 只写不读会造成 PR1→PR2 之间辅窗列表空窗的过渡回归），setItem noop
 * （不写即不再覆盖主窗持久态，last-writer-wins 毒化链断掉）。
 * web 单页无多窗问题，保持现状（no-op 判定）。13 个免疫 store 不动。
 *
 * 注意：在 store 定义（模块求值）时调用一次即可——同一窗口上下文内 label 恒定。
 */

/** 辅窗只读 storage：读快照（hydrate 现状不变）不写（防覆盖主窗持久态） */
const readOnlyStorage: StorageLike = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: () => {}
}

export const homeWindowOnlyStorage = (): StorageLike => {
  // web 单页无多窗问题，保持现状
  if (isWeb()) return window.localStorage
  try {
    // 桌面端：home 主窗读写，辅窗只读
    return getCurrentWindow().label === 'home' ? window.localStorage : readOnlyStorage
  } catch {
    // 无 Tauri 运行时（单测等）：退化为现状（持久化开启），宁多勿缺
    return window.localStorage
  }
}
