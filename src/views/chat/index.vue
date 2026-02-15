<template>
  <div class="chat-view h-full flex flex-col" :class="theme">
    <!-- Status Bar -->
    <StatusBar 
      :state="connectionStore.state" 
      :current-model="currentModel"
      :latency="latency"
      @toggle-settings="showSettings = !showSettings"
    />
    
    <!-- Header -->
    <div class="chat-header h-14 border-b border-gray-200 flex items-center px-4 bg-white dark:bg-gray-800">
      <div class="flex items-center gap-2">
        <span v-if="connectionStore.isConnected" class="text-green-500">● 已连接</span>
        <span v-else class="text-gray-400">○ 未连接</span>
        <span v-if="connectionStore.serverInfo" class="text-xs text-gray-500">
          {{ connectionStore.serverInfo.version }}
        </span>
      </div>
      <div class="flex-1"></div>
      <button @click="showModelPicker = true" class="text-sm text-gray-500 hover:text-blue-500 mr-3">
        🤖 切换模型
      </button>
      <button v-if="connectionStore.isConnected" @click="connectionStore.disconnect()" class="text-sm text-gray-500 hover:text-red-500">
        断开
      </button>
      <button v-else @click="reconnect" class="text-sm text-blue-500 hover:text-blue-600">
        重连
      </button>
    </div>
    
    <!-- Messages -->
    <div class="flex-1 overflow-y-auto p-4" ref="messagesContainer">
      <div v-if="!connectionStore.isConnected" class="flex items-center justify-center h-full text-gray-400">
        <div class="text-center">
          <p class="mb-2">未连接到 Gateway</p>
          <button @click="reconnect" class="text-blue-500 hover:text-blue-600">点击重连</button>
        </div>
      </div>
      
      <div v-else-if="messages.length === 0" class="flex items-center justify-center h-full text-gray-400">
        <div class="text-center">
          <p class="text-2xl mb-2">🤖</p>
          <p>开始与 AI 对话吧</p>
          <p class="text-sm mt-2 text-gray-400">输入 /help 查看可用命令</p>
        </div>
      </div>
      
      <div v-for="msg in messages" :key="msg.id" class="mb-4">
        <div v-if="msg.role === 'user'" class="flex justify-end">
          <div class="bg-blue-500 text-white rounded-lg px-4 py-2 max-w-md shadow">
            {{ msg.content }}
          </div>
        </div>
        <div v-else class="flex justify-start">
          <MessageBubble
            :role="msg.role"
            :content="msg.content"
            :thinking="msg.thinking"
            :is-streaming="msg.isStreaming"
            :tool-calls="msg.toolCalls"
          />
        </div>
      </div>
      
      <div v-if="pendingApprovals.length">
        <ExecApproval
          v-for="approval in pendingApprovals"
          :key="approval.id"
          :id="approval.id"
          :command="approval.command"
          :cwd="approval.cwd"
          @resolve="handleApprovalResolve(approval.id, $event)"
        />
      </div>
    </div>
    
    <!-- Input -->
    <div class="chat-input border-t border-gray-200 p-4 bg-white dark:bg-gray-800 relative">
      <CommandPalette
        v-model="inputMessage"
        @execute="handleCommand"
        :ref="(el: any) => commandPaletteRef = el"
      />
      
      <div class="flex gap-2">
        <button @click="showTools = !showTools" class="px-3 py-2 text-gray-500 hover:text-gray-700" :class="{ 'text-blue-500': showTools }">
          🔧
        </button>
        <input
          v-model="inputMessage"
          @keyup.enter="handleEnter"
          @keydown="handleKeydown"
          placeholder="输入消息... (输入 / 查看命令)"
          class="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
        />
        <button
          @click="sendMessage"
          :disabled="!inputMessage.trim() || !connectionStore.isConnected"
          class="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg disabled:opacity-50 transition-colors"
        >
          发送
        </button>
      </div>
      
      <ToolPanel v-if="showTools" class="mt-2" />
    </div>
    
    <!-- Model Picker -->
    <ModelPicker
      :visible="showModelPicker"
      :current-model="currentModel"
      @update:visible="showModelPicker = $event"
      @select="handleModelSelect"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from "vue"
import { useConnectionStore } from "@/stores/connection"
import MessageBubble from "@/components/chat/MessageBubble.vue"
import ToolPanel from "@/components/chat/ToolPanel.vue"
import ExecApproval from "@/components/chat/ExecApproval.vue"
import CommandPalette from "@/components/chat/CommandPalette.vue"
import StatusBar from "@/components/chat/StatusBar.vue"
import ModelPicker from "@/components/chat/ModelPicker.vue"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  thinking?: string
  isStreaming?: boolean
  toolCalls?: any[]
}

interface PendingApproval {
  id: string
  command: string
  cwd?: string
}

