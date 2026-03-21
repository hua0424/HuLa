import { UserType, type OnlineEnum } from '@/enums'
import { useGroupStore } from '@/stores/group'

/**
 * 判断指定用户是否为 AI 助理（aiclaw）
 * 通过 groupStore 缓存的用户信息中的 userType 字段判断
 */
export const isAiclawUser = (uid: string): boolean => {
  const groupStore = useGroupStore()
  const userInfo = groupStore.getUserInfo(uid)
  return userInfo?.userType === UserType.AICLAW
}

/**
 * 通过好友列表的 userType 字段判断是否为 AI 助理
 */
export const isAiclawByUserType = (userType?: number): boolean => {
  return userType === 4
}

/** AI 助理在线三态 */
export type AiclawStatus = 'inactive' | 'online' | 'offline'

/**
 * 获取 AI 助理的三态在线状态
 * - inactive：authStatus=0（未激活，从未通过 activate 命令连接）
 * - online：activeStatus === ONLINE（plugins 已连接）
 * - offline：已激活但当前离线
 *
 * 注意：好友列表没有 authStatus 字段，无法区分"未激活"和"离线"。
 * 对于好友列表场景，统一按 activeStatus 判断在线/离线，
 * "未激活"状态仅在 AI 助理管理页（有 authStatus）中显示。
 */
export const getAiclawStatus = (activeStatus: OnlineEnum): AiclawStatus => {
  // OnlineEnum.ONLINE = 1
  if (activeStatus === 1) return 'online'
  return 'offline'
}
