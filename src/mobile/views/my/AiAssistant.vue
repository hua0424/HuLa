<template>
  <AutoFixHeightPage :show-footer="false">
    <template #header>
      <HeaderBar
        :isOfficial="false"
        class="bg-white"
        style="border-bottom: 1px solid; border-color: #dfdfdf"
        :hidden-right="true"
        room-name="AI助手" />
    </template>

    <template #container>
      <div class="bg-cover bg-center flex flex-col h-full">
        <!-- AI approval requests (for owners) -->
        <div v-if="pendingApprovals.length > 0" class="ai-mobile-approval-bar">
          <div v-for="req in pendingApprovals" :key="req.approvalId" class="approval-item">
            <div class="text-13px truncate flex-1">
              <span class="text-#909090">{{ req.requesterName }}:</span>
              {{ req.originalText }}
            </div>
            <div class="flex gap-8px flex-shrink-0">
              <van-button size="mini" type="success" @click="handleApprove(req.approvalId)">
                同意
              </van-button>
              <van-button size="mini" type="danger" @click="handleReject(req.approvalId)">
                拒绝
              </van-button>
            </div>
          </div>
        </div>

        <!-- Chat messages area -->
        <div class="flex-1 overflow-auto px-16px py-12px">
          <div v-if="!hasMessages" class="flex flex-col items-center justify-center h-full text-#909090">
            <svg class="size-48px mb-12px opacity-40">
              <use href="#authenticationUser"></use>
            </svg>
            <p class="text-14px">向 AI 助手发送消息开始对话</p>
          </div>
        </div>

        <!-- Input bar -->
        <div class="ai-input-bar">
          <van-field
            v-model="inputText"
            type="textarea"
            :autosize="{ minHeight: 36, maxHeight: 100 }"
            placeholder="输入消息..."
            class="flex-1"
            @keydown.enter.exact.prevent="handleSend" />
          <van-button
            type="primary"
            size="small"
            :disabled="!inputText.trim() || isSending"
            :loading="isSending"
            @click="handleSend">
            发送
          </van-button>
        </div>
      </div>
    </template>
  </AutoFixHeightPage>
</template>

<script setup lang="ts">
import { useAiChatStore } from '@/stores/aiChat'

const aiChatStore = useAiChatStore()
const { pendingApprovals } = storeToRefs(aiChatStore)

const inputText = ref('')
const isSending = ref(false)
const hasMessages = ref(false)

const handleSend = async () => {
  const text = inputText.value.trim()
  if (!text || isSending.value) return
  isSending.value = true
  inputText.value = ''
  try {
    hasMessages.value = true
  } finally {
    isSending.value = false
  }
}

const handleApprove = (approvalId: string) => {
  aiChatStore.removeApprovalRequest(approvalId)
}

const handleReject = (approvalId: string) => {
  aiChatStore.removeApprovalRequest(approvalId)
}
</script>

<style lang="scss" scoped>
.ai-mobile-approval-bar {
  border-bottom: 1px solid #eee;
  max-height: 120px;
  overflow-y: auto;

  .approval-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid #f5f5f5;

    &:last-child {
      border-bottom: none;
    }
  }
}

.ai-input-bar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid #eee;
  background: #fff;
}
</style>
