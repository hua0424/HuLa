<template>
  <AutoFixHeightPage :show-footer="false">
    <template #header>
      <div class="bg-white" style="border-bottom: 1px solid; border-color: #dfdfdf">
        <HeaderBar
          :isOfficial="false"
          :hidden-right="true"
          :room-name="t('aiclaw.conversations.title')" />
      </div>
    </template>

    <template #container>
      <div class="flex flex-col overflow-auto h-full">
        <!-- 对话列表 -->
        <template v-if="conversations.length > 0">
          <div
            v-for="item in conversations"
            :key="item.friendUid"
            class="flex items-center gap-12px px-20px py-14px cursor-pointer active:bg-#f5f5f5 border-b border-#f0f0f0"
            @click="router.push(`/mobile/mobileMy/aiAssistant/${uid}/conversations/${item.friendUid}`)">
            <n-avatar round :size="44" :src="item.friendAvatar || '/logo.png'" fallback-src="/logo.png" />
            <div class="flex flex-col flex-1 min-w-0">
              <div class="flex items-center justify-between">
                <span class="text-15px font-500 truncate">{{ item.friendName }}</span>
                <span class="text-11px text-#bbb flex-shrink-0">{{ formatTime(item.lastMessage?.sendTime) }}</span>
              </div>
              <span class="text-13px text-#999 mt-2px truncate">
                {{ item.lastMessage?.content || '' }}
              </span>
            </div>
          </div>
        </template>

        <!-- 空状态 -->
        <div v-else-if="!loading" class="flex flex-col items-center justify-center flex-1 text-14px text-#999">
          <svg class="size-48px mb-12px opacity-30"><use href="#robot"></use></svg>
          <span>{{ t('aiclaw.conversations.empty') }}</span>
        </div>

        <!-- 加载状态 -->
        <div v-if="loading" class="flex justify-center py-20px">
          <n-spin size="medium" />
        </div>
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

type ConversationItem = {
  friendUid: string
  friendName: string
  friendAvatar: string
  lastMessage: {
    content: string
    sendTime: number
    type: number
  } | null
  roomId: string
}

const conversations = ref<ConversationItem[]>([])
const loading = ref(false)

const formatTime = (timestamp?: number) => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  if (isToday) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    return '昨天'
  }
  return `${date.getMonth() + 1}/${date.getDate()}`
}

const fetchConversations = async () => {
  loading.value = true
  try {
    const result = await imRequest<{ list: ConversationItem[] }>({
      url: ImUrlEnum.AICLAW_CONVERSATIONS,
      params: { uid }
    })
    conversations.value = result?.list || []
  } catch (error) {
    console.error('[AiclawConversations] 获取对话列表失败:', error)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchConversations()
})
</script>