const connectionStore = useConnectionStore()
const messages = ref<Message[]>([])
const inputMessage = ref("")
const messagesContainer = ref<HTMLElement | null>(null)
const showTools = ref(false)
const showSettings = ref(false)
const showModelPicker = ref(false)
const pendingApprovals = ref<PendingApproval[]>([])
const commandPaletteRef = ref<any>(null)
const currentRunId = ref<string | null>(null)
const currentModel = ref("claude-opus-4-6-thinking")
const latency = ref<number | undefined>(undefined)
const theme = ref("light")

onMounted(async () => {
  // Load theme preference
  const savedTheme = localStorage.getItem("theme") || "light"
  theme.value = savedTheme
  document.documentElement.classList.toggle("dark", savedTheme === "dark")
  
  // Load saved model
  const savedModel = localStorage.getItem("model")
  if (savedModel) currentModel.value = savedModel
  
  connectionStore.onAgentEvent((event: any) => {
    handleAgentEvent(event)
  })
  
  connectionStore.connection.events.on("exec.approval", (payload: any) => {
    pendingApprovals.value.push({
      id: payload.id,
      command: payload.command,
      cwd: payload.cwd
    })
  })
  
  await reconnect()
})

async function reconnect() {
  const gatewayUrl = import.meta.env.VITE_GATEWAY_URL || "ws://localhost:18789"
  try {
    await connectionStore.connect({ gatewayUrl, gatewayToken: "" })
    console.log("[OpenClaw] Connected to Gateway")
  } catch (e) {
    console.error("[OpenClaw] Connection failed:", e)
  }
}

function handleAgentEvent(event: any) {
  const runId = event.runId
  currentRunId.value = runId
  let msg = messages.value.find(m => m.id === runId && m.role === 'assistant')
  
  if (event.stream === "text_delta") {
    if (!msg) {
      msg = { id: runId, role: "assistant", content: "", isStreaming: true }
      messages.value.push(msg)
    }
    msg.content += event.data.text || ""
    scrollToBottom()
  } else if (event.stream === "thinking") {
    if (!msg) {
      msg = { id: runId, role: "assistant", content: "", thinking: "", isStreaming: true }
      messages.value.push(msg)
    }
    msg.thinking = (msg.thinking || "") + (event.data.text || "")
  } else if (event.stream === "tool_use") {
    if (!msg) {
      msg = { id: runId, role: "assistant", content: "", isStreaming: true, toolCalls: [] }
      messages.value.push(msg)
    }
    if (!msg.toolCalls) msg.toolCalls = []
    msg.toolCalls.push({
      id: event.data.id,
      name: event.data.name,
      params: event.data.input,
      status: "running"
    })
  } else if (event.stream === "tool_result") {
    if (msg?.toolCalls) {
      const tool = msg.toolCalls.find(t => t.id === event.data.toolCallId)
      if (tool) {
        tool.result = event.data.output
        tool.status = event.data.isError ? "error" : "success"
      }
    }
  } else if (event.stream === "message_end") {
    if (msg) {
      msg.isStreaming = false
      currentRunId.value = null
    }
  }
}

function handleApprovalResolve(id: string, decision: "allow-once" | "allow-always" | "deny") {
  pendingApprovals.value = pendingApprovals.value.filter(a => a.id !== id)
  connectionStore.connection.request("exec.resolve", { id, decision }).catch(console.error)
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
  
  scrollToBottom()
}

function handleEnter() {
  if (inputMessage.value.startsWith("/")) return
  sendMessage()
}

function handleKeydown(e: KeyboardEvent) {
  if (inputMessage.value.startsWith("/") && commandPaletteRef.value) {
    commandPaletteRef.value.handleKeydown(e)
  }
}

function handleCommand(cmd: string) {
  console.log("Executing command:", cmd)
  
  switch (cmd) {
    case "/stop":
      if (currentRunId.value) {
        connectionStore.connection.request("agent.cancel", { runId: currentRunId.value })
          .then(() => {
            const msg = messages.value.find(m => m.id === currentRunId.value)
            if (msg) msg.isStreaming = false
          })
          .catch(console.error)
      }
      break
      
    case "/reset":
      messages.value = []
      connectionStore.connection.request("session.reset", {}).catch(console.error)
      break
      
    case "/clear":
      messages.value = []
      break
      
    case "/model":
      showModelPicker.value = true
      break
      
    case "/tools":
      showTools.value = true
      break
      
    case "/help":
      messages.value.push({
        id: crypto.randomUUID(),
        role: "assistant",
        content: "可用命令:\n- /stop - 中断当前运行\n- /reset - 重置当前会话\n- /clear - 清空聊天记录\n- /model - 切换模型\n- /tools - 查看可用工具\n- /help - 显示帮助"
      })
      break
  }
}

function handleModelSelect(modelId: string) {
  currentModel.value = modelId
  localStorage.setItem("model", modelId)
  connectionStore.connection.request("session.setModel", { model: modelId }).catch(console.error)
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}
</script>

<style>
.dark {
  background: #1a202c;
}
.dark .chat-header {
  background: #2d3748;
  border-color: #4a5568;
}
.dark .chat-input {
  background: #2d3748;
  border-color: #4a5568;
}
.dark .input {
  background: #4a5568;
  border-color: #718096;
  color: white;
}
</style>
