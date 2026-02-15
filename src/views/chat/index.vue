<template>
  <div class="chat-view h-full flex flex-col">
    <!-- Header -->
    <div class="chat-header h-14 border-b border-gray-200 flex items-center px-4 bg-white">
      <span v-if="connectionStore.isConnected" class="text-green-500">● 已连接</span>
      <span v-else class="text-gray-400">○ 未连接</span>
    </div>
    
    <!-- Messages -->
    <div class="flex-1 overflow-y-auto p-4" ref="messagesContainer">
      <div v-for="msg in messages" :key="msg.id" class="mb-4">
        <!-- User message -->
        <div v-if="msg.role === "user"" class="flex justify-end">
          <div class="bg-blue-500 text-white rounded-lg px-4 py-2 max-w-md">
            {{ msg.content }}
          </div>
        </div>
        <!-- Assistant message -->
        <div v-else class="flex justify-start">
          <div class="bg-gray-100 rounded-lg px-4 py-2 max-w-md">
            <div v-if="msg.thinking" class="text-gray-500 text-sm mb-2">
              <span class="thinking-text">{{ msg.thinking }}</span>
            </div>
            <div class="assistant-text">{{ msg.content }}</div>
            <div v-if="msg.isStreaming" class="typing-indicator">
              <span class="animate-pulse">...</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Input -->
    <div class="chat-input border-t border-gray-200 p-4 bg-white">
      <div class="flex gap-2">
        <input
          v-model="inputMessage"
          @keyup.enter="sendMessage"
          placeholder="输入消息..."
          class="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
        />
        <button
          @click="sendMessage"
          :disabled="!inputMessage.trim() || !connectionStore.isConnected"
          class="bg-blue-500 text-white px-6 py-2 rounded-lg disabled:opacity-50"
        >
          发送
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue"
import { useConnectionStore } from "@/stores/connection"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  thinking?: string
  isStreaming?: boolean
}

const connectionStore = useConnectionStore()
const messages = ref<Message[]>([])
const inputMessage = ref("")
const messagesContainer = ref<HTMLElement | null>(null)

let agentHandler: any = null

onMounted(() => {
  agentHandler = connectionStore.getAgentHandler()
  
  // 监听 agent 事件
  connectionStore.onAgentEvent((event: any) => {
    handleAgentEvent(event)
  })
})

function handleAgentEvent(event: any) {
  const runId = event.runId
  let msg = messages.value.find(m => m.id === runId && m.role === "assistant")
  
  if (event.stream === "text_delta") {
    if (!msg) {
      msg = { id: runId, role: "assistant", content: "", isStreaming: true }
      messages.value.push(msg)
    }
    msg.content += event.data.text || ""
  } else if (event.stream === "thinking") {
    if (!msg) {
      msg = { id: runId, role: "assistant", content: "", thinking: "", isStreaming: true }
      messages.value.push(msg)
    }
    msg.thinking = (msg.thinking || "") + (event.data.text || "")
  } else if (event.stream === "message_end") {
    if (msg) {
      msg.isStreaming = false
    }
  }
}

async function sendMessage() {
  if (!inputMessage.value.trim() || !connectionStore.isConnected) return
  
  const userMsg: Message = {
    id: crypto.randomUUID(),
    role: "user",
    content: inputMessage.value
  }
  messages.value.push(userMsg)
  
  const text = inputMessage.value
  inputMessage.value = ""
  
  try {
    await connectionStore.sendMessage(text)
  } catch (e: any) {
    console.error("Failed to send:", e)
  }
}
</script>

<style scoped>
.thinking-text {
  font-style: italic;
  opacity: 0.7;
}
.typing-indicator {
  color: #999;
}
</style>
