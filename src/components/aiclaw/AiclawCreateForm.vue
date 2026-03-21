<template>
  <n-modal v-model:show="visible" preset="dialog" :show-icon="false" :closable="true" :mask-closable="false">
    <template #header>
      <span class="text-16px font-600">{{ t('aiclaw.create.title') }}</span>
    </template>
    <div class="flex flex-col gap-16px py-8px">
      <div>
        <label class="text-13px text-#666 mb-4px block">{{ t('aiclaw.create.name') }} *</label>
        <n-input
          v-model:value="formData.name"
          :placeholder="t('aiclaw.create.name_placeholder')"
          :maxlength="20"
          show-count />
      </div>
      <div>
        <label class="text-13px text-#666 mb-4px block">{{ t('aiclaw.create.description') }}</label>
        <n-input
          v-model:value="formData.description"
          type="textarea"
          :placeholder="t('aiclaw.create.description_placeholder')"
          :maxlength="200"
          :rows="3" />
      </div>
    </div>
    <template #action>
      <n-button @click="visible = false">{{ t('aiclaw.delete.cancel') }}</n-button>
      <n-button type="primary" :loading="submitting" :disabled="!formData.name.trim()" @click="handleSubmit">
        {{ t('aiclaw.create.submit') }}
      </n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ImUrlEnum } from '@/enums'
import { imRequest } from '@/utils/ImRequestUtils'

const { t } = useI18n()

const visible = defineModel<boolean>('visible', { default: false })
const emit = defineEmits<{
  created: [data: { uid: string; activationToken: string }]
}>()

const submitting = ref(false)
const formData = reactive({
  name: '',
  description: ''
})

const handleSubmit = async () => {
  if (!formData.name.trim()) return
  submitting.value = true
  try {
    const result = await imRequest<{ uid: string; name: string; activationToken: string }>({
      url: ImUrlEnum.AICLAW_CREATE,
      body: { name: formData.name, avatar: '', description: formData.description }
    })
    emit('created', { uid: result.uid, activationToken: result.activationToken })
    window.$message?.success?.(t('aiclaw.create.success'))
    visible.value = false
    formData.name = ''
    formData.description = ''
  } catch (error) {
    console.error('[AiclawCreateForm] 创建失败:', error)
    window.$message?.error?.(t('aiclaw.create.failed'))
  } finally {
    submitting.value = false
  }
}
</script>
