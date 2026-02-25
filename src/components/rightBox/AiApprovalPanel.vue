<template>
  <div v-if="pendingApprovals.length > 0" class="ai-approval-panel">
    <div class="ai-approval-header">
      <n-flex align="center" :size="6">
        <svg class="size-16px color-#fbb990">
          <use href="#shield-check"></use>
        </svg>
        <span class="text-(13px [--text-color]) font-500">
          AI {{ t('home.ai_approval.title', 'Approval Requests') }}
        </span>
        <n-badge :value="pendingApprovals.length" :max="99" />
      </n-flex>
    </div>

    <div class="ai-approval-list">
      <div
        v-for="request in pendingApprovals"
        :key="request.approvalId"
        class="ai-approval-item">
        <n-flex vertical :size="6" class="flex-1">
          <n-flex align="center" :size="4">
            <span class="text-(12px #909090)">{{ request.requesterName }}</span>
            <span class="text-(11px #909090)">{{ formatTime(request.timestamp) }}</span>
          </n-flex>
          <p class="text-(13px [--text-color]) line-clamp-2">{{ request.originalText }}</p>
        </n-flex>
        <n-flex :size="6" class="mt-6px">
          <n-button size="tiny" type="success" @click="handleApprove(request.approvalId)">
            {{ t('home.ai_approval.approve', 'Approve') }}
          </n-button>
          <n-button size="tiny" type="error" @click="handleReject(request.approvalId)">
            {{ t('home.ai_approval.reject', 'Reject') }}
          </n-button>
        </n-flex>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useAiChatStore } from '@/stores/aiChat'
import { imRequest } from '@/utils/ImRequestUtils'
import { ImUrlEnum } from '@/enums'

const { t } = useI18n()
const aiChatStore = useAiChatStore()
const { pendingApprovals } = storeToRefs(aiChatStore)

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
}

const handleApprove = async (approvalId: string) => {
  try {
    await imRequest({
      url: ImUrlEnum.SEND_MSG,
      body: {
        type: 'ai_approval_decision',
        approvalId,
        decision: 'approve'
      }
    })
    aiChatStore.removeApprovalRequest(approvalId)
  } catch (error) {
    console.error('[AI] Failed to approve request:', error)
  }
}

const handleReject = async (approvalId: string) => {
  try {
    await imRequest({
      url: ImUrlEnum.SEND_MSG,
      body: {
        type: 'ai_approval_decision',
        approvalId,
        decision: 'reject'
      }
    })
    aiChatStore.removeApprovalRequest(approvalId)
  } catch (error) {
    console.error('[AI] Failed to reject request:', error)
  }
}
</script>

<style scoped lang="scss">
.ai-approval-panel {
  border-bottom: 1px solid var(--right-chat-footer-line-color);
  background: var(--right-bg-color);
}

.ai-approval-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--right-chat-footer-line-color);
}

.ai-approval-list {
  max-height: 200px;
  overflow-y: auto;
}

.ai-approval-item {
  padding: 8px 12px;
  border-bottom: 1px solid var(--right-chat-footer-line-color);

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: rgba(0, 0, 0, 0.02);
  }
}
</style>
