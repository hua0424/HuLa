<template>
  <n-modal v-model:show="visible" preset="dialog" :show-icon="false" :closable="true" :mask-closable="false">
    <template #header>
      <span class="text-16px font-600">{{ t('aiclaw.delete.title') }}</span>
    </template>
    <div class="flex flex-col gap-16px py-8px">
      <div class="flex items-start gap-6px text-13px text-#e8a02c">
        <svg class="size-14px flex-shrink-0 mt-2px"><use href="#info"></use></svg>
        <span>{{ t('aiclaw.delete.warning') }}</span>
      </div>
      <div>
        <label class="text-13px text-#666 mb-4px block">{{ t('aiclaw.delete.password') }}</label>
        <n-input
          v-model:value="password"
          type="password"
          show-password-on="click"
          :placeholder="t('aiclaw.delete.password_placeholder')"
          @keydown.enter="handleConfirm" />
      </div>
    </div>
    <template #action>
      <n-button @click="visible = false">{{ t('aiclaw.delete.cancel') }}</n-button>
      <n-button type="error" :disabled="!password.trim()" :loading="confirming" @click="handleConfirm">
        {{ t('aiclaw.delete.confirm') }}
      </n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const visible = defineModel<boolean>('visible', { default: false })
const emit = defineEmits<{
  confirm: [password: string]
}>()

const password = ref('')
const confirming = ref(false)

const handleConfirm = () => {
  if (!password.value.trim()) return
  confirming.value = true
  emit('confirm', password.value)
  // Parent will close the dialog after API call
}

watch(visible, (val) => {
  if (!val) {
    password.value = ''
    confirming.value = false
  }
})
</script>
