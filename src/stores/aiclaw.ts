import { defineStore } from 'pinia'
import { StoresEnum } from '@/enums'
import { ImUrlEnum } from '@/enums'
import { imRequestSilent } from '@/utils/ImRequestUtils'

/**
 * REQ-005 #59：当前用户拥有的 aiclaw 归属缓存。
 *
 * 由于右键菜单的 `visible` 是同步谓词，无法在其中发 HTTP，
 * 故在打开群会话时预取「我的 aiclaw」uid 集合，右键时同步判断。
 */
export const useAiclawStore = defineStore(StoresEnum.AICLAW, () => {
  /** 请求世代号；invalidate 会递增，用于丢弃过期的在途请求结果 */
  let generation = 0
  /** 是否已完成至少一次成功加载 */
  const loaded = ref(false)
  /** 是否已被标记为失效（下次 ensureLoaded 需要重新拉取） */
  const invalidated = ref(false)
  /** 是否正在请求中，防止并发重复请求 */
  const loading = ref(false)
  /** 当前用户拥有的 aiclaw uid 集合（统一用 String 归一） */
  const myAiclawUids = ref<Set<string>>(new Set())

  /**
   * 幂等地预取当前用户的 aiclaw 列表。
   * - 已加载且未失效时不重复请求。
   * - 请求失败时静默降级，不影响现有状态，下次调用会重试。
   * - 使用 generation 守卫，确保被 invalidate 后的在途响应不会污染缓存。
   */
  const ensureLoaded = async () => {
    if (loaded.value && !invalidated.value) {
      return
    }
    if (loading.value) {
      return
    }

    const callGen = ++generation
    loading.value = true
    try {
      const list = await imRequestSilent<Array<{ uid: string | number }>>({
        url: ImUrlEnum.AICLAW_LIST
      })
      // 若此期间发生过 invalidate，则丢弃过期结果
      if (callGen !== generation) {
        return
      }
      myAiclawUids.value = new Set((list || []).map((item) => String(item.uid)))
      loaded.value = true
      invalidated.value = false
    } catch {
      // 静默失败：保持未加载状态，下次右键前可再试
      if (callGen !== generation) {
        return
      }
    } finally {
      // 只有当前世代的请求才能解除 loading，避免旧请求覆盖 invalidate 后的状态
      if (callGen === generation) {
        loading.value = false
      }
    }
  }

  /**
   * 同步判断目标 uid 是否为当前用户拥有的 aiclaw。
   * 未就绪时安全降级为 false（菜单项不出现）。
   *
   * @param uid 目标用户 uid（支持 string / number / undefined / null）
   */
  const isMyAiclaw = (uid: string | number | undefined | null): boolean => {
    if (!uid || !loaded.value) {
      return false
    }
    return myAiclawUids.value.has(String(uid))
  }

  /** 使缓存失效，下次 ensureLoaded() 会重新拉取 */
  const invalidate = () => {
    generation++
    loaded.value = false
    invalidated.value = true
    myAiclawUids.value.clear()
    loading.value = false
  }

  return {
    loaded,
    loading,
    myAiclawUids,
    ensureLoaded,
    isMyAiclaw,
    invalidate
  }
})
