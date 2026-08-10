<template>
  <template v-if="shouldRender">
    <div
      ref="cardRoot"
      class="inline-thinking-card w-full rounded-8px border border-#7c5cfc20 overflow-hidden transition-all duration-200"
      :class="cardBgClass">
      <!-- 头部：头像 + 名称 + 状态 -->
      <div
        class="flex items-center gap-8px px-12px py-8px"
        :class="{ 'cursor-pointer': isExpandable }"
        @click="isExpandable && toggleExpand()">
        <n-avatar :size="20" :src="thinking.aiclawAvatar || '/logo.png'" fallback-src="/logo.png" round />
        <span class="text-(12px font-500) text-#333 dark:text-[--text-color] truncate">
          {{ thinking.aiclawName }}
        </span>
        <!-- 状态徽章 -->
        <span
          v-if="thinking.status === 'thinking'"
          data-testid="typing-status"
          aria-label="回复状态"
          class="flex items-center gap-4px text-(11px #7c5cfc)">
          <span class="thinking-dot size-6px rounded-50% bg-#7c5cfc animate-pulse" />
          {{ t('aiclaw.thinking.status.thinking') }}
        </span>
        <span v-else-if="thinking.status === 'complete'" class="text-(11px #13987f)">
          {{ t('aiclaw.thinking.status.complete', { duration: formattedDuration }) }}
        </span>
        <span v-else-if="thinking.status === 'error'" class="text-(11px [--danger-text])">
          {{ thinking.errorMsg || t('aiclaw.thinking.status.error') }}
        </span>
        <!-- 展开/收起图标（默认展开，点击收起） -->
        <svg
          v-if="isExpandable"
          class="size-12px ml-auto text-#999 transition-transform duration-200"
          :class="{ 'rotate-180': expanded }">
          <use href="#down" />
        </svg>
      </div>

      <!-- 内容区：仅在“显示思考过程”开启，或当前是 thinking 单行占位时渲染 -->
      <Transition name="thinking-collapse">
        <div v-if="showContent" class="px-12px pb-8px">
          <!-- 已完成：入视野自动拉取完整思考内容 -->
          <template v-if="thinking.status === 'complete'">
            <div v-if="reviewLoading" class="text-(12px #999)">
              {{ t('aiclaw.thinking.review_loading') }}
            </div>
            <div
              v-else-if="reviewError"
              data-testid="thinking-review-error"
              class="text-(12px [--danger-text]) cursor-pointer hover:underline"
              @click="loadReview">
              {{ t('aiclaw.thinking.review_error') }}
            </div>
            <template v-else-if="reviewLoaded">
              <!-- REQ-015 #187：内容随卡高自然展开，无内滚动；长文截断前段 + 查看全文 -->
              <!-- select-text：message-list 全局禁选，思考内容对齐气泡显式放开选中复制 -->
              <div class="thinking-content select-text text-(12px #666 dark:#aaa) whitespace-pre-wrap break-words">
                {{ displayContent }}
              </div>
              <button
                v-if="needsTruncation && !showFull"
                type="button"
                data-testid="thinking-view-full"
                aria-label="查看全文"
                class="mt-4px text-(11px #7c5cfc) bg-transparent border-none cursor-pointer p-0 hover:underline"
                @click="showFull = true">
                {{ t('aiclaw.thinking.view_full') }}
              </button>
              <div v-if="reviewTruncated" data-testid="thinking-truncated-hint" class="mt-4px text-(11px #e6a23c)">
                {{ t('aiclaw.thinking.truncated') }}
              </div>
            </template>
          </template>
          <!-- 思考中 / 错误：仅显示占位，不展示流式内容 -->
          <div v-else class="thinking-content select-text text-(12px #666 dark:#aaa) whitespace-pre-wrap break-words">
            <template v-if="thinking.status === 'thinking'">
              {{ t('aiclaw.thinking.waiting') }}
            </template>
          </div>
        </div>
      </Transition>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ImUrlEnum } from '@/enums'
import { imRequest } from '@/utils/ImRequestUtils'
import { useSettingStore } from '@/stores/setting'
import type { ThinkingState } from '@/types/thinking'

const props = defineProps<{
  thinking: ThinkingState
}>()

const { t } = useI18n()
const settingStore = useSettingStore()

