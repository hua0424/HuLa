<template>
  <AutoFixHeightPage :show-footer="false">
    <template #header>
      <div class="bg-white" style="border-bottom: 1px solid; border-color: #dfdfdf">
        <HeaderBar
          :isOfficial="false"
          :hidden-right="true"
          :room-name="aiclawInfo?.name || t('aiclaw.title')" />
      </div>
    </template>

    <template #container>
      <div class="flex flex-col overflow-auto h-full">
        <!-- 顶部概要 -->
        <div class="flex items-center gap-12px p-20px bg-white dark:bg-#1a1a1a">
          <n-avatar round :size="56" :src="aiclawInfo?.avatar || '/logo.png'" fallback-src="/logo.png" />
          <div class="flex flex-col flex-1 min-w-0">
            <span class="text-17px font-600 truncate">{{ aiclawInfo?.name }}</span>
            <span class="text-13px text-#999 mt-2px">{{ aiclawInfo?.description }}</span>
            <span class="text-12px mt-4px" :class="statusClass">
              {{ t(`aiclaw.status.${authStatusMap[aiclawInfo?.authStatus ?? 0] || 'inactive'}`) }}
            </span>
          </div>
        </div>

        <!-- 对外人设编辑 -->
        <div class="mx-16px mt-16px p-16px rounded-12px bg-white dark:bg-#1a1a1a">
          <div class="text-14px font-500 mb-10px">{{ t('aiclaw.detail.persona') }}</div>
          <n-input
            v-model:value="personaText"
            type="textarea"
            :placeholder="t('aiclaw.detail.persona_placeholder')"
            :autosize="{ minRows: 3, maxRows: 8 }"
            :maxlength="500"
            show-count />
          <div class="flex items-center justify-between mt-8px">
            <span class="text-11px text-#bbb">{{ t('aiclaw.detail.persona_clear_tip') }}</span>
            <n-button
              type="primary"
              size="small"
              :loading="savingPersona"
              :disabled="!personaDirty"
              @click="handleSavePersona">
              {{ t('aiclaw.detail.persona_save') }}
            </n-button>
          </div>
        </div>

        <!-- 功能入口 -->
        <div class="mx-16px mt-16px rounded-12px bg-white dark:bg-#1a1a1a overflow-hidden">
          <!-- 好友管理 -->
          <div
            class="flex items-center justify-between px-16px py-14px cursor-pointer active:bg-#f5f5f5"
            @click="router.push(`/mobile/mobileMy/aiAssistant/${uid}/friends`)">
            <span class="text-14px">{{ t('aiclaw.detail.friends') }}</span>
            <svg class="size-16px text-#ccc"><use href="#right"></use></svg>
          </div>
          <div class="h-1px bg-#f0f0f0 mx-16px" />
          <!-- 对话记录 -->
          <div
            class="flex items-center justify-between px-16px py-14px cursor-pointer active:bg-#f5f5f5"
            @click="router.push(`/mobile/mobileMy/aiAssistant/${uid}/conversations`)">
            <span class="text-14px">{{ t('aiclaw.detail.conversations') }}</span>
            <svg class="size-16px text-#ccc"><use href="#right"></use></svg>
          </div>
        </div>

        <div class="h-20px" />
      </div>
    </template>
  </AutoFixHeightPage>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ImUrlEnum } from '@/enums'
import { imRequest } from '@/utils/ImRequestUtils'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const uid = route.params.uid as string

type AiclawInfo = {
  uid: string
  name: string
  avatar: string
  description: string
  authStatus: number
  adapterType: string
  publicPersona: string | null
  createTime: number
}

const aiclawInfo = ref<AiclawInfo | null>(null)
const personaText = ref('')
const originalPersona = ref('')
const savingPersona = ref(false)

const authStatusMap: Record<number, 'inactive' | 'online' | 'offline'> = {
  0: 'inactive',
  1: 'online',
  2: 'offline'
}

const statusClass = computed(() => {
  const status = aiclawInfo.value?.authStatus
  if (status === 1) return 'text-#18a058'
  if (status === 2) return 'text-#d03050'
  return 'text-#999'
})

const personaDirty = computed(() => personaText.value !== originalPersona.value)

const fetchInfo = async () => {
  try {
    const list = await imRequest<AiclawInfo[]>({ url: ImUrlEnum.AICLAW_LIST })
    const item = (list || []).find((a) => String(a.uid) === String(uid))
    if (item) {
      aiclawInfo.value = item
      personaText.value = item.publicPersona || ''
      originalPersona.value = item.publicPersona || ''
    }
  } catch (error) {
    console.error('[AiAssistantDetail] 获取信息失败:', error)
  }
}

const handleSavePersona = async () => {
  savingPersona.value = true
  try {
    await imRequest({
      url: ImUrlEnum.AICLAW_SET_PERSONA,
      params: { uid },
      body: { publicPersona: personaText.value }
    })
    originalPersona.value = personaText.value
    window.$message?.success?.(t('aiclaw.detail.persona_save_success'))
  } catch (error) {
    console.error('[AiAssistantDetail] 保存人设失败:', error)
  } finally {
    savingPersona.value = false
  }
}

onMounted(() => {
  fetchInfo()
})
</script>
