import { useChatStore } from '@/stores/chat'
import { useGroupStore } from '@/stores/group'
import { invokeSilently } from '@/utils/TauriInvokeHandler'

/**
 * REQ-016 #195 F4（PRD #190 裁决 3）：解散群 —— 乐观移除 + 失败回滚。
 *
 * 确认后立即本地移除会话（不等 server 全链路：发系统消息→事务删表→清缓存→推送）。
 * 乐观移除与失败回滚均为纯本地操作（PR#55 P1 裁决）：
 * - 不经 DELETE_SESSION/handleMsgDelete —— 其 hide_contact hide:true 是 server 调用，
 *   断网时既产生错误噪音 toast，又让回滚必须反向 unhide（断网下 unhide 同样必败）；
 * - 失败时用移除前捕获的快照本地还原（restoreSession），全程零网络——
 *   exit 请求未成功 = server 从未 hide/解散过，无任何 server 侧状态需要撤销。
 * server 异步化本轮不做。
 *
 * @returns true=解散成功；false=失败已回滚
 */
export const dissolveGroupOptimistic = async (roomId: string): Promise<boolean> => {
  const groupStore = useGroupStore()
  const chatStore = useChatStore()

  // 移除前捕获快照（浅拷贝防移除期间被其他链路原位修改）与原位置，供失败时纯本地还原
  const existing = chatStore.getSession(roomId)
  const snapshot = existing ? { ...existing } : undefined
  const snapshotIndex = chatStore.sessionList.findIndex((s) => s.roomId === roomId)

  // 乐观移除：纯本地，会话立即从列表消失
  chatStore.removeSession(roomId)

  try {
    await groupStore.exitGroup(roomId)
    // 成功后再 best-effort 隐藏 contact（静默、不阻塞），保持与原 DELETE_SESSION→hide:true
    // 链路等价的服务器侧终态；失败由 WS 推送/下次 getSessionList 重建自愈，不影响解散结果
    void invokeSilently('hide_contact_command', { data: { roomId, hide: true } })
    return true
  } catch (error) {
    // PR#55 裁决（P2 竞态）：server 已处理解散但 HTTP 响应丢失时，WS 推送已 markRoomDissolved。
    // 此时回滚 = 复活幽灵会话——目标终态已达成，直接按成功收敛。
    if (groupStore.isRoomDissolved(roomId)) {
      return true
    }
    console.error('[dissolveGroup] 解散失败，本地回滚会话:', error)
    if (snapshot) {
      chatStore.restoreSession(snapshot, snapshotIndex === -1 ? undefined : snapshotIndex)
    }
    return false
  }
}
