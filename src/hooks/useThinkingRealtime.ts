import { onUnmounted } from 'vue'
import { useMitt } from '@/hooks/useMitt'
import { WsResponseMessageType, type ThinkingEndPayload, type ThinkingStartPayload } from '@/services/wsType'
import { useChatStore } from '@/stores/chat'

/**
 * aichatoverview#396：思考 START/END 账号级单实例消费者，桌面与移动共用。
 * 多个宿主（桌面布局、移动布局）同窗共存时仍只有一份订阅，不双写；
 * 宿主卸载/重挂（切号、路由重进）不断订不泄漏。store 内已有会话/epoch/归属守卫。
 */
let activeHosts = 0

const onThinkingStart = (data: ThinkingStartPayload) => {
  useChatStore().startThinking(data)
}

const onThinkingEnd = (data: ThinkingEndPayload) => {
  useChatStore().finalizeThinking(data.thinkingId, data)
}

export function useThinkingRealtime() {
  if (activeHosts === 0) {
    useMitt.on(WsResponseMessageType.THINKING_START, onThinkingStart)
    useMitt.on(WsResponseMessageType.THINKING_END, onThinkingEnd)
  }
  activeHosts += 1
  onUnmounted(() => {
    activeHosts -= 1
    if (activeHosts <= 0) {
      activeHosts = 0
      useMitt.off(WsResponseMessageType.THINKING_START, onThinkingStart)
      useMitt.off(WsResponseMessageType.THINKING_END, onThinkingEnd)
    } else {
      // 卸载宿主的自动清理已摘除共享订阅，为剩余宿主恢复一份。
      useMitt.on(WsResponseMessageType.THINKING_START, onThinkingStart)
      useMitt.on(WsResponseMessageType.THINKING_END, onThinkingEnd)
    }
  })
}
