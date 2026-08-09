import { ChangeTypeEnum } from '@/enums'
import { isWeb } from '@/utils/PlatformConstants'

/**
 * #210 二期：群成员变化的跨窗广播。
 *
 * 背景：管理窗（aiAssistant）群设置 tab 的实时收敛原设计依赖 pinia-shared-state
 * 跨窗同步 group store 的 userListMap。真机诊断发现该同步在首轮往返后失效——
 * 插件收包路径 store.$patch(state => keys.forEach(k => state[k] = JSON副本)) 会把
 * $state 中的 reactive() 子树（userListMap 等）整体替换为反序列化副本，此后该
 * 子树的深层 mutation 不再触发 $subscribe 的 deep watcher，广播沉寂，仅剩建窗
 * 时刻的初始化快照。故成员变化改由主窗 WS handler 经 Tauri 事件直驱各窗。
 *
 * web 端无多窗（且 aiAssistant 以路由形式打开时 userListMap 同上下文是活的），
 * 广播 no-op，web/移动端走原签名 watcher 路径。
 */
export const MEMBER_CHANGE_EVENT = 'aiclaw:member-change'

export type MemberChangeBroadcastPayload = {
  roomId: string
  /** WS ChangeTypeEnum；dissolved 为 true 时忽略本字段 */
  changeType?: ChangeTypeEnum
  /** 本次变化的成员 uid 列表（字符串化） */
  uidList?: string[]
  /** ROOM_DISSOLUTION 直发：群已解散，卡片无条件移除 */
  dissolved?: boolean
}

/** 主窗 WS_MEMBER_CHANGE 处理后调用：向所有窗广播成员变化（桌面端多窗收敛用） */
export const broadcastMemberChange = async (param: {
  roomId: string
  changeType: ChangeTypeEnum
  userList: Array<{ uid: string | number }>
}): Promise<void> => {
  if (isWeb()) return
  try {
    const { emit } = await import('@tauri-apps/api/event')
    const payload: MemberChangeBroadcastPayload = {
      roomId: String(param.roomId),
      changeType: param.changeType,
      uidList: (param.userList ?? []).map((u) => String(u.uid))
    }
    await emit(MEMBER_CHANGE_EVENT, payload)
  } catch (error) {
    console.error('[MemberChangeBroadcast] 成员变化广播失败:', error)
  }
}

/** 主窗 ROOM_DISSOLUTION 处理后调用：向所有窗广播群解散 */
export const broadcastRoomDissolution = async (roomId: string): Promise<void> => {
  if (isWeb()) return
  try {
    const { emit } = await import('@tauri-apps/api/event')
    const payload: MemberChangeBroadcastPayload = { roomId: String(roomId), dissolved: true }
    await emit(MEMBER_CHANGE_EVENT, payload)
  } catch (error) {
    console.error('[MemberChangeBroadcast] 群解散广播失败:', error)
  }
}
