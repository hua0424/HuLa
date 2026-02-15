<template>
  <div class="tool-panel">
    <div class="tool-header">可用工具</div>
    <div class="tool-list">
      <div v-for="tool in tools" :key="tool.name" class="tool-item" @click="selectTool(tool)">
        <span class="tool-icon">🔧</span>
        <span class="tool-name">{{ tool.name }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue"

interface Tool {
  name: string
  description: string
}

const tools = ref<Tool[]>([
  { name: "exec", description: "执行 Shell 命令" },
  { name: "read", description: "读取文件" },
  { name: "write", description: "写入文件" },
  { name: "browser", description: "控制浏览器" },
  { name: "web_search", description: "网页搜索" },
])

function selectTool(tool: Tool) {
  console.log("Selected tool:", tool.name)
}
</script>

<style scoped>
.tool-panel {
  background: #f7fafc;
  border-radius: 8px;
  padding: 12px;
  margin: 8px 0;
}
.tool-header {
  font-weight: 600;
  color: #4a5568;
  margin-bottom: 8px;
}
.tool-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tool-item {
  display: flex;
  align-items: center;
  gap: 4px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.tool-item:hover {
  border-color: #3182ce;
  background: #ebf8ff;
}
.tool-icon {
  font-size: 1.2em;
}
.tool-name {
  font-size: 0.9em;
  color: #2d3748;
}
</style>
