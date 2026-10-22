<template>
  <AutoFixHeightPage :show-footer="false">
    <template #header>
      <div class="bg-white" style="border-bottom: 1px solid; border-color: #dfdfdf">
        <HeaderBar :is-official="false" :hidden-right="true" :room-name="t('aiclaw.group_settings.title')" />
      </div>
    </template>

    <template #container>
      <div class="flex flex-col overflow-auto h-full">
        <template v-if="sortedGroupConfigList.length > 0">
          <div
            v-for="config in sortedGroupConfigList"
            :key="config.roomId"
            :ref="
              (el) => {
                if (el) groupConfigRefs[config.roomId] = el as HTMLElement
              }
            "
            class="mx-16px mt-16px p-16px rounded-12px bg-white dark:bg-#1a1a1a"
            data-testid="aiclaw-group-card"
            :class="{ 'ring-(1px solid #13987f)': highlightRoomId === config.roomId }">
            <div class="flex items-center justify-between mb-12px" data-testid="aiclaw-group-card-header">
              <div class="flex items-center gap-8px">
                <span class="text-15px font-500">{{ config.roomName || `Group ${config.roomId}` }}</span>
                <span
                  v-if="config.approved !== true"
                  class="text-11px px-8px py-2px rounded-4px bg-#d0305015 text-#d03050"
                  data-testid="aiclaw-group-card-inactive-badge">
                  {{ t('aiclaw.group_settings.inactive') }}
                </span>
              </div>
              <n-button
                v-if="config.approved !== true"
                size="small"
                type="primary"
                :loading="savingGroupConfig === config.roomId"
                data-testid="aiclaw-group-card-approve-button"
                @click="handleApproveGroupConfig(config)">
                {{ t('aiclaw.group_settings.approve') }}
              </n-button>
            </div>
            <!-- Config form -->
            <AiclawGroupConfigForm
              :config="config"
              :saving="savingGroupConfig === config.roomId"
              :adapter-type="adapterType"
              :default-workspace-dir="buildDefaultWorkspaceDir(uid, config.account)"
              @save="handleSaveGroupConfig" />
          </div>
        </template>
        <div v-else-if="!loading" class="flex flex-col items-center justify-center flex-1 text-13px text-#999">
          <svg class="size-48px mb-12px opacity-20"><use href="#robot"></use></svg>
          <span>{{ t('aiclaw.group_settings.empty') }}</span>
        </div>
        <div v-if="loading" class="flex justify-center py-20px">
          <n-spin size="medium" />
        </div>
        <div class="h-20px" />
      </div>
    </template>
  </AutoFixHeightPage>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useChatStore } from '@/stores/chat'
import AiclawGroupConfigForm from '@/components/aiclaw/AiclawGroupConfigForm.vue'
import { buildDefaultWorkspaceDir, aiclawGroupConfigReflects, sortAiclawGroupConfigs } from '@/utils/aiclawGroupConfig'
import { ImUrlEnum } from '@/enums'
import { imRequest } from '@/utils/ImRequestUtils'
import type { AiclawGroupConfig } from '@/services/wsType'

type GroupConfigItem = AiclawGroupConfig & { roomId: string; roomName?: string; account?: string }

type AiclawListItem = {
  uid: string
  adapterType: string
}

const { t } = useI18n()
const route = useRoute()
const chatStore = useChatStore()

const uid = route.params.uid as string

const loading = ref(false)
const savingGroupConfig = ref<string | null>(null)
const groupConfigList = ref<GroupConfigItem[]>([])
const adapterType = ref('')
const highlightRoomId = ref<string | null>(null)
const groupConfigRefs = ref<Record<string, HTMLElement>>({})

// REQ-012 #114：未激活群卡排前
const sortedGroupConfigList = computed(() => sortAiclawGroupConfigs(groupConfigList.value))

const fetchAdapterType = async () => {
  try {
    const list = await imRequest<AiclawListItem[]>({ url: ImUrlEnum.AICLAW_LIST })
    const item = (list || []).find((a) => String(a.uid) === String(uid))
    adapterType.value = item?.adapterType ?? ''
  } catch (error) {
    console.error('[AiclawGroupSettings] Failed to fetch adapter type:', error)
  }
}

