<template>
  <n-modal v-model:show="modelVisible" :mask-closable="false" class="rounded-8px" transform-origin="center">
    <div class="bg-[--bg-edit] w-540px max-w-[90vw] h-fit max-h-[80vh] box-border flex flex-col">
      <div class="text-(14px [--text-color]) select-none pt-6px text-center">
        {{ t('aiclaw.group_settings.batch_title') }}
      </div>
      <div class="text-(12px [--chat-text-color]) px-24px pt-8px pb-4px">
        {{ t('aiclaw.group_settings.batch_subtitle') }}
      </div>
      <div class="flex-1 overflow-auto px-24px py-12px">
        <!-- REQ-016 #195 F3：弹窗先开后补——加载中骨架 / 失败错误态+重试；保存不依赖异步补数据 -->
        <div v-if="loading" class="flex flex-col gap-16px py-8px" data-testid="aiclaw-batch-config-loading">
          <n-skeleton v-for="item in aiclawItems" :key="item.uid" text :repeat="3" />
        </div>
        <template v-else>
          <div
            v-if="loadError"
            class="flex items-center justify-between gap-8px mb-12px px-12px py-8px rounded-6px bg-#d0305015 text-(12px #d03050)"
            data-testid="aiclaw-batch-config-error">
            <span>{{ t('aiclaw.group_settings.batch_load_partial_failed') }}</span>
            <n-button size="tiny" secondary @click="loadItems">{{ t('aiclaw.group_settings.retry') }}</n-button>
          </div>
          <div v-for="item in items" :key="item.uid" class="border-b border-[--line-color] py-16px first:pt-0">
            <div class="text-(14px font-500 [--text-color]) mb-12px">{{ item.name || item.uid }}</div>
            <AiclawGroupConfigForm
              :config="item.config"
              :saving="savingUid === item.uid"
              :adapter-type="item.adapterType"
              :default-workspace-dir="buildDefaultWorkspaceDir(item.uid, account)"
              @save="(cfg) => handleSave(item.uid, cfg)" />
          </div>
        </template>
      </div>
      <n-flex justify="end" class="p-16px" :size="12">
        <n-button secondary @click="modelVisible = false">{{ t('home.chat_main.cancel') }}</n-button>
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

const modelVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

const savingUid = ref<string | null>(null)
/** REQ-016 #195 F3：弹窗先开后补的加载/失败态 */
const loading = ref(false)
const loadError = ref(false)

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
  loadError.value = false
  if (props.aiclawItems.length === 0) {
    items.value = []
    return
  }

  loading.value = true
  try {
    // 确保有群名/群号兜底（失败静默：account 由 props 兜底，但记入错误态给重试入口）
    try {
      await groupStore.addGroupDetail(props.roomId)
    } catch {
      loadError.value = true
    }
    const detail = groupStore.getGroupDetail(props.roomId)
    const account = detail?.account || props.account

    // REQ-016 #195：单数版只查当前群——复数版会被 userListMap 残留房间的陈旧校验失败连坐
    const result: typeof items.value = []
    for (const item of props.aiclawItems) {
      const ok = await chatStore.loadAiclawGroupConfig(Number(item.uid), props.roomId)
      if (!ok) loadError.value = true
      const matched = chatStore.getAiclawGroupConfig(Number(item.uid), props.roomId)
      result.push({
        ...item,
        // 保存可用性不依赖异步补数据：roomId 已足够保存配置，未命中用默认值
        config: matched
          ? { ...matched, account: matched.account || account }
          : { ...buildDefaultConfig(item.uid, item.adapterType), account }
      })
    }
    items.value = result
  } finally {
    loading.value = false
  }
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
