import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useGlobalStore } from '@/stores/global'
import { useGroupStore } from '@/stores/group'
import { isAiclaw, isAiclawByUserType } from '@/utils/AiclawUtils'

export type AiclawHeaderMode = 'aiclaw' | 'normal'
export type AllowedUploadType = 'image' | 'file' | 'voice'

/**
 * REQ-006-3 / REQ-007-71：AI-会话判定的统一 seam。
 *
 * 把散落在 ChatMain/ChatFooter/ChatHeader/useChatMain 等处的
 * isAiclawSession/showThinking/disableComposer/headerMode 判定收敛到这里，
 * 保证语义单一、行为不变，并且变得可测。
 *
 * 注意：allowedUploadTypes 是上传能力的唯一 seam。
 *       - null 表示不限制（普通会话默认）。
 *       - 1:1 私聊 aiclaw 仅开放 image/file，语音仍禁。
 *       - 空数组 [] 不表示"不限"，禁用场景用 null 或不含对应类型的数组。
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
   * 当前会话允许上传的媒体类型。
   * - null：不限制（普通私聊 / 群聊）。
   * - 1:1 私聊 aiclaw：仅允许图片/文件，语音仍禁。
   */
  const allowedUploadTypes = computed<null | AllowedUploadType[]>(() => {
    if (isAiclawPrivateSession.value) {
      return ['image', 'file']
    }
    return null
  })

  /**
   * 是否完全禁用 composer 上传。
   * 当 allowedUploadTypes 为非空数组且为空数组时返回 true；当前不存在此场景，保留薄 flag。
   */
  const disableComposer = computed(() => {
    const types = allowedUploadTypes.value
    return types !== null && types.length === 0
  })

  /** ChatHeader 的 AI 徽标 / RTC 操作 / aiclaw 删除对话框 模式 */
  const headerMode = computed<AiclawHeaderMode>(() => (isAiclawPrivateSession.value ? 'aiclaw' : 'normal'))

  return {
    isAiclawPrivateSession,
    roomHasAiclaw,
    showThinking,
    allowedUploadTypes,
    disableComposer,
    headerMode
  }
}
