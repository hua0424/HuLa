import { defineStore } from 'pinia'
import { StoresEnum } from '@/enums'
import type { UserInfoType } from '@/services/types'
import { getUserDetail } from '@/utils/ImRequestUtils'
import * as PathUtil from '@/utils/PathUtil'
import { isSessionCurrent, sessionBinding } from '@/services/sessionBinding'
import { isWeb } from '@/utils/PlatformConstants'
import { useGlobalStore } from './global'

/** aichatoverview#395：活跃身份在持久化中的键（pinia-plugin-persistedstate auto:true 按 store id 落盘）。 */
export const ACTIVE_IDENTITY_STORAGE_KEY = 'user'

export const readStoredActiveUid = (): string => {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTIVE_IDENTITY_STORAGE_KEY) ?? 'null')
    const uid = parsed?.userInfo?.uid
    return uid ? String(uid) : ''
  } catch {
    return ''
  }
}

export const useUserStore = defineStore(
  StoresEnum.USER,
  () => {
    const userInfo = ref<UserInfoType>()
    const globalStore = useGlobalStore()

    /**
     * aichatoverview#395：共享活跃身份清理——清 live userInfo 及其当前持久化。
     * 只处理活跃身份：保留 loginHistory、各账号 SQLite/思考缓存/阅读位置，不做 localStorage.clear。
     * 失败抛错（调用方按“本地清理失败”报告，不把路由跳转等同成功）。
     */
    const clearActiveIdentity = () => {
      const beforeUid = userInfo.value?.uid ? String(userInfo.value.uid) : readStoredActiveUid()
      userInfo.value = undefined
      try {
        localStorage.removeItem(ACTIVE_IDENTITY_STORAGE_KEY)
        localStorage.removeItem('__pendingHistoryPassword')
      } catch (error) {
        throw new Error(
          `活跃身份清理失败${beforeUid ? `(uid=${beforeUid})` : ''}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      const after = userInfo.value as unknown as UserInfoType | undefined
      const liveUid = after?.uid ? String(after.uid) : ''
      const storedUid = readStoredActiveUid()
      if (liveUid || storedUid) {
        throw new Error(
          `活跃身份清理失败${beforeUid ? `(uid=${beforeUid})` : ''}: 残留 live=${liveUid || '-'} stored=${storedUid || '-'}`
        )
      }
    }

    const getUserDetailAction = () => {
      const origin = sessionBinding.value
      const startUid = userInfo.value?.uid ? String(userInfo.value.uid) : ''
      getUserDetail()
        .then((res: any) => {
          // aichatoverview#395：迟到旧账号响应不得复活已清理身份或写入新作用域。
          if (!startUid) return
          if (!isWeb() && origin && !isSessionCurrent(origin)) return
          if ((userInfo.value?.uid ? String(userInfo.value.uid) : '') !== startUid) return
          if (res?.uid && String(res.uid) !== startUid) return
          userInfo.value = { ...userInfo.value, ...res }
        })
        .catch((e) => {
          console.error('获取用户详情失败:', e)
        })
    }

    const isMe = computed(() => (id: string) => {
      return userInfo.value?.uid === id
    })

    const getUserRoomDir = async () => {
      return await PathUtil.getUserVideosDir(userInfo.value!.uid, globalStore.currentSessionRoomId)
    }

    const getUserRoomAbsoluteDir = async () => {
      return await PathUtil.getUserAbsoluteVideosDir(userInfo.value!.uid, globalStore.currentSessionRoomId)
    }

    return { userInfo, clearActiveIdentity, getUserDetailAction, isMe, getUserRoomDir, getUserRoomAbsoluteDir }
  },
  {
    share: {
      enable: true,
      initialize: true
    }
  }
)
