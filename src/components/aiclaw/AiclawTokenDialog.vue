<template>
  <n-modal v-model:show="visible" preset="dialog" :show-icon="false" :closable="true" :mask-closable="false">
    <template #header>
      <span class="text-16px font-600">{{ t('aiclaw.token.dialog_title') }}</span>
    </template>
    <div class="flex flex-col gap-16px py-8px">
      <!-- 加载状态 -->
      <div v-if="loading" class="flex justify-center py-20px">
        <n-spin size="medium" />
      </div>

      <template v-else>
        <div class="p-12px rounded-8px bg-#f5f5f5 dark:bg-#2a2a2a font-mono text-13px break-all select-text">
          {{ displayToken }}
        </div>
        <n-flex align="center" :size="8">
          <n-button type="primary" @click="handleCopy" :disabled="copied">
            {{ copied ? t('aiclaw.token.copied') : t('aiclaw.token.copy') }}
          </n-button>
          <n-button v-if="props.uid" @click="handleRefresh" :loading="refreshing">
            {{ t('aiclaw.token.refresh') }}
          </n-button>
        </n-flex>
        <div class="flex items-start gap-6px text-12px text-#e8a02c">
          <svg class="size-14px flex-shrink-0 mt-2px"><use href="#info"></use></svg>
          <span>{{ t('aiclaw.token.warning') }}</span>
        </div>
      </template>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ImUrlEnum } from '@/enums'
import { imRequest } from '@/utils/ImRequestUtils'

const { t } = useI18n()

const props = defineProps<{
  /** 直接传入的 token（创建/刷新后） */
  token?: string
  /** aiclaw uid，传入后支持查看和刷新激活码 */
  uid?: string
}>()

const emit = defineEmits<{
  refreshed: []
}>()

const visible = defineModel<boolean>('visible', { default: false })
const copied = ref(false)
const loading = ref(false)
const refreshing = ref(false)
const fetchedToken = ref('')

const displayToken = computed(() => props.token || fetchedToken.value)

watch(visible, async (show) => {
  if (show && props.uid && !props.token) {
    loading.value = true
    try {
      const result = await imRequest<{ activationToken: string }>({
        url: ImUrlEnum.AICLAW_ACTIVATION_TOKEN,
        params: { uid: props.uid }
      })
      fetchedToken.value = result.activationToken
    } catch (error) {
      console.error('[AiclawTokenDialog] 获取激活码失败:', error)
      window.$message?.error?.('获取激活码失败')
    } finally {
      loading.value = false
    }
  }
  if (!show) {
    copied.value = false
    fetchedToken.value = ''
  }
})

const handleCopy = async () => {
  try {
    await navigator.clipboard.writeText(displayToken.value)
    copied.value = true
    window.$message?.success?.(t('aiclaw.token.copied'))
    setTimeout(() => {
      copied.value = false
    }, 3000)
  } catch {
    window.$message?.error?.(t('aiclaw.token.copy_failed'))
  }
}

const handleRefresh = () => {
  window.$dialog?.warning({
    title: t('aiclaw.token.refresh'),
    content: t('aiclaw.token.refresh_confirm'),
    positiveText: t('aiclaw.delete.confirm'),
    negativeText: t('aiclaw.delete.cancel'),
    onPositiveClick: async () => {
      refreshing.value = true
      try {
        const result = await imRequest<{ activationToken: string }>({
          url: ImUrlEnum.AICLAW_REFRESH_ACTIVATION,
          params: { uid: props.uid }
        })
        fetchedToken.value = result.activationToken
        window.$message?.success?.(t('aiclaw.token.refresh_success'))
        emit('refreshed')
      } catch (error) {
        console.error('[AiclawTokenDialog] 重新生成激活码失败:', error)
      } finally {
        refreshing.value = false
      }
    }
  })
}
</script>
