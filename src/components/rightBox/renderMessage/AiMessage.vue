<template>
  <div :class="isMobile() ? 'text-16px' : 'text-14px'" class="ai-message-content">
    <!-- AI badge indicator -->
    <div v-if="isStreaming" class="flex items-center gap-4px mb-4px">
      <span class="ai-typing-indicator">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </span>
    </div>
    <!-- Rendered content with markdown-like rendering -->
    <div class="whitespace-pre-wrap break-words">{{ displayContent }}</div>
    <!-- Streaming status -->
    <div v-if="isStreaming" class="text-(11px #909090) mt-4px select-none">
      AI is responding...
    </div>
  </div>
</template>

<script setup lang="ts">
import { isMobile } from '@/utils/PlatformConstants'

const props = defineProps<{
  body: {
    content: string
    aiStreaming?: boolean
  }
}>()

const isStreaming = computed(() => !!props.body.aiStreaming)
const displayContent = computed(() => props.body.content || '')
</script>

<style scoped lang="scss">
.ai-message-content {
  position: relative;
}

.ai-typing-indicator {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 0;

  .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background-color: #13987f;
    animation: ai-dot-pulse 1.4s infinite ease-in-out;

    &:nth-child(2) {
      animation-delay: 0.2s;
    }

    &:nth-child(3) {
      animation-delay: 0.4s;
    }
  }
}

@keyframes ai-dot-pulse {
  0%,
  80%,
  100% {
    opacity: 0.3;
    transform: scale(0.8);
  }

  40% {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
