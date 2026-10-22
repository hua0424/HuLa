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
    <n-form-item :label="t('aiclaw.group_settings.approved')" class="mb-12px">
      <n-switch
        v-model:value="localConfig.approved"
        data-testid="aiclaw-group-config-approved"
        :aria-label="t('aiclaw.group_settings.approved')" />
      <span class="text-11px text-#999 ml-8px">{{ t('aiclaw.group_settings.approved_hint') }}</span>
    </n-form-item>
    <n-form-item v-if="showWorkspaceDir" :label="t('aiclaw.group_settings.workspace_dir')" class="mb-12px">
      <n-input
        v-model:value="localConfig.workspaceDir"
        :placeholder="t('aiclaw.group_settings.workspace_dir_placeholder')"
        size="small"
        style="width: 280px"
        data-testid="aiclaw-group-config-workspace-dir"
        :aria-label="t('aiclaw.group_settings.workspace_dir')" />
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
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiclawGroupConfig } from '@/services/wsType'
import { isDirBasedAdapter } from '@/utils/aiclawGroupConfig'

type ConfigItem = AiclawGroupConfig & { roomId: string }

const props = withDefaults(
  defineProps<{
    config: ConfigItem
    saving?: boolean
    adapterType?: string
    defaultWorkspaceDir?: string
  }>(),
  {
    saving: false
  }
)

const emit = defineEmits<(e: 'save', payload: ConfigItem) => void>()

const { t } = useI18n()

const showWorkspaceDir = computed(() => isDirBasedAdapter(props.adapterType))

const ensureDefaults = (cfg: ConfigItem): ConfigItem => ({
  ...cfg,
  approved: cfg.approved ?? false,
  workspaceDir: cfg.workspaceDir ?? (showWorkspaceDir.value ? props.defaultWorkspaceDir : undefined)
})

/** 用户可编辑字段（roomName/account/roomId 等展示字段不参与草稿判定） */
const formSignature = (cfg: ConfigItem) =>
  JSON.stringify([
    cfg.rateLimitPerMinute,
    cfg.dailyLimit,
    cfg.respondToAi,
    cfg.mentionRequired,
    cfg.approved,
    cfg.workspaceDir
  ])

/** 最近一次与服务端对齐的值；localConfig 与之不同即视为存在未保存草稿 */
const baseline = ref<ConfigItem>(ensureDefaults({ ...props.config }))
const localConfig = ref<ConfigItem>({ ...baseline.value })

// #457 A14：同群后台配置更新不得重置未保存输入；无草稿时才跟随服务端（无关群变化不重建卡片内容）。
// 保存成功后的刷新回包与草稿一致 → 视为已对齐并更新基线；不一致的后台更新一律不覆盖草稿。
watch(
  () => props.config,
  (newConfig) => {
    const next = ensureDefaults({ ...newConfig })
    const draft = formSignature(localConfig.value) !== formSignature(baseline.value)
    if (draft && formSignature(next) !== formSignature(localConfig.value)) return
    baseline.value = next
    localConfig.value = { ...next }
  },
  { deep: true }
)

const handleSave = () => {
  emit('save', { ...localConfig.value })
}
</script>
