<template>
  <div class="status-bar">
    <div class="status-left">
      <span class="status-item">
        <span :class="["status-dot", connectionStatus]"></span>
        {{ connectionText }}
      </span>
      <span v-if="currentModel" class="status-item model">
        🤖 {{ currentModelName }}
      </span>
    </div>
    <div class="status-right">
      <span v-if="latency" class="status-item latency">
        ⚡ {{ latency }}ms
      </span>
      <button class="settings-btn" @click="$emit('toggleSettings')" title="设置">
        ⚙️
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { ConnectionState } from "@/services/openclaw/types"

const props = defineProps<{
  state: ConnectionState
  currentModel?: string
  latency?: number
}>()

defineEmits<{
  (e: "toggleSettings"): void
}>()

const connectionStatus = computed(() => {
  switch (props.state) {
    case ConnectionState.CONNECTED: return "connected"
    case ConnectionState.CONNECTING:
    case ConnectionState.HANDSHAKING:
    case ConnectionState.RECONNECTING: return "connecting"
    default: return "disconnected"
  }
})

const connectionText = computed(() => {
  switch (props.state) {
    case ConnectionState.CONNECTED: return "已连接"
    case ConnectionState.CONNECTING: return "连接中..."
    case ConnectionState.HANDSHAKING: return "握手..."
    case ConnectionState.RECONNECTING: return "重连中..."
    case ConnectionState.DISCONNECTED: return "未连接"
    case ConnectionState.ERROR: return "连接错误"
    default: return "未知"
  }
})

const currentModelName = computed(() => {
  if (!props.currentModel) return ""
  const names: Record<string, string> = {
    "claude-opus-4-6-thinking": "Claude Opus",
    "claude-sonnet-4-6-thinking": "Claude Sonnet",
    "minimax-portal/MiniMax-M2.5": "MiniMax M2.5",
    "minimax-portal/MiniMax-M2.5-lightning": "MiniMax Lightning",
  }
  return names[props.currentModel] || props.currentModel
})
</script>

<style scoped>
.status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 12px;
  background: #1a202c;
  color: #a0aec0;
  font-size: 0.75em;
}
.status-left,
.status-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.status-item {
  display: flex;
  align-items: center;
  gap: 4px;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.status-dot.connected {
  background: #48bb78;
}
.status-dot.connecting {
  background: #ecc94b;
  animation: pulse 1s infinite;
}
.status-dot.disconnected {
  background: #a0aec0;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.model {
  color: #68d391;
}
.latency {
  color: #63b3ed;
}
.settings-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1em;
  opacity: 0.7;
  transition: opacity 0.15s;
}
.settings-btn:hover {
  opacity: 1;
}
</style>