/** REQ-015 #187：长文截断阈值（实现时可调） */
const TRUNCATE_THRESHOLD = 4000

// “显示思考过程”全局开关：关闭时只保留 thinking 的单行状态
const showThinkingProcess = computed(() => settingStore.chat?.showThinking ?? true)

// 开关关闭时：只渲染 thinking 状态的单行状态；其余状态隐藏
const shouldRender = computed(() => showThinkingProcess.value || thinking.status === 'thinking')

// REQ-015 #187：默认展开；头部点击手动折叠/展开
const expanded = ref(true)
const toggleExpand = () => {
  expanded.value = !expanded.value
}

const isExpandable = computed(() => showThinkingProcess.value)

// 内容区可见性：
// - 开关关闭：隐藏内容区，仅保留头部单行状态
// - 开关打开：默认展开，可手动折叠
const showContent = computed(() => {
  if (!showThinkingProcess.value) return false
  return expanded.value
})

// 回顾态：按需拉取的完整思考内容
const reviewLoading = ref(false)
const reviewLoaded = ref(false)
const reviewError = ref(false)
const reviewContent = ref('')
const reviewTruncated = ref(false)

// REQ-015 #187：长文截断（前段 + 查看全文；完整内容来自 detail 接口）
const showFull = ref(false)
const needsTruncation = computed(() => reviewContent.value.length > TRUNCATE_THRESHOLD)
const displayContent = computed(() =>
  needsTruncation.value && !showFull.value ? reviewContent.value.slice(0, TRUNCATE_THRESHOLD) : reviewContent.value
)

const thinking = props.thinking

// 格式化耗时
const formattedDuration = computed(() => {
  if (!thinking.durationMs) return ''
  const seconds = (thinking.durationMs / 1000).toFixed(1)
  return `${seconds}s`
})

// 背景颜色（根据状态）
const cardBgClass = computed(() => {
  if (thinking.status === 'error') {
    return 'bg-#e74c3c08 border-#e74c3c20'
  }
  return 'bg-#7c5cfc08'
})

// 按需拉取完整思考内容（S7：思考全文不再走 WS，改为 REST 拉取）
const loadReview = async () => {
  if (reviewLoading.value || reviewLoaded.value) return
  if (!thinking.thinkingId) return
  reviewLoading.value = true
  reviewError.value = false
  try {
    // #241：断网失败不弹裸 toast（#209/#229 同噪声类）——卡片自带可点击重试的错误行，
    // 失败只记日志；web 端 webImRequest 本就不弹 toast，此选项仅作用于桌面 invoke 路径
    const data = await imRequest<{ content?: string; status?: number; durationMs?: number }>(
      {
        url: ImUrlEnum.AICLAW_THINKING_DETAIL,
        params: { thinkingId: thinking.thinkingId }
      },
      { showError: false }
    )
    reviewContent.value = data?.content ?? ''
    // status === 4 表示内容过长被截断
    reviewTruncated.value = data?.status === 4
    reviewLoaded.value = true
  } catch (error) {
    console.error('[InlineThinkingCard] 拉取思考内容失败:', error)
    reviewError.value = true
  } finally {
    reviewLoading.value = false
  }
}

// REQ-015 #187：历史卡全文拉取在进入视野时按需触发，避免一页 N 个并发请求
const cardRoot = ref<HTMLElement | null>(null)
let visibilityObserver: IntersectionObserver | null = null

const setupVisibilityFetch = () => {
  if (reviewLoaded.value || reviewLoading.value || visibilityObserver) return
  // 环境不支持 IntersectionObserver 时降级为立即拉取
  if (typeof IntersectionObserver === 'undefined') {
    void loadReview()
    return
  }
  visibilityObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      visibilityObserver?.disconnect()
      visibilityObserver = null
      void loadReview()
    }
  })
  if (cardRoot.value) {
    visibilityObserver.observe(cardRoot.value)
  }
}

onMounted(() => {
  if (thinking.status === 'complete') {
    setupVisibilityFetch()
  }
})

// 卡片可能以 thinking 态挂载后才完成（实时会话），完成时再注册入视野拉取
watch(
  () => thinking.status,
  (status) => {
    if (status === 'complete') {
      setupVisibilityFetch()
    }
  },
  { flush: 'post' }
)

onUnmounted(() => {
  visibilityObserver?.disconnect()
  visibilityObserver = null
})
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
