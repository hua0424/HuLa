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
import { buildDefaultWorkspaceDir, sortAiclawGroupConfigs } from '@/utils/aiclawGroupConfig'
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

const fetchConfigs = async () => {
  loading.value = true
  try {
    await chatStore.loadAiclawGroupConfigs(Number(uid))
    groupConfigList.value = chatStore.getAiclawGroupConfigList(Number(uid))
  } catch (error) {
    console.error('[AiclawGroupSettings] Failed to load configs:', error)
  } finally {
    loading.value = false
  }
}

const handleSaveGroupConfig = async (config: GroupConfigItem) => {
  savingGroupConfig.value = config.roomId
  try {
    await chatStore.saveAiclawGroupConfig(Number(uid), config.roomId, {
      rateLimitPerMinute: config.rateLimitPerMinute,
      dailyLimit: config.dailyLimit,
      respondToAi: config.respondToAi,
      mentionRequired: config.mentionRequired,
      approved: config.approved,
      workspaceDir: config.workspaceDir
    })
    await chatStore.loadAiclawGroupConfig(Number(uid), config.roomId)
    // 同步本地列表，让排序/徽章立即刷新（P2：表单 toggle 关闭批准也要即时生效）
    groupConfigList.value = chatStore.getAiclawGroupConfigList(Number(uid))
    window.$message?.success?.(t('aiclaw.group_settings.save_success'))
  } catch (error) {
    console.error('[AiclawGroupSettings] Failed to save config:', error)
    window.$message?.error?.(t('aiclaw.group_settings.save_failed'))
  } finally {
    savingGroupConfig.value = null
  }
}

// REQ-012 #114：一键批准并立即重载该群配置
// #134：批准只提交 approved 位，不携带其它表单字段，避免覆盖未保存的编辑值。
const handleApproveGroupConfig = async (config: GroupConfigItem) => {
  savingGroupConfig.value = config.roomId
  try {
    await chatStore.saveAiclawGroupConfig(Number(uid), config.roomId, { approved: true })
    await chatStore.loadAiclawGroupConfig(Number(uid), config.roomId)
    // 同步本地列表，让排序/徽章立即刷新
    groupConfigList.value = chatStore.getAiclawGroupConfigList(Number(uid))
    window.$message?.success?.(t('aiclaw.group_settings.approve_success'))
  } catch (error) {
    console.error('[AiclawGroupSettings] Failed to approve config:', error)
    window.$message?.error?.(t('aiclaw.group_settings.approve_failed'))
  } finally {
    savingGroupConfig.value = null
  }
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
