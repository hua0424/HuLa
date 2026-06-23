import { defineStore } from 'pinia'
import { ref } from 'vue'
import { StoresEnum, RoomTypeEnum } from '@/enums'
import { useChatStore } from '@/stores/chat'
import { useGlobalStore } from '@/stores/global'
import { useAiclawStore } from '@/stores/aiclaw'
import type { AiclawGroupConfig } from '@/services/wsType'
import { useI18n } from 'vue-i18n'

export type AiclawGroupConfigItem = AiclawGroupConfig & { roomId: string; roomName?: string; account?: string }

/**
 * REQ-005 #61：aiclaw 群配置弹窗的共享状态。
 *
 * 由于弹窗渲染在 ChatMain，而菜单入口来自 ChatSidebar / renderMessage（与 ChatMain 是兄弟节点），
 * provide/inject 无法跨兄弟节点共享状态，因此把弹窗状态下沉到本 store。
 */
export const useAiclawGroupConfigStore = defineStore(StoresEnum.AICLAW_GROUP_CONFIG, () => {
  const { t } = useI18n()

  const modalVisible = ref(false)
  const modalLoading = ref(false)
  const modalSaving = ref(false)
  const modalError = ref('')
  const modalContext = ref<{
    aiclawUid: string
    roomId: string
    adapterType?: string
    config: AiclawGroupConfigItem
  } | null>(null)

  // 防止关闭弹窗后仍在飞的 openModal 异步加载覆盖新的弹窗上下文
  let openModalCallId = 0

  const defaultConfigFor = (roomId: string): AiclawGroupConfigItem => ({
    roomId,
    rateLimitPerMinute: 10,
    dailyLimit: 1000,
    respondToAi: true,
    mentionRequired: true,
    approved: false
  })

  /** 打开指定 aiclaw 在当前群的配置弹窗 */
  const openModal = async (targetUid: string) => {
    const globalStore = useGlobalStore()
    const chatStore = useChatStore()
    const aiclawStore = useAiclawStore()

    const roomId = globalStore.currentSessionRoomId
    const isGroup = globalStore.currentSession?.type === RoomTypeEnum.GROUP
    if (!roomId || !isGroup) {
      window.$message?.error?.(t('home.chat_main.group_nickname.error.invalid_room'))
      return
    }

    const callId = ++openModalCallId
    modalContext.value = null
    modalVisible.value = true
    modalLoading.value = true
    modalError.value = ''

    try {
      // 并行加载群配置与 aiclaw adapterType（后者通常已缓存）
      const [ok] = await Promise.all([chatStore.loadAiclawGroupConfigs(Number(targetUid)), aiclawStore.ensureLoaded()])
      // 如果期间又打开了新弹窗，旧请求结果直接丢弃，避免覆盖新上下文
      if (callId !== openModalCallId) {
        return
      }
      if (!ok) {
        modalError.value = t('aiclaw.group_settings.load_failed')
        return
      }
      const list = chatStore.getAiclawGroupConfigList(Number(targetUid))
      const matched = list.find((cfg) => cfg.roomId === roomId)
      const adapterType = aiclawStore.getAdapterType(targetUid)
      const config = matched ?? defaultConfigFor(roomId)
      modalContext.value = {
        aiclawUid: targetUid,
        roomId,
        adapterType,
        config
      }
    } catch (error) {
      console.error('[AiclawGroupConfigStore] 加载 aiclaw 群配置失败:', error)
      modalError.value = t('aiclaw.group_settings.load_failed')
    } finally {
      // 只有最新一次调用才能解除 loading，否则可能把新弹窗的 loading 提前关掉
      if (callId === openModalCallId) {
        modalLoading.value = false
      }
    }
  }

  /** 保存当前弹窗中的 aiclaw 群配置 */
  const saveModal = async (config: AiclawGroupConfigItem) => {
    if (!modalContext.value) return

    const chatStore = useChatStore()
    const { aiclawUid, roomId } = modalContext.value
    modalSaving.value = true
    try {
      await chatStore.saveAiclawGroupConfig(Number(aiclawUid), roomId, config as AiclawGroupConfig)
      window.$message?.success?.(t('aiclaw.group_settings.save_success'))
      modalVisible.value = false
    } catch (error) {
      console.error('[AiclawGroupConfigStore] 保存 aiclaw 群配置失败:', error)
      window.$message?.error?.(t('aiclaw.group_settings.save_failed'))
    } finally {
      modalSaving.value = false
    }
  }

  const closeModal = () => {
    modalVisible.value = false
  }

  return {
    modalVisible,
    modalLoading,
    modalSaving,
    modalError,
    modalContext,
    openModal,
    saveModal,
    closeModal
  }
})
