<template>
  <Transition name="thinking-panel" mode="out-in">
    <!-- 有活跃思考 或 有未归档的已完成思考 -->
    <div v-if="activeThinkings.length > 0" class="thinking-panel flex-shrink-0 px-12px pt-6px">
      <div class="flex flex-col gap-4px">
        <ThinkingCard
          v-for="thinking in activeThinkings"
          :key="thinking.thinkingId"
          :thinking="thinking"
          @toggle-collapse="handleToggleCollapse(thinking)" />
      </div>
    </div>
    <!-- 所有思考已归档，显示回顾入口 -->
    <div v-else-if="hasArchivedThinkings" class="flex-shrink-0 px-12px pt-6px" @click="showArchiveDrawer = true">
      <div
        class="flex items-center gap-6px px-12px py-6px rounded-6px bg-#7c5cfc08 text-(12px #7c5cfc) cursor-pointer hover:bg-#7c5cfc15 transition-colors">
        <svg class="size-14px flex-shrink-0"><use href="#robot" /></svg>
        {{ t('aiclaw.thinking.archive_entry', { count: archivedCount }) }}
      </div>
    </div>
  </Transition>

  <!-- 归档抽屉 -->
  <n-drawer v-model:show="showArchiveDrawer" :width="360" placement="right">
    <n-drawer-content>
      <template #header>
        <div class="flex items-center justify-between w-full">
          <span class="text-(16px font-500)">{{ t('aiclaw.thinking.archive_title') }}</span>
          <n-button
            text
            data-testid="thinking-archive-drawer-close"
            :aria-label="t('components.common.close')"
            @click="showArchiveDrawer = false">
            <svg class="size-18px"><use href="#close" /></svg>
          </n-button>
        </div>
      </template>
      <div v-if="isArchiveLoading" class="flex justify-center py-20px">
        <n-spin size="small" />
      </div>
      <ThinkingCard
        v-for="thinking in archivedThinkings"
        :key="thinking.thinkingId"
        :thinking="thinking"
        :readonly="true" />
      <n-empty
        v-if="!isArchiveLoading && archivedThinkings.length === 0"
        :description="t('aiclaw.thinking.archive_empty')" />
    </n-drawer-content>
  </n-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { useGlobalStore } from '@/stores/global'
import type { ThinkingState } from '@/types/thinking'
import ThinkingCard from './ThinkingCard.vue'

const { t } = useI18n()
const chatStore = useChatStore()
const globalStore = useGlobalStore()
const showArchiveDrawer = ref(false)

const activeThinkings = computed(() => chatStore.currentRoomThinkings as ThinkingState[])

const hasArchivedThinkings = computed(() => {
  const roomId = globalStore.currentSessionRoomId
  if (!roomId) return false
  return (chatStore.thinkingArchive.get(roomId)?.length ?? 0) > 0
})

const archivedThinkings = computed(() => {
  const roomId = globalStore.currentSessionRoomId
  if (!roomId) return []
  return (chatStore.thinkingArchive.get(roomId) ?? []) as ThinkingState[]
})

const archivedCount = computed(() => archivedThinkings.value.length)

const isArchiveLoading = computed(() => {
  const roomId = globalStore.currentSessionRoomId
  return roomId ? chatStore.thinkingArchiveLoading.has(roomId) : false
})

// #136：进入房间时即按需加载历史 thinking，让归档入口在重启后也能出现
watch(
  () => globalStore.currentSessionRoomId,
  (roomId) => {
    if (roomId) {
      chatStore.loadThinkingArchive(roomId)
    }
  },
  { immediate: true }
)

// #136：打开归档抽屉时按需加载历史 thinking（兜底）
watch(showArchiveDrawer, (visible) => {
  if (!visible) return
  const roomId = globalStore.currentSessionRoomId
  if (roomId) {
    chatStore.loadThinkingArchive(roomId)
  }
})

const handleToggleCollapse = (thinking: ThinkingState) => {
  chatStore.toggleThinkingCollapse(thinking.roomId, thinking.aiclawId)
}
</script>

<style scoped>
.thinking-panel-enter-active,
.thinking-panel-leave-active {
  transition: all 0.2s ease;
}

.thinking-panel-enter-from,
.thinking-panel-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
