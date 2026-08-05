import { MittEnum } from '@/enums'
import { useMitt } from '@/hooks/useMitt'
import { useChatStore } from '@/stores/chat'
import { useGroupStore } from '@/stores/group'
import { invokeWithErrorHandler } from '@/utils/TauriInvokeHandler'

/**
 * REQ-016 #195 F4（PRD #190 裁决 3）：解散群 —— 乐观移除 + 失败回滚。
 *
 * 确认后立即 emit DELETE_SESSION 移除会话（不等 server 全链路：发系统消息→事务删表→清缓存→推送），
 * 失败时回滚（取消会话隐藏 + 重新拉取会话）并返回 false，由调用方提示。
 * server 异步化本轮不做。
 *
 * @returns true=解散成功；false=失败已回滚
 */
export const dissolveGroupOptimistic = async (roomId: string): Promise<boolean> => {
  const groupStore = useGroupStore()
  const chatStore = useChatStore()

  // 乐观移除：emit 同步分发，会话立即从列表消失
  useMitt.emit(MittEnum.DELETE_SESSION, roomId)

  try {
    await groupStore.exitGroup(roomId)
    return true
  } catch (error) {
    console.error('[dissolveGroup] 解散失败，回滚会话:', error)
    // DELETE_SESSION 链路会把会话标记为隐藏（hide_contact_command hide:true），先解除再拉回
    try {
      await invokeWithErrorHandler('hide_contact_command', { data: { roomId, hide: false } })
    } catch (rollbackError) {
      console.error('[dissolveGroup] 回滚取消隐藏失败:', rollbackError)
    }
    try {
      await chatStore.addSession(roomId)
    } catch (rollbackError) {
      console.error('[dissolveGroup] 回滚恢复会话失败:', rollbackError)
    }
    return false
  }
}
