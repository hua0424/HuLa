<template>
  <div class="status-bar">
    <div class="status-left">
      <span class="status-item">
        <span class="status-dot"></span>
        {{ stateText }}
      </span>
    </div>
    <div class="status-right">
      <button class="settings-btn" @click="$emit('toggleSettings')">⚙️</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ConnectionState } from "@/services/openclaw/types"

defineProps<{
  state: ConnectionState
}>()

defineEmits<{
  (e: "toggleSettings"): void
}>()

const stateText = "状态"
</script>

<style scoped>
.status-bar { display: flex; justify-content: space-between; align-items: center; padding: 4px 12px; background: #1a202c; color: #a0aec0; font-size: 0.75em; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: #48bb78; }
.settings-btn { background: none; border: none; cursor: pointer; }
</style>