// #456 A10：离开本页后，旧加载/保存/批准结果不得改写已卸载页面、也不发过时完成提示
let disposed = false
onBeforeUnmount(() => {
  disposed = true
})

const fetchConfigs = async () => {
  loading.value = true
  try {
    await chatStore.loadAiclawGroupConfigs(Number(uid))
    // #456 A10：离开本页后旧加载不得改写列表（同账号有效数据仍已进共享缓存）
    if (disposed) return
    groupConfigList.value = chatStore.getAiclawGroupConfigList(Number(uid))
  } catch (error) {
    console.error('[AiclawGroupSettings] Failed to load configs:', error)
  } finally {
    if (!disposed) loading.value = false
  }
}

// #457 A4/A13：保存/批准后的刷新必须是保存之后的新代次读取（store 已在保存成功时作废旧读取），
// 刷新失败单独表达，既不误报保存失败也不宣称已刷新；页面已卸载时一律不改写、不提示。
const runSave = async (
  config: GroupConfigItem,
  submit: () => Promise<unknown>,
  messages: { success: string; failure: string },
  submitted: Partial<AiclawGroupConfig>
) => {
  savingGroupConfig.value = config.roomId
  try {
    try {
      await submit()
    } catch (error) {
      console.error('[AiclawGroupSettings] Failed to submit config:', config.roomId, error)
      if (!disposed) window.$message?.error?.(messages.failure)
      return
    }
    if (disposed) return
    const refreshed = await chatStore.loadAiclawGroupConfigDetail(Number(uid), config.roomId)
    if (disposed) return
    // 同步本地列表，让排序/徽章立即刷新（P2：表单 toggle 关闭批准也要即时生效）
    groupConfigList.value = chatStore.getAiclawGroupConfigList(Number(uid))
    // #457 A13：只有拿到保存之后的刷新结果，或共享缓存已与本次提交一致，才能宣称界面是最新的
    if (refreshed || aiclawGroupConfigReflects(chatStore.getAiclawGroupConfig(Number(uid), config.roomId), submitted)) {
      window.$message?.success?.(messages.success)
    } else {
      window.$message?.warning?.(t('aiclaw.group_settings.saved_refresh_failed'))
    }
  } finally {
    if (savingGroupConfig.value === config.roomId) savingGroupConfig.value = null
  }
}

const handleSaveGroupConfig = (config: GroupConfigItem) => {
  const submitted: AiclawGroupConfig = {
    rateLimitPerMinute: config.rateLimitPerMinute,
    dailyLimit: config.dailyLimit,
    respondToAi: config.respondToAi,
    mentionRequired: config.mentionRequired,
    approved: config.approved,
    workspaceDir: config.workspaceDir
  }
  return runSave(
    config,
    () => chatStore.saveAiclawGroupConfig(Number(uid), config.roomId, submitted),
    { success: t('aiclaw.group_settings.save_success'), failure: t('aiclaw.group_settings.save_failed') },
    submitted
  )
}

// REQ-012 #114：一键批准并立即重载该群配置
// #134：批准只提交 approved 位，不携带其它表单字段，避免覆盖未保存的编辑值。
const handleApproveGroupConfig = (config: GroupConfigItem) => {
  const submitted: Partial<AiclawGroupConfig> = { approved: true }
  return runSave(
    config,
    () => chatStore.saveAiclawGroupConfig(Number(uid), config.roomId, submitted),
    {
      success: t('aiclaw.group_settings.approve_success'),
      failure: t('aiclaw.group_settings.approve_failed')
    },
    submitted
  )
}

onMounted(async () => {
  highlightRoomId.value = (route.query.roomId as string) || null
  await fetchAdapterType()
  await fetchConfigs()
  if (highlightRoomId.value) {
    nextTick(() => {
      const el = groupConfigRefs.value[highlightRoomId.value!]
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }
})
</script>
