<template>
  <n-modal v-model:show="visible" preset="dialog" :show-icon="false" :closable="true" :mask-closable="false">
    <template #header>
      <span class="text-16px font-600">{{ t('aiclaw.cc_launch.title') }}</span>
    </template>
    <div class="py-8px">
      <AiclawCcLaunchCommand :room-id="props.roomId" :aiclaw-uid="props.aiclawUid" />
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AiclawCcLaunchCommand from '@/components/aiclaw/AiclawCcLaunchCommand.vue'

const props = defineProps<{
  roomId: string
  aiclawUid?: string
}>()

const { t } = useI18n()
const visible = defineModel<boolean>('visible', { default: false })
</script>
