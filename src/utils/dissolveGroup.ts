import { MittEnum } from '@/enums'
import { useMitt } from '@/hooks/useMitt'
import { useChatStore } from '@/stores/chat'
import { useGroupStore } from '@/stores/group'

/**
 * REQ-016 #195 F4（PRD #190 裁决 3）：解散群 —— 乐观移除 + 失败回滚。
 *
 * 确认后立即 emit DELETE_SESSION 移除会话（不等 server 全链路：发系统消息→事务删表→清缓存→推送），
 * 失败时纯本地回滚（重新拉取会话，不发起任何 server 调用）并返回 false，由调用方提示。
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
    // PR#55 裁决（P2 竞态）：server 已处理解散但 HTTP 响应丢失时，WS 推送已 markRoomDissolved。
    // 此时回滚（addSession 重加）= 复活幽灵会话——目标终态已达成，直接按成功收敛。
    if (groupStore.isRoomDissolved(roomId)) {
      return true
    }
    console.error('[dissolveGroup] 解散失败，回滚会话:', error)
    // PR#55 裁决（P1）：回滚纯本地化——exit 请求未成功时 server 侧从未 hide 过该会话
    // （请求没到达/没处理），无需 unhide；断网场景下 unhide 调用本身也必然失败。
    // 只需本地 addSession 把乐观移除的会话拉回列表。
    try {
      await chatStore.addSession(roomId)
    } catch (rollbackError) {
      console.error('[dissolveGroup] 回滚恢复会话失败:', rollbackError)
    }
    return false
  }
}
