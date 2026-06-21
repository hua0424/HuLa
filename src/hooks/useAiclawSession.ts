import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useGlobalStore } from '@/stores/global'
import { useGroupStore } from '@/stores/group'
import { isAiclaw, isAiclawByUserType } from '@/utils/AiclawUtils'

export type AiclawHeaderMode = 'aiclaw' | 'normal'

/**
 * REQ-006-3：AI-会话判定的统一 seam。
 *
 * 把散落在 ChatMain/ChatFooter/ChatHeader/useChatMain 等处的
 * isAiclawSession/showThinking/disableComposer/headerMode 判定收敛到这里，
 * 保证语义单一、行为不变，并且变得可测。
 *
 * 注意：disableComposer 目前是孤立薄 flag——私聊 aiclaw 时禁用上传。
 *       aiclaw 文件上传功能未来开放时，只改这一处即可。
 */
export const useAiclawSession = () => {
  const globalStore = useGlobalStore()
  const chatStore = useChatStore()
  const groupStore = useGroupStore()

  const session = computed(() => globalStore.currentSession)
  const roomId = computed(() => globalStore.currentSessionRoomId)

  /** 显式判定：1:1 非群 + 对方是 aiclaw（消灭 isAiclawSession 的隐式漂移） */
  const isAiclawPrivateSession = computed(() => {
    const s = session.value
    return !!s && !chatStore.isGroup && isAiclaw(s.detailId)
  })

  /** 群聊中是否存在 aiclaw 成员 */
  const roomHasAiclaw = computed(() => {
    if (!chatStore.isGroup) return false
    const members = groupStore.getUserListByRoomId(roomId.value)
    return members.some((m) => isAiclawByUserType(m.userType))
  })

  /** 是否显示思考面板：私聊 aiclaw ∨ 群有 aiclaw ∨ 当前正在思考 ∨ 有思考归档 */
  const showThinking = computed(() => {
    if (isAiclawPrivateSession.value) return true
    if (roomHasAiclaw.value) return true
    if (chatStore.isCurrentRoomThinking) return true
    const archive = chatStore.thinkingArchive.get(roomId.value)
    return !!archive && archive.length > 0
  })

  /**
   * 是否禁用 composer 上传（文件/图片/语音）。
   * 当前仅私聊 aiclaw 时禁用；群里不禁。
   * 这是孤立薄 flag，未来开放 aiclaw 上传时只改这里。
   */
  const disableComposer = computed(() => isAiclawPrivateSession.value)

  /** ChatHeader 的 AI 徽标 / RTC 操作 / aiclaw 删除对话框 模式 */
  const headerMode = computed<AiclawHeaderMode>(() => (isAiclawPrivateSession.value ? 'aiclaw' : 'normal'))

  return {
    isAiclawPrivateSession,
    roomHasAiclaw,
    showThinking,
    disableComposer,
    headerMode
  }
}
