<template>
  <div class="message-bubble" :class="role">
    <div v-if="thinking" class="thinking-block">
      <span class="thinking-label">思考中...</span>
      <span class="thinking-text">{{ thinking }}</span>
    </div>
    <div class="content">
      <MarkdownRenderer v-if="content" :content="content" />
      <span v-if="isStreaming" class="typing-cursor">▊</span>
    </div>
    <div v-if="toolCalls?.length" class="tool-calls">
      <div v-for="tool in toolCalls" :key="tool.id" class="tool-call" :class="tool.status">
        <div class="tool-name">{{ tool.name }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import MarkdownRenderer from "./MarkdownRenderer.vue"

interface ToolCall {
  id: string
  name: string
  params: unknown
  status: "pending" | "running" | "success" | "error"
  result?: unknown
}

defineProps<{
  role: "user" | "assistant"
  content: string
  thinking?: string
  isStreaming?: boolean
  toolCalls?: ToolCall[]
}>()
</script>

<style scoped>
.message-bubble { max-width: 80%; margin: 8px 0; }
.message-bubble.user { margin-left: auto; }
.message-bubble.user .content { background: #3182ce; color: white; border-radius: 12px 12px 4px 12px; }
.message-bubble.assistant .content { background: #f7fafc; color: #2d3748; border-radius: 12px 12px 12px 4px; padding: 12px; }
.thinking-block { background: #fffbeb; border: 1px solid #f6e05e; border-radius: 8px; padding: 8px; margin-bottom: 4px; font-size: 0.85em; }
.thinking-label { color: #b7791f; font-weight: 600; display: block; margin-bottom: 4px; }
.thinking-text { color: #744210; font-style: italic; }
.typing-cursor { animation: blink 1s infinite; color: #718096; }
@keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
.tool-calls { margin-top: 8px; }
.tool-call { background: #edf2f7; border-radius: 8px; padding: 8px; margin: 4px 0; font-size: 0.85em; }
.tool-call.running { border-left: 3px solid #3182ce; }
.tool-call.success { border-left: 3px solid #38a169; }
.tool-call.error { border-left: 3px solid #e53e3e; }
.tool-name { font-weight: 600; color: #2d3748; }
</style>
