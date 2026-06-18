import { defineStore } from 'pinia'
import { StoresEnum, RoomTypeEnum } from '@/enums'
import { useChatStore } from '@/stores/chat.ts'
import { useGlobalStore } from '@/stores/global.ts'
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
    config: AiclawGroupConfigItem
  } | null>(null)

  const defaultConfigFor = (roomId: string): AiclawGroupConfigItem => ({
    roomId,
    rateLimitPerMinute: 10,
    dailyLimit: 1000,
    respondToAi: true,
    mentionRequired: true
  })

  /** 打开指定 aiclaw 在当前群的配置弹窗 */
  const openModal = async (targetUid: string) => {
    const globalStore = useGlobalStore()
    const chatStore = useChatStore()

    const roomId = globalStore.currentSessionRoomId
    const isGroup = globalStore.currentSession?.type === RoomTypeEnum.GROUP
    if (!roomId || !isGroup) {
      window.$message?.error?.(t('home.chat_main.group_nickname.error.invalid_room'))
      return
    }

    modalContext.value = null
    modalVisible.value = true
    modalLoading.value = true
    modalError.value = ''

    try {
      const ok = await chatStore.loadAiclawGroupConfigs(Number(targetUid))
      if (!ok) {
        modalError.value = t('aiclaw.group_settings.load_failed')
        return
      }
      const list = chatStore.getAiclawGroupConfigList(Number(targetUid))
      const matched = list.find((cfg) => cfg.roomId === roomId)
      modalContext.value = {
        aiclawUid: targetUid,
        roomId,
        config: matched ?? defaultConfigFor(roomId)
      }
    } catch (error) {
      console.error('[AiclawGroupConfigStore] 加载 aiclaw 群配置失败:', error)
      modalError.value = t('aiclaw.group_settings.load_failed')
    } finally {
      modalLoading.value = false
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
