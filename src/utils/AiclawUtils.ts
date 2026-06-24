import { UserType } from '@/enums'
import { useContactStore } from '@/stores/contacts'
import { useGroupStore } from '@/stores/group'

/**
 * 判断指定用户是否为 AI 助理（aiclaw）。
 * 单一事实源：优先查 groupStore 群成员缓存，fallback 到 contactStore 好友列表。
 * 覆盖群聊、私聊两种场景，也兼容传入 number 类型的 uid。
 */
export const isAiclaw = (uid: string | number | undefined | null): boolean => {
  if (uid === undefined || uid === null || uid === '') return false
  const uidStr = String(uid)

  // 优先从群成员缓存查找（群聊场景）
  const groupStore = useGroupStore()
  const userInfo = groupStore.getUserInfo(uidStr)
  if (userInfo?.userType !== undefined) {
    return userInfo.userType === UserType.AICLAW
  }

  // fallback: 从好友列表查找（私聊场景，groupStore 无该用户数据）
  const contactStore = useContactStore()
  const friend = contactStore.contactsList.find((item) => item.uid === uidStr)
  if (friend?.userType !== undefined) {
    return friend.userType === UserType.AICLAW
  }

  return false
}

/**
 * 通过 userType 判断是否为 AI 助理。
 * 列表/排序等已有 userType 字段的场景使用，内部口径与 isAiclaw 一致。
 */
export const isAiclawByUserType = (userType?: number): boolean => {
  return userType === UserType.AICLAW
}

/**
 * 判断群成员列表中的 AI 助理是否处于「沉默/不可用」状态。
 * REQ-009 #86：仅当 userType 是 AI 助理且 approved 显式为 false 时返回 true；
 * approved 为 undefined（尚未加载）时不应显示沉默标识，避免误标。
 */
export const isSilentAiclaw = (userType?: number, approved?: boolean): boolean => {
  return isAiclawByUserType(userType) && approved === false
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
export const getAiclawStatus = (activeStatus: number): AiclawStatus => {
  // OnlineEnum.ONLINE = 1
  if (activeStatus === 1) return 'online'
  return 'offline'
}
