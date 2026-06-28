<template>
  <div class="flex flex-col gap-12px">
    <p class="text-(12px #999)">{{ t('aiclaw.cc_launch.hint') }}</p>

    <div v-if="loading" class="flex justify-center py-12px">
      <n-spin size="small" />
    </div>

    <template v-else-if="error">
      <n-alert type="error" :show-icon="false" class="text-12px">
        {{ error }}
      </n-alert>
      <n-button size="small" secondary data-testid="aiclaw-cc-launch-retry" @click="load">
        {{ t('aiclaw.cc_launch.retry') }}
      </n-button>
    </template>

    <template v-else>
      <n-input-group>
        <n-input
          v-model:value="launchCommand"
          readonly
          size="small"
          type="textarea"
          :rows="2"
          data-testid="aiclaw-cc-launch-command"
          :aria-label="t('aiclaw.cc_launch.title')" />
        <n-button
          type="primary"
          size="small"
          :disabled="copied"
          data-testid="aiclaw-cc-launch-copy"
          :aria-label="t('aiclaw.cc_launch.copy')"
          @click="handleCopy">
          {{ copied ? t('aiclaw.cc_launch.copied') : t('aiclaw.cc_launch.copy') }}
        </n-button>
      </n-input-group>

      <div v-if="workspaceDir" class="flex flex-col gap-4px">
        <span class="text-(12px #999)">{{ t('aiclaw.cc_launch.workspace_dir') }}</span>
        <n-input
          v-model:value="workspaceDir"
          readonly
          size="small"
          data-testid="aiclaw-cc-launch-workspace-dir"
          :aria-label="t('aiclaw.cc_launch.workspace_dir')" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { fetchAiclawCcLaunchCommand } from '@/services/aiclaw'

const props = defineProps<{
  roomId: string
  aiclawUid?: string
}>()

const { t } = useI18n()

const loading = ref(false)
const error = ref('')
const launchCommand = ref('')
const workspaceDir = ref('')
const copied = ref(false)

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const result = await fetchAiclawCcLaunchCommand(props.roomId, props.aiclawUid)
    launchCommand.value = result.launchCommand
    workspaceDir.value = result.workspaceDir
  } catch (err) {
    console.error('[AiclawCcLaunchCommand] 获取 CC 启动命令失败:', err)
    error.value = t('aiclaw.cc_launch.load_failed')
  } finally {
    loading.value = false
  }
}

const handleCopy = async () => {
  if (!launchCommand.value) return
  try {
    await navigator.clipboard.writeText(launchCommand.value)
    copied.value = true
    window.$message?.success?.(t('aiclaw.cc_launch.copied'))
    setTimeout(() => {
      copied.value = false
    }, 3000)
  } catch {
    window.$message?.error?.(t('aiclaw.cc_launch.copy_failed'))
  }
}

onMounted(() => {
  void load()
})
</script>
