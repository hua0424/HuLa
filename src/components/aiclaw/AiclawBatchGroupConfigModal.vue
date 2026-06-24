<template>
  <n-modal v-model:show="visible" :mask-closable="false" class="rounded-8px" transform-origin="center">
    <div class="bg-[--bg-edit] w-540px max-w-[90vw] h-fit max-h-[80vh] box-border flex flex-col">
      <div class="text-(14px [--text-color]) select-none pt-6px text-center">
        {{ t('aiclaw.group_settings.batch_title') }}
      </div>
      <div class="text-(12px [--chat-text-color]) px-24px pt-8px pb-4px">
        {{ t('aiclaw.group_settings.batch_subtitle') }}
      </div>
      <div class="flex-1 overflow-auto px-24px py-12px">
        <div v-for="item in items" :key="item.uid" class="border-b border-[--line-color] py-16px first:pt-0">
          <div class="text-(14px font-500 [--text-color]) mb-12px">{{ item.name || item.uid }}</div>
          <AiclawGroupConfigForm
            :config="item.config"
            :saving="savingUid === item.uid"
            :adapter-type="item.adapterType"
            :default-workspace-dir="buildDefaultWorkspaceDir(item.uid, account)"
            @save="(cfg) => handleSave(item.uid, cfg)" />
        </div>
      </div>
      <n-flex justify="end" class="p-16px" :size="12">
        <n-button secondary @click="visible = false">{{ t('home.chat_main.cancel') }}</n-button>
      </n-flex>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AiclawGroupConfigForm from '@/components/aiclaw/AiclawGroupConfigForm.vue'
import { useChatStore } from '@/stores/chat'
import { useGroupStore } from '@/stores/group'
import type { AiclawGroupConfig } from '@/services/wsType'
import { buildDefaultWorkspaceDir, isDirBasedAdapter } from '@/utils/aiclawGroupConfig'

export type BatchAiclawItem = {
  uid: string
  name?: string
  adapterType?: string
}

const props = defineProps<{
  visible: boolean
  roomId: string
  account?: string
  aiclawItems: BatchAiclawItem[]
}>()

const emit = defineEmits<(e: 'update:visible', value: boolean) => void>()

const { t } = useI18n()
const chatStore = useChatStore()
const groupStore = useGroupStore()

const visible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

const savingUid = ref<string | null>(null)

/** 每个 aiclaw 的本地表单配置；打开时从 store 拉取，未命中则使用默认值 */
const items = ref<
  Array<BatchAiclawItem & { config: AiclawGroupConfig & { roomId: string; roomName?: string; account?: string } }>
>([])

const buildDefaultConfig = (uid: string, adapterType?: string) => ({
  roomId: props.roomId,
  rateLimitPerMinute: 10,
  dailyLimit: 1000,
  respondToAi: true,
  mentionRequired: true,
  approved: false,
  workspaceDir: isDirBasedAdapter(adapterType) ? buildDefaultWorkspaceDir(uid, props.account) : undefined
})

const loadItems = async () => {
  savingUid.value = null
  if (props.aiclawItems.length === 0) {
    items.value = []
    return
  }

  // 确保有群名/群号兜底
  try {
    await groupStore.addGroupDetail(props.roomId)
  } catch {
    // 取不到 detail 时 account 由 props.account 兜底
  }
  const detail = groupStore.getGroupDetail(props.roomId)
  const account = detail?.account || props.account

  const result: typeof items.value = []
  for (const item of props.aiclawItems) {
    await chatStore.loadAiclawGroupConfigs(Number(item.uid))
    const list = chatStore.getAiclawGroupConfigList(Number(item.uid))
    const matched = list.find((cfg) => cfg.roomId === props.roomId)
    result.push({
      ...item,
      config: matched
        ? { ...matched, account: matched.account || account }
        : { ...buildDefaultConfig(item.uid, item.adapterType), account }
    })
  }
  items.value = result
}

watch(
  () => [props.visible, props.aiclawItems.map((i) => i.uid).join(',')],
  ([isVisible]) => {
    if (isVisible) {
      void loadItems()
    }
  },
  { immediate: true }
)

const handleSave = async (
  uid: string,
  config: AiclawGroupConfig & { roomId: string; roomName?: string; account?: string }
) => {
  savingUid.value = uid
  try {
    await chatStore.saveAiclawGroupConfig(Number(uid), props.roomId, config)
    window.$message?.success?.(t('aiclaw.group_settings.save_success'))
  } catch (error) {
    console.error('[AiclawBatchGroupConfigModal] Failed to save config:', error)
    window.$message?.error?.(t('aiclaw.group_settings.save_failed'))
  } finally {
    savingUid.value = null
  }
}
</script>
