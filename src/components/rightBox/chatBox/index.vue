<template>
  <div class="flex flex-col flex-1 min-h-0">
    <!-- 头部 -->
    <ChatHeader />

    <!-- AI 审批面板 (仅 owner 可见) -->
    <AiApprovalPanel />

    <div class="flex-1 flex min-h-0">
      <div class="flex-1 min-h-0">
        <!-- bot用户时显示Bot组件（非AI助手的bot） -->
        <template v-if="isBotUser && !isAiAssistant">
          <Bot />
        </template>
        <n-split
          v-else
          direction="vertical"
          :resize-trigger-size="0"
          class="h-full"
          :min="0.55"
          :max="0.74"
          :default-size="0.74">
          <template #1>
            <ChatMain />
          </template>
          <template #2>
            <!-- 输入框和操作列表 -->
            <ChatFooter :detail-id="currentSession?.detailId" />
          </template>
        </n-split>
      </div>
      <!-- 右侧栏占位：群聊时预留宽度直至 Sidebar 挂载完成，随后由子组件控制宽度（含折叠） -->
      <ChatSidebar />
    </div>
  </div>
</template>
<script setup lang="ts">
import { useGlobalStore } from '@/stores/global'
import { storeToRefs } from 'pinia'
import { UserType } from '@/enums'
import AiApprovalPanel from '@/components/rightBox/AiApprovalPanel.vue'

const globalStore = useGlobalStore()
const { currentSession } = storeToRefs(globalStore)

// 是否为bot用户
const isBotUser = computed(() => currentSession.value?.account === UserType.BOT)

// AI 助手类型的 BOT 用户 - 使用常规聊天界面而非 Bot 组件
// 当会话的 detailId 对应的用户是 AI 节点时为 true
// TODO: 后续可通过服务端返回的 userType 或 AI 节点注册表精确判断
const isAiAssistant = computed(() => {
  if (!currentSession.value) return false
  return isBotUser.value
})
</script>
<style scoped lang="scss">
:deep(.n-split .n-split__resize-trigger) {
  height: 16px !important;
  cursor: ns-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent !important;
  z-index: 998;
  position: relative;
  // 确保不干扰 ChatFooter 的顶部边框
  margin-top: -7px;

  // 主指示线（默认隐藏，hover 时显示）
  &::before {
    content: '';
    position: absolute;
    width: 40px;
    height: 3px;
    background: #909090;
    border-radius: 2px;
    opacity: 0;
    transition: all 0.2s ease;
  }

  // 上下辅助线（默认隐藏，hover 时显示）
  &::after {
    content: '';
    position: absolute;
    width: 20px;
    height: 1px;
    background: transparent;
    border-radius: 1px;
    transition: all 0.2s ease;
    opacity: 0;
    box-shadow:
      0 -3px 0 0 rgba(102, 102, 102, 0.5),
      0 3px 0 0 rgba(102, 102, 102, 0.5);
    pointer-events: none;
  }

  // hover 状态 - 显示指示器
  &:hover {
    &::before {
      opacity: 0.8;
      transform: scaleY(1.2);
    }

    &::after {
      opacity: 1;
      box-shadow:
        0 -3px 0 0 rgba(102, 102, 102, 0.8),
        0 3px 0 0 rgba(102, 102, 102, 0.8);
    }
  }

  // active/dragging 状态 - 显示高亮指示器
  &:active {
    &::before {
      opacity: 1;
      transform: scaleY(1.2);
      background: #13987f80;
    }

    &::after {
      opacity: 1;
      box-shadow:
        0 -3px 0 0 #13987f80,
        0 3px 0 0 #13987f80;
    }
  }
}
</style>
