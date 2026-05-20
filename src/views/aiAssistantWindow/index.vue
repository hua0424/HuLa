<template>
  <div class="size-full flex bg-[--right-bg-color]">
    <!-- Left Panel: AI assistant list -->
    <div
      data-tauri-drag-region
      class="flex flex-col w-280px h-full bg-[--left-bg-color] border-r border-[--line-color] select-none">
      <!-- Title area (draggable) -->
      <div data-tauri-drag-region class="flex items-center justify-between px-16px pt-36px pb-12px">
        <span class="text-16px font-600 text-[--text-color]">{{ t('aiclaw.title') }}</span>
      </div>

      <!-- List -->
      <div class="flex-1 overflow-auto px-12px pb-12px">
        <template v-if="aiclawList.length > 0">
          <div
            v-for="item in aiclawList"
            :key="item.uid"
            class="flex items-center gap-10px p-10px mb-6px rounded-8px cursor-pointer transition-colors"
            :class="[
              selectedUid === item.uid
                ? 'bg-[--chat-hover-color] border-(1px dashed #13987f)'
                : 'hover:bg-[--list-hover-color] border-(1px solid transparent)'
            ]"
            @click="handleSelect(item)">
            <n-avatar round :size="36" :src="item.avatar || '/logo.png'" fallback-src="/logo.png" />
            <div class="flex flex-col flex-1 min-w-0">
              <span class="text-13px font-500 text-[--text-color] truncate">{{ item.name }}</span>
              <!-- ISS-010 A1: 主状态读 activeStatus (实时在线), authStatus 仅在非"已激活"时降级为小标签 -->
              <div class="flex items-center gap-4px mt-2px">
                <span class="text-11px" :class="onlineTextClass(item.activeStatus)">
                  {{ t(`aiclaw.status.${getOnlineKey(item.activeStatus)}`) }}
                </span>
                <span
                  v-if="item.authStatus !== 1"
                  class="text-10px px-4px py-1px rounded-3px"
                  :class="authBadgeClass(item.authStatus)">
                  {{ t(`aiclaw.auth_status.${getAuthKey(item.authStatus)}`) }}
                </span>
              </div>
            </div>
          </div>
        </template>

        <!-- Empty state -->
        <div v-else class="flex flex-col items-center justify-center h-full text-13px text-#999">
          <svg class="size-48px mb-12px opacity-20"><use href="#robot"></use></svg>
          <span>{{ t('aiclaw.empty') }}</span>
        </div>
      </div>

      <!-- Create button at bottom -->
      <div class="px-12px pb-12px">
        <n-button type="primary" block @click="showCreateForm = true">
          + {{ t('aiclaw.create.submit') }}
        </n-button>
      </div>
    </div>

    <!-- Right Panel: Detail / Empty state -->
    <div class="flex flex-col flex-1 min-w-0 border-l border-[--line-color]">
      <!-- ActionBar for window controls -->
      <ActionBar
        :shrink="false"
        :current-label="windowLabel"
        :top-win-label="windowLabel" />

      <!-- Detail content -->
      <div v-if="selectedItem && rightView === 'detail'" class="flex-1 overflow-auto">
        <!-- Top: avatar + name + status + description -->
        <div class="flex items-center gap-16px p-24px border-b border-[--line-color]">
          <n-avatar round :size="56" :src="selectedItem.avatar || '/logo.png'" fallback-src="/logo.png" />
          <div class="flex flex-col flex-1 min-w-0">
            <span class="text-18px font-600 text-[--text-color] truncate">{{ selectedItem.name }}</span>
            <span v-if="selectedItem.description" class="text-13px text-#999 mt-4px">
              {{ selectedItem.description }}
            </span>
            <div class="flex items-center gap-8px mt-6px">
              <!-- ISS-010 A1: 主状态徽章读 activeStatus (实时在线) -->
              <span
                class="text-11px font-500 px-8px py-2px rounded-4px flex items-center gap-4px"
                :class="
                  selectedItem.activeStatus === 1 ? 'bg-#18a05815 text-#18a058' : 'bg-#90909015 text-#999'
                ">
                <n-badge :color="onlineDotColor(selectedItem.activeStatus)" dot />
                {{ t(`aiclaw.status.${getOnlineKey(selectedItem.activeStatus)}`) }}
              </span>
              <!-- 二级标签: 激活生命周期 (authStatus), 仅在非"已激活"时显示, 减少视觉噪音 -->
              <span
                v-if="selectedItem.authStatus !== 1"
                class="text-11px font-500 px-8px py-2px rounded-4px"
                :class="authBadgeClass(selectedItem.authStatus)">
                {{ t(`aiclaw.auth_status.${getAuthKey(selectedItem.authStatus)}`) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Persona section -->
        <div class="p-24px border-b border-[--line-color]">
          <div class="text-14px font-500 text-[--text-color] mb-12px">{{ t('aiclaw.detail.persona') }}</div>
          <n-input
            v-model:value="personaText"
            type="textarea"
            :placeholder="t('aiclaw.detail.persona_placeholder')"
            :autosize="{ minRows: 3, maxRows: 8 }"
            :maxlength="500"
            show-count />
          <div class="flex items-center justify-between mt-10px">
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

        <!-- Feature links -->
        <div class="border-b border-[--line-color]">
          <!-- Friend management -->
          <div
            class="flex items-center justify-between px-24px py-16px cursor-pointer hover:bg-[--list-hover-color] transition-colors"
            @click="handleOpenFriends">
            <span class="text-14px text-[--text-color]">{{ t('aiclaw.detail.friends') }}</span>
            <svg class="size-16px text-#ccc"><use href="#right"></use></svg>
          </div>
          <div class="h-1px bg-[--line-color] mx-24px" />
          <!-- Conversation history -->
          <div
            class="flex items-center justify-between px-24px py-16px cursor-pointer hover:bg-[--list-hover-color] transition-colors"
            @click="handleOpenConversations">
            <span class="text-14px text-[--text-color]">{{ t('aiclaw.detail.conversations') }}</span>
            <svg class="size-16px text-#ccc"><use href="#right"></use></svg>
          </div>
          <div class="h-1px bg-[--line-color] mx-24px" />
          <!-- Group chat settings -->
          <div
            class="flex items-center justify-between px-24px py-16px cursor-pointer hover:bg-[--list-hover-color] transition-colors"
            @click="handleOpenGroupSettings">
            <span class="text-14px text-[--text-color]">{{ t('aiclaw.detail.group_settings') }}</span>
            <svg class="size-16px text-#ccc"><use href="#right"></use></svg>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="p-24px flex flex-col gap-12px">
          <!-- View activation token (only if inactive) -->
          <n-button
            v-if="selectedItem.authStatus === 0"
            type="primary"
            secondary
            block
            @click="handleViewToken(selectedItem.uid)">
            {{ t('aiclaw.token.view') }}
          </n-button>

          <!-- Regenerate activation token -->
          <n-button block secondary @click="handleViewToken(selectedItem.uid)">
            {{ t('aiclaw.token.refresh') }}
          </n-button>

          <!-- Deactivate / Delete -->
          <n-button type="error" block ghost @click="handleDelete(selectedItem)">
            {{ t('aiclaw.detail.deactivate') }}
          </n-button>
        </div>
      </div>

      <!-- F17: Conversations list view -->
      <div v-else-if="selectedItem && rightView === 'conversations'" class="flex-1 flex flex-col overflow-hidden">
        <div class="flex items-center gap-8px px-24px py-12px border-b border-[--line-color]">
          <svg class="size-18px cursor-pointer text-[--text-color] hover:text-#13987f transition-colors" @click="handleBackToDetail">
            <use href="#left"></use>
          </svg>
          <span class="text-15px font-500 text-[--text-color]">{{ t('aiclaw.detail.conversations') }}</span>
        </div>
        <div class="flex-1 overflow-auto">
          <template v-if="conversationList.length > 0">
            <div
              v-for="item in conversationList"
              :key="item.friendUid"
              class="flex items-center gap-12px px-24px py-14px cursor-pointer hover:bg-[--list-hover-color] transition-colors border-b border-[--line-color]"
              @click="handleOpenConversationDetail(item)">
              <n-avatar round :size="40" :src="item.friendAvatar || '/logo.png'" fallback-src="/logo.png" />
              <div class="flex flex-col flex-1 min-w-0">
                <div class="flex items-center justify-between">
                  <span class="text-14px font-500 text-[--text-color] truncate">{{ item.friendName }}</span>
                  <span class="text-11px text-#bbb flex-shrink-0">{{ formatConversationTime(item.lastMessage?.sendTime) }}</span>
                </div>
                <span class="text-12px text-#999 mt-2px truncate">{{ item.lastMessage?.content || '' }}</span>
              </div>
            </div>
          </template>
          <div v-else-if="!conversationLoading" class="flex flex-col items-center justify-center h-full text-13px text-#999">
            <svg class="size-48px mb-12px opacity-20"><use href="#robot"></use></svg>
            <span>{{ t('aiclaw.conversations.empty') }}</span>
          </div>
          <div v-if="conversationLoading" class="flex justify-center py-20px">
            <n-spin size="medium" />
          </div>
        </div>
      </div>

      <!-- F17: Conversation messages view -->
      <div v-else-if="selectedItem && rightView === 'conversationMessages'" class="flex-1 flex flex-col overflow-hidden">
        <div class="flex items-center gap-8px px-24px py-12px border-b border-[--line-color]">
          <svg class="size-18px cursor-pointer text-[--text-color] hover:text-#13987f transition-colors" @click="handleBackToConversations">
            <use href="#left"></use>
          </svg>
          <span class="text-15px font-500 text-[--text-color]">{{ viewingFriendName }}</span>
        </div>
        <div ref="messagesScrollContainer" class="flex-1 overflow-auto px-16px py-12px" @scroll="handleMessagesScroll">
          <div v-if="messagesLoadingMore" class="flex justify-center py-8px">
            <n-spin size="small" />
          </div>
          <div v-if="messagesIsLast && conversationMessages.length > 0" class="text-center text-11px text-#ccc py-8px">
            {{ t('aiclaw.conversations.no_more') }}
          </div>
          <div v-for="msg in conversationMessages" :key="msg.message.id" class="py-4px">
            <div class="flex" :class="isAiclawMessage(msg) ? 'justify-start' : 'justify-end'">
              <div class="flex gap-8px max-w-70%" :class="isAiclawMessage(msg) ? '' : 'flex-row-reverse'">
                <n-avatar
                  round
                  :size="28"
                  :src="isAiclawMessage(msg) ? (selectedItem?.avatar || '/logo.png') : viewingFriendAvatar"
                  fallback-src="/logo.png"
                  class="flex-shrink-0" />
                <div
                  class="px-12px py-8px rounded-8px text-13px break-all"
                  :class="isAiclawMessage(msg)
                    ? 'bg-[--left-bg-color] text-[--text-color]'
                    : 'bg-#13987f20 text-[--text-color]'">
                  {{ msg.message.body?.content || '' }}
                </div>
              </div>
            </div>
          </div>
          <div v-if="messagesLoading" class="flex justify-center py-20px">
            <n-spin size="medium" />
          </div>
          <div v-if="!messagesLoading && conversationMessages.length === 0" class="flex flex-col items-center justify-center h-full text-13px text-#999">
            <span>{{ t('aiclaw.conversations.empty') }}</span>
          </div>
        </div>
      </div>

      <!-- F18: Friends management view -->
      <div v-else-if="selectedItem && rightView === 'friends'" class="flex-1 flex flex-col overflow-hidden">
        <div class="flex items-center gap-8px px-24px py-12px border-b border-[--line-color]">
          <svg class="size-18px cursor-pointer text-[--text-color] hover:text-#13987f transition-colors" @click="handleBackToDetail">
            <use href="#left"></use>
          </svg>
          <span class="text-15px font-500 text-[--text-color]">{{ t('aiclaw.detail.friends') }}</span>
        </div>
        <div class="flex-1 overflow-auto">
          <template v-if="friendList.length > 0">
            <div
              v-for="item in friendList"
              :key="item.uid"
              class="flex items-center gap-12px px-24px py-14px border-b border-[--line-color]">
              <n-avatar round :size="40" :src="item.avatar || '/logo.png'" fallback-src="/logo.png" />
              <div class="flex flex-col flex-1 min-w-0">
                <span class="text-14px font-500 text-[--text-color] truncate">{{ item.name }}</span>
                <span v-if="item.relationDesc" class="text-12px text-#999 mt-2px truncate">{{ item.relationDesc }}</span>
                <span v-else class="text-12px text-#ccc mt-2px italic">{{ t('aiclaw.friends.relation') }}</span>
              </div>
              <div class="flex items-center gap-6px flex-shrink-0">
                <n-button size="tiny" secondary @click="handleEditRelation(item)">
                  {{ t('aiclaw.friends.relation_edit') }}
                </n-button>
                <n-button size="tiny" type="error" quaternary @click="handleRemoveFriend(item)">
                  {{ t('aiclaw.friends.remove') }}
                </n-button>
              </div>
            </div>
          </template>
          <div v-else-if="!friendLoading" class="flex flex-col items-center justify-center h-full text-13px text-#999">
            <svg class="size-48px mb-12px opacity-20"><use href="#robot"></use></svg>
            <span>{{ t('aiclaw.friends.empty') }}</span>
          </div>
          <div v-if="friendLoading" class="flex justify-center py-20px">
            <n-spin size="medium" />
          </div>
        </div>
      </div>

      <!-- REQ-004: Group settings view -->
      <div v-else-if="selectedItem && rightView === 'groupSettings'" class="flex-1 flex flex-col overflow-hidden">
        <div class="flex items-center gap-8px px-24px py-12px border-b border-[--line-color]">
          <svg class="size-18px cursor-pointer text-[--text-color] hover:text-#13987f transition-colors" @click="handleBackToDetail">
            <use href="#left"></use>
          </svg>
          <span class="text-15px font-500 text-[--text-color]">{{ t('aiclaw.group_settings.title') }}</span>
        </div>
        <div class="flex-1 overflow-auto">
          <template v-if="groupConfigList.length > 0">
            <div
              v-for="config in groupConfigList"
              :key="config.roomId"
              class="border-b border-[--line-color] px-24px py-16px">
              <div class="flex items-center justify-between mb-12px">
                <span class="text-14px font-500 text-[--text-color]">{{ config.roomName || `Group ${config.roomId}` }}</span>
              </div>
              <!-- Config form -->
              <n-form label-placement="left" label-width="auto" size="small" :show-feedback="false">
                <n-form-item :label="t('aiclaw.group_settings.rate_limit')" class="mb-12px">
                  <n-input-number v-model:value="config.rateLimitPerMinute" :min="0" :max="100" size="small" style="width: 100px" />
                  <span class="text-11px text-#999 ml-8px">{{ t('aiclaw.group_settings.rate_limit_hint') }}</span>
                </n-form-item>
                <n-form-item :label="t('aiclaw.group_settings.daily_limit')" class="mb-12px">
                  <n-input-number v-model:value="config.dailyLimit" :min="0" :max="10000" size="small" style="width: 100px" />
                </n-form-item>
                <n-form-item :label="t('aiclaw.group_settings.respond_to_ai')" class="mb-12px">
                  <n-switch v-model:value="config.respondToAi" />
                </n-form-item>
                <n-form-item :label="t('aiclaw.group_settings.mention_required')" class="mb-12px">
                  <n-switch v-model:value="config.mentionRequired" />
                  <span class="text-11px text-#999 ml-8px">{{ t('aiclaw.group_settings.mention_required_hint') }}</span>
                </n-form-item>
              </n-form>
              <n-button
                size="small"
                type="primary"
                :loading="savingGroupConfig === config.roomId"
                @click="handleSaveGroupConfig(config)">
                {{ t('aiclaw.group_settings.save') }}
              </n-button>
            </div>
          </template>
          <div v-else-if="!groupConfigLoading" class="flex flex-col items-center justify-center h-full text-13px text-#999">
            <svg class="size-48px mb-12px opacity-20"><use href="#robot"></use></svg>
            <span>{{ t('aiclaw.group_settings.empty') }}</span>
          </div>
          <div v-if="groupConfigLoading" class="flex justify-center py-20px">
            <n-spin size="medium" />
          </div>
        </div>
      </div>

      <!-- Empty state when nothing selected -->
      <div v-else class="flex-1 flex flex-col items-center justify-center text-#999">
        <svg class="size-80px mb-16px opacity-15"><use href="#robot"></use></svg>
        <span class="text-15px">{{ t('aiclaw.detail.select_hint') }}</span>
      </div>
    </div>

    <!-- Create form dialog -->
    <AiclawCreateForm v-model:visible="showCreateForm" @created="onCreated" />

    <!-- Token dialog -->
    <AiclawTokenDialog
      v-model:visible="showTokenDialog"
      :token="createdToken"
      :uid="viewingUid"
      @refreshed="fetchList" />

    <!-- Delete confirm dialog -->
    <AiclawDeleteConfirmDialog
      v-model:visible="showDeleteDialog"
      @confirm="handleDeleteConfirm" />

    <!-- F18: Relation edit dialog -->
    <n-modal v-model:show="showRelationDialog" preset="dialog" :show-icon="false" :closable="true" :mask-closable="false">
      <template #header>
        <span class="text-16px font-600">{{ t('aiclaw.friends.relation_edit') }}</span>
      </template>
      <div class="py-8px">
        <n-input
          v-model:value="relationInput"
          type="textarea"
          :placeholder="t('aiclaw.friends.relation_placeholder')"
          :maxlength="200"
          :autosize="{ minRows: 2, maxRows: 5 }"
          show-count />
      </div>
      <template #action>
        <n-button @click="showRelationDialog = false">{{ t('aiclaw.delete.cancel') }}</n-button>
        <n-button type="primary" :loading="savingRelation" @click="handleSaveRelation">
          {{ t('aiclaw.detail.persona_save') }}
        </n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ActionBar from '@/components/windows/ActionBar.vue'
import AiclawCreateForm from '@/components/aiclaw/AiclawCreateForm.vue'
import AiclawTokenDialog from '@/components/aiclaw/AiclawTokenDialog.vue'
import AiclawDeleteConfirmDialog from '@/components/aiclaw/AiclawDeleteConfirmDialog.vue'
import { ImUrlEnum } from '@/enums'
import { imRequest, imRequestSilent } from '@/utils/ImRequestUtils'
import { isWeb } from '@/utils/PlatformConstants'
import { useChatStore } from '@/stores/chat'

const { t } = useI18n()

// Window label for ActionBar (matches the url used in config.tsx)
const windowLabel = ref('aiAssistant')

type AiclawListItem = {
  uid: string
  name: string
  avatar: string
  description: string
  /** 激活生命周期(authStatus, 来自 im_aiclaw.auth_status): 0=未激活 / 1=已激活 / 2=已停用 */
  authStatus: number
  /**
   * 运行时在线状态(activeStatus, 来自 Redis ZSET, ISS-010 A1 后端 PR #7 新增):
   * OnlineEnum.ONLINE=1 / OFFLINE=2; 后端老版本无此字段时为 undefined,前端统一按离线处理
   */
  activeStatus?: number
  adapterType: string
  publicPersona: string | null
  createTime: number
}

type ConversationItem = {
  friendUid: string
  friendName: string
  friendAvatar: string
  lastMessage: { content: string; sendTime: number; type: number } | null
  roomId: string
}

type ConversationMessageItem = {
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

type AiclawFriendItem = {
  uid: string
  name: string
  avatar: string
  account: string
  activeStatus: number
  userType: number
  relationDesc: string | null
}

type RightView = 'detail' | 'conversations' | 'conversationMessages' | 'friends' | 'groupSettings'

const showCreateForm = ref(false)
const showTokenDialog = ref(false)
const showDeleteDialog = ref(false)
const createdToken = ref('')
const viewingUid = ref('')
const deletingUid = ref('')
const aiclawList = ref<AiclawListItem[]>([])
const selectedUid = ref<string | null>(null)

// Persona editing state
const personaText = ref('')
const originalPersona = ref('')
const savingPersona = ref(false)

// 右面板视图状态
const rightView = ref<RightView>('detail')

// F17 对话记录状态
const conversationList = ref<ConversationItem[]>([])
const conversationLoading = ref(false)
const conversationMessages = ref<ConversationMessageItem[]>([])
const messagesLoading = ref(false)
const messagesLoadingMore = ref(false)
const messagesIsLast = ref(false)
const messagesCursor = ref('')
const viewingFriendUid = ref('')
const viewingFriendName = ref('')
const viewingFriendAvatar = ref('')
const messagesScrollContainer = ref<HTMLElement | null>(null)

// F18 好友管理状态
const friendList = ref<AiclawFriendItem[]>([])
const friendLoading = ref(false)
const showRelationDialog = ref(false)
const relationInput = ref('')
const savingRelation = ref(false)
const editingFriendUid = ref('')

// REQ-004 群聊配置状态
const groupConfigLoading = ref(false)
const savingGroupConfig = ref<string | null>(null) // roomId being saved
const groupConfigList = ref<(import('@/services/wsType').AiclawGroupConfig & { roomId: string; roomName?: string })[]>([])

const chatStore = useChatStore()

// ISS-010 A1: 两个数据源分离
// - activeStatus: 运行时在线状态 (Redis ZSET, 实时), 对应 i18n key `aiclaw.status.online/offline`
// - authStatus:    激活生命周期 (im_aiclaw.auth_status 列), 对应 i18n key `aiclaw.auth_status.*`
const authStatusMap: Record<number, 'inactive' | 'activated' | 'deactivated'> = {
  0: 'inactive',
  1: 'activated',
  2: 'deactivated'
}

const getOnlineKey = (activeStatus?: number): 'online' | 'offline' =>
  activeStatus === 1 ? 'online' : 'offline'

const getAuthKey = (authStatus?: number): 'inactive' | 'activated' | 'deactivated' =>
  authStatusMap[authStatus ?? 0] || 'inactive'

const selectedItem = computed(() => aiclawList.value.find((item) => item.uid === selectedUid.value) || null)

const personaDirty = computed(() => personaText.value !== originalPersona.value)

const onlineTextClass = (activeStatus?: number) =>
  activeStatus === 1 ? 'text-#18a058' : 'text-#999'

const onlineDotColor = (activeStatus?: number) =>
  activeStatus === 1 ? '#18a058' : '#909090'

// authStatus 二级标签的色彩: 未激活 / 已停用 走灰/红, 已激活省略不显示 (主在线状态已足够表达)
const authBadgeClass = (authStatus?: number) => {
  if (authStatus === 2) return 'bg-#d0305015 text-#d03050'
  return 'bg-#90909015 text-#999'
}

const fetchList = async () => {
  const list = await imRequestSilent<AiclawListItem[]>({ url: ImUrlEnum.AICLAW_LIST })
  aiclawList.value = list || []
}

const handleSelect = (item: AiclawListItem) => {
  selectedUid.value = item.uid
  personaText.value = item.publicPersona || ''
  originalPersona.value = item.publicPersona || ''
  rightView.value = 'detail'
}

const handleSavePersona = async () => {
  if (!selectedUid.value) return
  savingPersona.value = true
  try {
    await imRequest({
      url: ImUrlEnum.AICLAW_SET_PERSONA,
      params: { uid: selectedUid.value },
      body: { publicPersona: personaText.value }
    })
    originalPersona.value = personaText.value
    // Update the item in the list so it persists if user switches
    const item = aiclawList.value.find((a) => a.uid === selectedUid.value)
    if (item) {
      item.publicPersona = personaText.value
    }
    window.$message?.success?.(t('aiclaw.detail.persona_save_success'))
  } catch (error) {
    console.error('[AiAssistant] Failed to save persona:', error)
  } finally {
    savingPersona.value = false
  }
}

// 时间格式化
const formatConversationTime = (timestamp?: number) => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    return t('aiclaw.conversations.yesterday') || '昨天'
  }
  return `${date.getMonth() + 1}/${date.getDate()}`
}

// F17: 获取对话列表
const fetchConversations = async () => {
  if (!selectedUid.value) return
  conversationLoading.value = true
  try {
    const result = await imRequest<{ list: ConversationItem[] }>({
      url: ImUrlEnum.AICLAW_CONVERSATIONS,
      params: { uid: selectedUid.value }
    })
    conversationList.value = result?.list || []
  } catch (error) {
    console.error('[AiAssistant] Failed to fetch conversations:', error)
  } finally {
    conversationLoading.value = false
  }
}

// F17: 获取聊天记录
const fetchConversationMessages = async (isLoadMore = false) => {
  if (!selectedUid.value || !viewingFriendUid.value) return
  if (isLoadMore) {
    messagesLoadingMore.value = true
  } else {
    messagesLoading.value = true
  }
  try {
    const result = await imRequest<{ list: ConversationMessageItem[]; cursor: string; isLast: boolean }>({
      url: ImUrlEnum.AICLAW_CONVERSATION_MESSAGES,
      params: {
        uid: selectedUid.value,
        friendUid: viewingFriendUid.value,
        pageSize: 20,
        cursor: messagesCursor.value || undefined
      }
    })
    const newMessages = result?.list || []
    if (isLoadMore) {
      conversationMessages.value = [...newMessages.reverse(), ...conversationMessages.value]
    } else {
      conversationMessages.value = [...newMessages].reverse()
    }
    messagesCursor.value = result?.cursor || ''
    messagesIsLast.value = result?.isLast ?? true
  } catch (error) {
    console.error('[AiAssistant] Failed to fetch messages:', error)
  } finally {
    messagesLoading.value = false
    messagesLoadingMore.value = false
  }
}

const isAiclawMessage = (msg: ConversationMessageItem) => String(msg.fromUser.uid) === String(selectedUid.value)

const handleMessagesScroll = () => {
  const el = messagesScrollContainer.value
  if (!el || messagesLoadingMore.value || messagesIsLast.value) return
  if (el.scrollTop < 50) {
    fetchConversationMessages(true)
  }
}

// F18: 获取好友列表
const fetchFriends = async () => {
  if (!selectedUid.value) return
  friendLoading.value = true
  try {
    const result = await imRequest<AiclawFriendItem[]>({
      url: ImUrlEnum.AICLAW_FRIENDS,
      params: { uid: selectedUid.value }
    })
    friendList.value = result || []
  } catch (error) {
    console.error('[AiAssistant] Failed to fetch friends:', error)
  } finally {
    friendLoading.value = false
  }
}

// F18: 编辑关系说明
const handleEditRelation = (item: AiclawFriendItem) => {
  editingFriendUid.value = item.uid
  relationInput.value = item.relationDesc || ''
  showRelationDialog.value = true
}

const handleSaveRelation = async () => {
  if (!selectedUid.value) return
  savingRelation.value = true
  try {
    await imRequest({
      url: ImUrlEnum.AICLAW_SET_RELATION,
      params: { uid: selectedUid.value, friendUid: editingFriendUid.value },
      body: { relationDesc: relationInput.value }
    })
    const friend = friendList.value.find((f) => f.uid === editingFriendUid.value)
    if (friend) {
      friend.relationDesc = relationInput.value || null
    }
    showRelationDialog.value = false
    window.$message?.success?.(t('aiclaw.friends.relation_save_success'))
  } catch (error) {
    console.error('[AiAssistant] Failed to save relation:', error)
  } finally {
    savingRelation.value = false
  }
}

// F18: 移除好友
const handleRemoveFriend = (item: AiclawFriendItem) => {
  window.$dialog?.warning({
    title: t('aiclaw.friends.remove'),
    content: t('aiclaw.friends.remove_confirm'),
    positiveText: t('aiclaw.delete.confirm'),
    negativeText: t('aiclaw.delete.cancel'),
    onPositiveClick: async () => {
      try {
        await imRequest({
          url: ImUrlEnum.AICLAW_REMOVE_FRIEND,
          params: { uid: selectedUid.value!, friendUid: item.uid }
        })
        friendList.value = friendList.value.filter((f) => f.uid !== item.uid)
        window.$message?.success?.(t('aiclaw.friends.remove_success'))
      } catch (error) {
        console.error('[AiAssistant] Failed to remove friend:', error)
      }
    }
  })
}

// 视图导航
const handleOpenFriends = () => {
  if (!selectedUid.value) return
  rightView.value = 'friends'
  fetchFriends()
}

const handleOpenConversations = () => {
  if (!selectedUid.value) return
  rightView.value = 'conversations'
  fetchConversations()
}

const handleOpenConversationDetail = (item: ConversationItem) => {
  viewingFriendUid.value = item.friendUid
  viewingFriendName.value = item.friendName
  viewingFriendAvatar.value = item.friendAvatar
  messagesCursor.value = ''
  messagesIsLast.value = false
  conversationMessages.value = []
  rightView.value = 'conversationMessages'
  fetchConversationMessages().then(() => {
    nextTick(() => {
      const el = messagesScrollContainer.value
      if (el) el.scrollTop = el.scrollHeight
    })
  })
}

const handleBackToDetail = () => {
  rightView.value = 'detail'
}

// REQ-004: 群聊配置
const handleOpenGroupSettings = async () => {
  if (!selectedUid.value) return
  rightView.value = 'groupSettings'
  groupConfigLoading.value = true
  try {
    await chatStore.loadAiclawGroupConfigs(Number(selectedUid.value))
    groupConfigList.value = chatStore.getAiclawGroupConfigList(Number(selectedUid.value))
  } catch (error) {
    console.error('[AiAssistant] Failed to load group configs:', error)
  } finally {
    groupConfigLoading.value = false
  }
}

const handleSaveGroupConfig = async (config: (import('@/services/wsType').AiclawGroupConfig & { roomId: string; roomName?: string })) => {
  if (!selectedUid.value) return
  savingGroupConfig.value = config.roomId
  try {
    await chatStore.saveAiclawGroupConfig(Number(selectedUid.value), config.roomId, {
      rateLimitPerMinute: config.rateLimitPerMinute,
      dailyLimit: config.dailyLimit,
      respondToAi: config.respondToAi,
      mentionRequired: config.mentionRequired
    })
    window.$message?.success?.(t('aiclaw.group_settings.save_success'))
  } catch (error) {
    console.error('[AiAssistant] Failed to save group config:', error)
    window.$message?.error?.(t('aiclaw.group_settings.save_failed'))
  } finally {
    savingGroupConfig.value = null
  }
}

const handleBackToConversations = () => {
  rightView.value = 'conversations'
}

const onCreated = (data: { uid: string; activationToken: string }) => {
  createdToken.value = data.activationToken
  viewingUid.value = ''
  showTokenDialog.value = true
  fetchList()
}

const handleViewToken = (uid: string) => {
  createdToken.value = ''
  viewingUid.value = uid
  showTokenDialog.value = true
}

const handleDelete = (item: AiclawListItem) => {
  deletingUid.value = item.uid
  showDeleteDialog.value = true
}

const handleDeleteConfirm = async (password: string) => {
  try {
    await imRequest({
      url: ImUrlEnum.AICLAW_DEACTIVATE,
      params: { uid: deletingUid.value },
      body: { password }
    })
    window.$message?.success?.(t('aiclaw.detail.deactivated_success'))
    showDeleteDialog.value = false
    // If the deleted item was selected, clear selection
    if (selectedUid.value === deletingUid.value) {
      selectedUid.value = null
      personaText.value = ''
      originalPersona.value = ''
    }
    fetchList()
  } catch (error) {
    console.error('[AiAssistant] Failed to deactivate:', error)
  }
}

onMounted(async () => {
  // Resolve the actual window label at runtime
  if (!isWeb()) {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      const win = getCurrentWebviewWindow()
      windowLabel.value = win.label
      await win.show()
    } catch {
      // Fallback to default label
    }
  }
  fetchList()
})
</script>
