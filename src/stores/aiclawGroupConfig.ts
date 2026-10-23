import { defineStore } from 'pinia'
import { ref } from 'vue'
import { StoresEnum, RoomTypeEnum } from '@/enums'
import { useChatStore } from '@/stores/chat'
import { useGlobalStore } from '@/stores/global'
import { useAiclawStore } from '@/stores/aiclaw'
import type { AiclawGroupConfig } from '@/services/wsType'
import { aiclawGroupConfigReflects } from '@/utils/aiclawGroupConfig'
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
      // REQ-016 #196 F5：只查当前群（单数版）。复数版会遍历 userListMap 里 aiclaw 历史出现过的
      // 所有房间，退群/解散后的陈旧房间 server membership 校验必炸 → 误报 toast + 整窗置错。
      // 并行加载 aiclaw adapterType（通常已缓存）
      const [ok] = await Promise.all([
        chatStore.loadAiclawGroupConfig(Number(targetUid), roomId),
        aiclawStore.ensureLoaded()
      ])
      // 如果期间又打开了新弹窗，旧请求结果直接丢弃，避免覆盖新上下文
      if (callId !== openModalCallId) {
        return
      }
      if (!ok) {
        modalError.value = t('aiclaw.group_settings.load_failed')
        return
      }
      const matched = chatStore.getAiclawGroupConfig(Number(targetUid), roomId)
      // #456 A11：缓存无配置不算「加载成功」——不用默认值冒充已加载的数据，直接给错误态
      if (!matched) {
        modalError.value = t('aiclaw.group_settings.load_failed')
        return
      }
      const adapterType = aiclawStore.getAdapterType(targetUid)
      modalContext.value = {
        aiclawUid: targetUid,
        roomId,
        adapterType,
        config: matched
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

  // #457 A4/A13：保存后的刷新必须以保存之后的新代次取数，刷新失败与保存失败分开表达；
  // 弹窗已被新上下文取代时，旧保存流程不得关闭新弹窗、改新操作状态或发过时反馈。
  let saveCallId = 0

  /** 保存当前弹窗中的 aiclaw 群配置 */
  const saveModal = async (config: AiclawGroupConfigItem) => {
    const context = modalContext.value
    if (!context) return

    const chatStore = useChatStore()
    const { aiclawUid, roomId } = context
    const callId = ++saveCallId
    const sameContext = () =>
      callId === saveCallId && modalContext.value?.aiclawUid === aiclawUid && modalContext.value?.roomId === roomId
    modalSaving.value = true
    try {
      try {
        await chatStore.saveAiclawGroupConfig(Number(aiclawUid), roomId, config as AiclawGroupConfig)
      } catch (error) {
        console.error('[AiclawGroupConfigStore] 保存 aiclaw 群配置失败:', error)
        if (sameContext()) window.$message?.error?.(t('aiclaw.group_settings.save_failed'))
        return
      }
      if (!sameContext()) return
      modalVisible.value = false
      // store 在保存成功时已作废保存前的旧读取，这里的刷新拿到的一定是保存之后的数据
      const refreshed = await chatStore.loadAiclawGroupConfigDetail(Number(aiclawUid), roomId)
      if (!sameContext()) return
      // #457 A13：刷新失败时缓存可能仍是保存前的值，只有确实一致才能宣称已更新
      if (refreshed || aiclawGroupConfigReflects(chatStore.getAiclawGroupConfig(Number(aiclawUid), roomId), config)) {
        window.$message?.success?.(t('aiclaw.group_settings.save_success'))
      } else {
        window.$message?.warning?.(t('aiclaw.group_settings.saved_refresh_failed'))
      }
    } finally {
      if (callId === saveCallId) modalSaving.value = false
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
