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
            class="mx-16px mt-16px p-16px rounded-12px bg-white dark:bg-#1a1a1a">
            <div class="text-15px font-500 mb-12px">{{ config.roomName || `Group ${config.roomId}` }}</div>
            <!-- Config form -->
            <n-form label-placement="left" label-width="auto" size="small" :show-feedback="false">
              <n-form-item :label="t('aiclaw.group_settings.rate_limit')" class="mb-10px">
                <n-input-number v-model:value="config.rateLimitPerMinute" :min="0" :max="100" size="small" style="width: 90px" />
                <span class="text-11px text-#999 ml-6px">{{ t('aiclaw.group_settings.rate_limit_hint') }}</span>
              </n-form-item>
              <n-form-item :label="t('aiclaw.group_settings.daily_limit')" class="mb-10px">
                <n-input-number v-model:value="config.dailyLimit" :min="0" :max="10000" size="small" style="width: 90px" />
              </n-form-item>
              <n-form-item :label="t('aiclaw.group_settings.respond_to_ai')" class="mb-10px">
                <n-switch v-model:value="config.respondToAi" />
              </n-form-item>
              <n-form-item :label="t('aiclaw.group_settings.mention_required')" class="mb-10px">
                <n-switch v-model:value="config.mentionRequired" />
              </n-form-item>
            </n-form>
            <n-button
              size="small"
              type="primary"
              block
              :loading="savingGroupConfig === config.roomId"
              @click="handleSaveGroupConfig(config)">
              {{ t('aiclaw.group_settings.save') }}
            </n-button>
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
import type { AiclawGroupConfig } from '@/services/wsType'

type GroupConfigItem = AiclawGroupConfig & { roomId: string; roomName?: string }

const { t } = useI18n()
const route = useRoute()
const chatStore = useChatStore()

const uid = route.params.uid as string

const loading = ref(false)
const savingGroupConfig = ref<string | null>(null)
const groupConfigList = ref<GroupConfigItem[]>([])

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
      mentionRequired: config.mentionRequired
    })
    window.$message?.success?.(t('aiclaw.group_settings.save_success'))
  } catch (error) {
    console.error('[AiclawGroupSettings] Failed to save config:', error)
    window.$message?.error?.(t('aiclaw.group_settings.save_failed'))
  } finally {
    savingGroupConfig.value = null
  }
}

onMounted(() => {
  fetchConfigs()
})
</script>
