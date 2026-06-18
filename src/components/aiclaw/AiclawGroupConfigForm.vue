<template>
  <n-form label-placement="left" label-width="auto" size="small" :show-feedback="false">
    <n-form-item :label="t('aiclaw.group_settings.rate_limit')" class="mb-12px">
      <n-input-number
        v-model:value="localConfig.rateLimitPerMinute"
        :min="0"
        :max="100"
        size="small"
        style="width: 100px"
        data-testid="aiclaw-group-config-rate-limit"
        :aria-label="t('aiclaw.group_settings.rate_limit')" />
      <span class="text-11px text-#999 ml-8px">{{ t('aiclaw.group_settings.rate_limit_hint') }}</span>
    </n-form-item>
    <n-form-item :label="t('aiclaw.group_settings.daily_limit')" class="mb-12px">
      <n-input-number
        v-model:value="localConfig.dailyLimit"
        :min="0"
        :max="10000"
        size="small"
        style="width: 100px"
        data-testid="aiclaw-group-config-daily-limit"
        :aria-label="t('aiclaw.group_settings.daily_limit')" />
    </n-form-item>
    <n-form-item :label="t('aiclaw.group_settings.respond_to_ai')" class="mb-12px">
      <n-switch
        v-model:value="localConfig.respondToAi"
        data-testid="aiclaw-group-config-respond-ai"
        :aria-label="t('aiclaw.group_settings.respond_to_ai')" />
    </n-form-item>
    <n-form-item :label="t('aiclaw.group_settings.mention_required')" class="mb-12px">
      <n-switch
        v-model:value="localConfig.mentionRequired"
        data-testid="aiclaw-group-config-mention"
        :aria-label="t('aiclaw.group_settings.mention_required')" />
      <span class="text-11px text-#999 ml-8px">{{ t('aiclaw.group_settings.mention_required_hint') }}</span>
    </n-form-item>
  </n-form>
  <n-button
    size="small"
    type="primary"
    :loading="saving"
    data-testid="aiclaw-group-config-save"
    :aria-label="t('aiclaw.group_settings.save')"
    @click="handleSave">
    {{ t('aiclaw.group_settings.save') }}
  </n-button>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AiclawGroupConfig } from '@/services/wsType'

type ConfigItem = AiclawGroupConfig & { roomId: string }

const props = withDefaults(
  defineProps<{
    config: ConfigItem
    saving?: boolean
  }>(),
  {
    saving: false
  }
)

const emit = defineEmits<(e: 'save', payload: ConfigItem) => void>()

const { t } = useI18n()

const localConfig = ref<ConfigItem>({ ...props.config })

watch(
  () => props.config,
  (newConfig) => {
    localConfig.value = { ...newConfig }
  },
  { deep: true }
)

const handleSave = () => {
  emit('save', { ...localConfig.value })
}
</script>
