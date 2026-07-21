import { useI18n } from 'vue-i18n'
import { MittEnum } from '@/enums'
import { useMitt } from '@/hooks/useMitt'
import { useChatStore } from '@/stores/chat'
import { useGlobalStore } from '@/stores/global'
import { releaseBootSuppressionAfterSync } from '@/utils/errorToastSuppression'

/**
 * #179：权威联系人同步（CONTACTS_SYNCED）落地后的统一收尾。
 *
 * - 关闭启动期错误 toast 抑制窗（带在途请求宽限，见 errorToastSuppression）
 * - 当前会话若在权威列表中已消失（离线错过群解散推送、启动自动恢复出来的幽灵会话），
 *   优雅移除并给出「该群聊已解散」轻提示，代替启动期的原始网络错误弹窗（Q2）
 */
export const useGhostSessionGuard = () => {
  const { t } = useI18n()
  const chatStore = useChatStore()
  const globalStore = useGlobalStore()

  const handleContactsSynced = async () => {
    // 权威同步落地：启动抑制窗进入在途宽限关闭流程
    releaseBootSuppressionAfterSync()

    const previousRoomId = globalStore.currentSessionRoomId
    console.log('收到联系人列表同步完成通知，当前会话:', previousRoomId)
    await chatStore.getSessionList(true)
    if (previousRoomId && !chatStore.getSession(previousRoomId)) {
      chatStore.removeDissolvedSession(previousRoomId)
      window.$message.info(t('message.message_menu.group_dissolved'))
    }
  }

  /** 注册 CONTACTS_SYNCED 监听（App.vue setup 调用一次） */
  const register = () => {
    useMitt.on(MittEnum.CONTACTS_SYNCED, handleContactsSynced)
  }

  return { handleContactsSynced, register }
}
