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
import { buildDefaultWorkspaceDir, aiclawGroupConfigReflects, isDirBasedAdapter } from '@/utils/aiclawGroupConfig'

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

// #456 A10/A12：弹窗可被重开/换 aiclaw 重载，旧加载不得改写新一轮的结果与错误态
let loadSeq = 0
const loadItems = async () => {
  const seq = ++loadSeq
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
    let failed = false
    for (const item of props.aiclawItems) {
      // #456 A12：批量取数是后台场景，走静默版；失败由下方 loadError 内联提示+重试入口给出
      const ok = await chatStore.loadAiclawGroupConfigDetail(Number(item.uid), props.roomId)
      if (!ok) failed = true
      const matched = chatStore.getAiclawGroupConfig(Number(item.uid), props.roomId)
      result.push({
        ...item,
        // 保存可用性不依赖异步补数据：roomId 已足够保存配置，未命中用默认值
        config: matched
          ? { ...matched, account: matched.account || account }
          : { ...buildDefaultConfig(item.uid, item.adapterType), account }
      })
    }
    if (seq !== loadSeq) return
    loadError.value = loadError.value || failed
    items.value = result
  } finally {
    if (seq === loadSeq) loading.value = false
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
  const seq = loadSeq
  savingUid.value = uid
  try {
    try {
      await chatStore.saveAiclawGroupConfig(Number(uid), props.roomId, config)
    } catch (error) {
      console.error('[AiclawBatchGroupConfigModal] Failed to save config:', error)
      if (savingUid.value === uid) window.$message?.error?.(t('aiclaw.group_settings.save_failed'))
      return
    }
    // #457 A4/A13：保存后的刷新是保存之后的新读取（store 已作废保存前的旧读取）；
    // 刷新失败单独提示，不误报保存失败也不宣称已刷新。
    const refreshed = await chatStore.loadAiclawGroupConfigDetail(Number(uid), props.roomId)
    if (seq !== loadSeq || savingUid.value !== uid) return
    const matched = chatStore.getAiclawGroupConfig(Number(uid), props.roomId)
    if (matched) {
      items.value = items.value.map((item) =>
        String(item.uid) === uid
          ? { ...item, config: { ...matched, account: matched.account || item.config.account } }
          : item
      )
    }
    // #457 A13：刷新失败时缓存可能仍是保存前的值，只有确实一致才能宣称已更新
    if (refreshed || aiclawGroupConfigReflects(matched, config)) {
      window.$message?.success?.(t('aiclaw.group_settings.save_success'))
    } else {
      window.$message?.warning?.(t('aiclaw.group_settings.saved_refresh_failed'))
    }
  } finally {
    if (savingUid.value === uid) savingUid.value = null
  }
}
</script>
