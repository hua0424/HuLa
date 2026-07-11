import { watch } from 'vue'
import { UserType } from '@/enums'
import { useChatStore } from '@/stores/chat'
import { useGlobalStore } from '@/stores/global'
import { useGroupStore } from '@/stores/group'
import { isSilentAiclaw } from '@/utils/AiclawUtils'

/**
 * REQ-009 #86 / #174：群成员「沉默/不可用」标识的共享逻辑。
 *
 * 单一事实源：把原先散落在 ChatSidebar（常驻成员面板）、ChatHeader（「更多」抽屉）、
 * ManageGroupMember（群成员管理弹窗）三处的手抄副本收敛到一处，避免各自漂移。
 *
 * 数据链路：
 * - 初始渲染：进入群 / 成员列表变化时，为群内所有 aiclaw 成员按需拉取 (aiclawUid, roomId)
 *   的 approved 状态到 chatStore.aiclawGroupConfigs（reactive Map）。
 * - 实时切换：主人批准/撤销时，layout/index.vue 收 WSGroupConfigChange 广播调
 *   chatStore.updateAiclawGroupConfig 直接改这张 reactive Map；isSilentMember 读同一张 Map，
 *   模板里天然响应式，标识即时增删，无需本 composable 额外订阅。
 *
 * 判定：isSilentAiclaw(userType, approved) 仅在 userType 为 AI 助理且 approved 显式为 false
 * 时为 true；approved 为 undefined（尚未加载）不显示，避免 unloaded 误标。
 */
export const useSilentAiclaw = (options: { autoWatch?: boolean } = {}) => {
  const { autoWatch = true } = options
  const chatStore = useChatStore()
  const globalStore = useGlobalStore()
  const groupStore = useGroupStore()

  /** 该成员是否为「未批准的 AI 助理」（用于头像旁沉默标识） */
  const isSilentMember = (uid: string): boolean => {
    const roomId = globalStore.currentSessionRoomId
    if (!roomId) return false
    const userInfo = groupStore.getUserInfo(uid)
    if (!userInfo) return false
    const approved = chatStore.getAiclawGroupConfig(Number(uid), roomId)?.approved
    return isSilentAiclaw(userInfo.userType, approved)
  }

  /** 为当前群的所有 AI 助理成员加载 approved 状态 */
  const loadSilentConfigsForCurrentRoom = async () => {
    const roomId = globalStore.currentSessionRoomId
    if (!roomId) return
    const aiclawMembers = groupStore.userList.filter((m) => m.userType === UserType.AICLAW)
    await Promise.all(aiclawMembers.map((m) => chatStore.loadAiclawGroupConfig(Number(m.uid), roomId)))
  }

  // 监听「进入群聊 / 群成员变化」两路信号，避免只 watch userList.length
  // 导致切换同规模群、或组件挂载时 isGroup 尚未就绪而漏拉 approved。
  if (autoWatch) {
    watch(
      [() => globalStore.currentSessionRoomId, () => chatStore.isGroup, () => groupStore.userList.length],
      ([roomId, isGroup]) => {
        if (roomId && isGroup) {
          loadSilentConfigsForCurrentRoom()
        }
      },
      { immediate: true }
    )
  }

  return { isSilentMember, loadSilentConfigsForCurrentRoom }
}
