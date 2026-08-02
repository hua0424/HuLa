<template>
  <n-modal v-model:show="visible" preset="dialog" :show-icon="false" :closable="true" :mask-closable="false">
    <template #header>
      <span class="text-16px font-600">{{ t('aiclaw.profile.title') }}</span>
    </template>
    <div class="flex flex-col gap-16px py-8px">
      <div>
        <label class="text-13px text-#666 mb-4px block">{{ t('aiclaw.create.name') }} *</label>
        <n-input
          v-model:value="formData.name"
          :placeholder="t('aiclaw.create.name_placeholder')"
          :maxlength="20"
          show-count
          data-testid="aiclaw-edit-profile-name" />
      </div>
      <div>
        <label class="text-13px text-#666 mb-4px block">{{ t('aiclaw.create.description') }}</label>
        <n-input
          v-model:value="formData.description"
          type="textarea"
          :placeholder="t('aiclaw.create.description_placeholder')"
          :maxlength="200"
          :rows="3"
          data-testid="aiclaw-edit-profile-description" />
      </div>
    </div>
    <template #action>
      <n-button @click="visible = false">{{ t('aiclaw.delete.cancel') }}</n-button>
      <n-button
        type="primary"
        :loading="submitting"
        :disabled="!formData.name.trim()"
        data-testid="aiclaw-edit-profile-save"
        @click="handleSubmit">
        {{ t('aiclaw.detail.persona_save') }}
      </n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ImUrlEnum } from '@/enums'
import { imRequest } from '@/utils/ImRequestUtils'

/**
 * REQ-015 #186 F1：AI 助理「编辑资料」弹窗（名称+简介，头像不做）。
 * 接线既有 PUT im/aiclaw/{uid}/profile；maxlength 20/200 与创建表单一致。
 */

const { t } = useI18n()

const visible = defineModel<boolean>('visible', { default: false })
const props = defineProps<{
  uid: string
  name: string
  description: string
}>()
const emit = defineEmits<{
  saved: [data: { name: string; description: string }]
}>()

const submitting = ref(false)
const formData = reactive({
  name: '',
  description: ''
})

// 打开弹窗时回填当前值（immediate 覆盖挂载即 visible 的场景）
watch(
  visible,
  (show) => {
    if (show) {
      formData.name = props.name
      formData.description = props.description
    }
  },
  { immediate: true }
)

const handleSubmit = async () => {
  const name = formData.name.trim()
  if (!name) return
  submitting.value = true
  try {
    await imRequest({
      url: ImUrlEnum.AICLAW_PROFILE,
      params: { uid: props.uid },
      body: { name, description: formData.description }
    })
    emit('saved', { name, description: formData.description })
    window.$message?.success?.(t('aiclaw.profile.save_success'))
    visible.value = false
  } catch (error) {
    console.error('[AiclawEditProfileForm] 保存失败:', error)
    window.$message?.error?.(t('aiclaw.profile.save_failed'))
  } finally {
    submitting.value = false
  }
}
</script>
