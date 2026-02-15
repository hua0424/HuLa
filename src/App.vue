<template>
  <div class="h-100vh w-100vw">
    <div class="h-full">
      <router-view />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue"
import { useConnectionStore } from "@/stores/connection"

const connectionStore = useConnectionStore()

onMounted(async () => {
  // 自动连接（本地开发用 localhost:18789）
  // 生产环境可以改成实际的 Gateway 地址
  const gatewayUrl = import.meta.env.VITE_GATEWAY_URL || "ws://localhost:18789"
  
  try {
    await connectionStore.connect({
      gatewayUrl,
      gatewayToken: ""
    })
    console.log("[OpenClaw] Connected to Gateway")
  } catch (e) {
    console.error("[OpenClaw] Connection failed:", e)
  }
})
</script>
