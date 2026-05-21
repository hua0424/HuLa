<template>
  <div
    class="thinking-card rounded-8px border border-#7c5cfc20 overflow-hidden transition-all duration-200"
    :class="cardBgClass">
    <!-- 头部：头像 + 名称 + 状态 -->
    <div
      class="flex items-center gap-8px px-12px py-8px"
      :class="{ 'cursor-pointer': !readonly }"
      @click="!readonly && emit('toggle-collapse')">
      <n-avatar :size="20" :src="thinking.aiclawAvatar || '/logo.png'" fallback-src="/logo.png" round />
      <span class="text-(12px font-500) text-#333 dark:text-[--text-color] truncate">
        {{ thinking.aiclawName }}
      </span>
      <!-- 状态徽章 -->
      <span v-if="thinking.status === 'thinking'" class="flex items-center gap-4px text-(11px #7c5cfc)">
        <span class="thinking-dot size-6px rounded-50% bg-#7c5cfc animate-pulse" />
        {{ t('aiclaw.thinking.status.thinking') }}
      </span>
      <span v-else-if="thinking.status === 'complete'" class="text-(11px #13987f)">
        {{ t('aiclaw.thinking.status.complete', { duration: formattedDuration }) }}
      </span>
      <span v-else-if="thinking.status === 'error'" class="text-(11px [--danger-text])">
        {{ thinking.errorMsg || t('aiclaw.thinking.status.error') }}
      </span>
      <!-- 展开/收起图标（仅非归档模式） -->
      <svg
        v-if="!readonly"
        class="size-12px ml-auto text-#999 transition-transform duration-200"
        :class="{ 'rotate-180': !thinking.collapsed }">
        <use href="#down" />
      </svg>
    </div>

    <!-- 内容区（可折叠） -->
    <Transition name="thinking-collapse">
      <div v-if="!thinking.collapsed || readonly" class="px-12px pb-8px">
        <div
          ref="contentRef"
          class="thinking-content text-(12px #666 dark:#aaa) whitespace-pre-wrap break-words overflow-y-auto"
          :style="{ maxHeight: readonly ? '200px' : '120px' }">
          <template v-if="thinking.content">
            {{ thinking.content }}
          </template>
          <template v-else-if="thinking.status === 'thinking'">
            {{ t('aiclaw.thinking.waiting') }}
          </template>
          <!-- 流式光标 -->
          <span v-if="thinking.status === 'thinking'" class="streaming-cursor" />
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ThinkingState } from '@/types/thinking'

const props = defineProps<{
  thinking: ThinkingState
  readonly?: boolean
}>()

const emit = defineEmits<{
  'toggle-collapse': []
}>()

const { t } = useI18n()
const contentRef = ref<HTMLElement>()

// 格式化耗时
const formattedDuration = computed(() => {
  if (!props.thinking.durationMs) return ''
  const seconds = (props.thinking.durationMs / 1000).toFixed(1)
  return `${seconds}s`
})

// 背景颜色（根据状态）
const cardBgClass = computed(() => {
  if (props.thinking.status === 'error') {
    return 'bg-#e74c3c08 border-#e74c3c20'
  }
  return 'bg-#7c5cfc08'
})

// 流式内容自动滚动到底部
watch(
  () => props.thinking.content,
  () => {
    if (contentRef.value && !props.thinking.collapsed) {
      nextTick(() => {
        if (contentRef.value) {
          contentRef.value.scrollTop = contentRef.value.scrollHeight
        }
      })
    }
  }
)
</script>

<style scoped>
.thinking-dot {
  animation: thinking-pulse 1.5s ease-in-out infinite;
}

@keyframes thinking-pulse {
  0%,
  100% {
    opacity: 0.4;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1.2);
  }
}

.streaming-cursor {
  display: inline-block;
  width: 2px;
  height: 14px;
  background: #7c5cfc;
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: cursor-blink 1s step-end infinite;
}

@keyframes cursor-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

/* 折叠过渡 */
.thinking-collapse-enter-active,
.thinking-collapse-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.thinking-collapse-enter-from,
.thinking-collapse-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}
</style>
