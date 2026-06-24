<template>
  <AutoFixHeightPage :show-footer="false">
    <template #header>
      <div class="bg-white" style="border-bottom: 1px solid; border-color: #dfdfdf">
        <HeaderBar :is-official="false" :hidden-right="true" :room-name="t('aiclaw.group_settings.title')" />
      </div>
    </template>

    <template #container>
      <div class="flex flex-col overflow-auto h-full">
        <template v-if="groupConfigList.length > 0">
          <div
            v-for="config in groupConfigList"
            :key="config.roomId"
            :ref="
              (el) => {
                if (el) groupConfigRefs[config.roomId] = el as HTMLElement
              }
            "
            class="mx-16px mt-16px p-16px rounded-12px bg-white dark:bg-#1a1a1a"
            :class="{ 'ring-(1px solid #13987f)': highlightRoomId === config.roomId }">
            <div class="text-15px font-500 mb-12px">{{ config.roomName || `Group ${config.roomId}` }}</div>
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
import { buildDefaultWorkspaceDir } from '@/utils/aiclawGroupConfig'
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
    window.$message?.success?.(t('aiclaw.group_settings.save_success'))
  } catch (error) {
    console.error('[AiclawGroupSettings] Failed to save config:', error)
    window.$message?.error?.(t('aiclaw.group_settings.save_failed'))
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
