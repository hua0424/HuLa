<template>
  <AutoFixHeightPage :show-footer="false">
    <template #header>
      <div class="bg-white" style="border-bottom: 1px solid; border-color: #dfdfdf">
        <HeaderBar
          :isOfficial="false"
          :hidden-right="true"
          :room-name="friendName || t('aiclaw.conversations.title')" />
      </div>
    </template>

    <template #container>
      <div ref="scrollContainer" class="flex flex-col overflow-auto h-full px-12px" @scroll="handleScroll">
        <!-- 加载更多 -->
        <div v-if="loadingMore" class="flex justify-center py-12px">
          <n-spin size="small" />
        </div>
        <div v-if="isLast && messages.length > 0" class="text-center text-12px text-#ccc py-12px">
          {{ t('aiclaw.conversations.no_more') }}
        </div>

        <!-- 消息列表 -->
        <div v-for="msg in messages" :key="msg.message.id" class="py-4px">
          <div class="flex" :class="isAiclawMsg(msg) ? 'justify-start' : 'justify-end'">
            <div class="flex gap-8px max-w-80%" :class="isAiclawMsg(msg) ? '' : 'flex-row-reverse'">
              <n-avatar
                round
                :size="32"
                :src="isAiclawMsg(msg) ? aiclawAvatar : friendAvatar"
                fallback-src="/logo.png"
                class="flex-shrink-0" />
              <div
                class="px-12px py-8px rounded-12px text-14px break-all"
                :class="isAiclawMsg(msg)
                  ? 'bg-white dark:bg-#2a2a2a text-[--text-color]'
                  : 'bg-#95ec69 dark:bg-#3a6e2a text-black dark:text-white'">
                {{ msg.message.body?.content || '' }}
              </div>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="!loading && messages.length === 0" class="flex flex-col items-center justify-center flex-1 text-14px text-#999">
          <span>{{ t('aiclaw.conversations.empty') }}</span>
        </div>

        <!-- 初始加载 -->
        <div v-if="loading" class="flex justify-center py-20px">
          <n-spin size="medium" />
        </div>
      </div>
    </template>
  </AutoFixHeightPage>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { ImUrlEnum } from '@/enums'
import { imRequest } from '@/utils/ImRequestUtils'

const { t } = useI18n()
const route = useRoute()

const uid = route.params.uid as string
const friendUid = route.params.friendUid as string

type MessageItem = {
  fromUser: { uid: string }
  message: {
    id: string
    roomId: string
    sendTime: number | string
    type: number
    body: { content?: string }
    messageMarks: Record<string, unknown>
  }
}

const messages = ref<MessageItem[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const isLast = ref(false)
const cursor = ref('')
const scrollContainer = ref<HTMLElement | null>(null)

const friendName = ref('')
const friendAvatar = ref('')
const aiclawAvatar = ref('')

const isAiclawMsg = (msg: MessageItem) => String(msg.fromUser.uid) === String(uid)

const fetchMessages = async (isLoadMore = false) => {
  if (isLoadMore) {
    loadingMore.value = true
  } else {
    loading.value = true
  }

  try {
    const result = await imRequest<{ list: MessageItem[]; cursor: string; isLast: boolean }>({
      url: ImUrlEnum.AICLAW_CONVERSATION_MESSAGES,
      params: { uid, friendUid, pageSize: 20, cursor: cursor.value || undefined }
    })

    const newMessages = result?.list || []
    if (isLoadMore) {
      // 加载更多：插入到列表头部（消息按时间倒序，越老的在前）
      messages.value = [...newMessages.reverse(), ...messages.value]
    } else {
      // 首次加载：反转顺序（API 返回最新在前，页面显示最老在前）
      messages.value = [...newMessages].reverse()
    }

    cursor.value = result?.cursor || ''
    isLast.value = result?.isLast ?? true
  } catch (error) {
    console.error('[AiclawConversationDetail] 获取聊天记录失败:', error)
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

const fetchFriendInfo = async () => {
  try {
    // 从对话列表页的路由参数或 API 获取好友信息
    const conversations = await imRequest<{ list: Array<{ friendUid: string; friendName: string; friendAvatar: string }> }>({
      url: ImUrlEnum.AICLAW_CONVERSATIONS,
      params: { uid }
    })
    const friend = (conversations?.list || []).find((c) => String(c.friendUid) === String(friendUid))
    if (friend) {
      friendName.value = friend.friendName
      friendAvatar.value = friend.friendAvatar
    }
  } catch {
    // 静默失败
  }

  try {
    // 获取 aiclaw 头像
    const list = await imRequest<Array<{ uid: string; avatar: string }>>({ url: ImUrlEnum.AICLAW_LIST })
    const aiclaw = (list || []).find((a) => String(a.uid) === String(uid))
    if (aiclaw) {
      aiclawAvatar.value = aiclaw.avatar
    }
  } catch {
    // 静默失败
  }
}

const handleScroll = () => {
  const el = scrollContainer.value
  if (!el || loadingMore.value || isLast.value) return
  // 滚动到顶部时加载更多
  if (el.scrollTop < 50) {
    fetchMessages(true)
  }
}

onMounted(async () => {
  await Promise.all([fetchMessages(), fetchFriendInfo()])
  // 滚动到底部
  nextTick(() => {
    const el = scrollContainer.value
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  })
})
</script>
