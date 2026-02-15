<template>
  <div v-if="visible" class="model-picker-overlay" @click="close">
    <div class="model-picker" @click.stop>
      <div class="picker-header">
        <span class="title">选择模型</span>
        <button class="close-btn" @click="close">×</button>
      </div>
      
      <div class="model-list">
        <div
          v-for="model in models"
          :key="model.id"
          class="model-item"
          :class="{ active: model.id === selectedModel }"
          @click="selectModel(model.id)"
        >
          <div class="model-info">
            <span class="model-name">{{ model.name }}</span>
            <span class="model-desc">{{ model.description }}</span>
          </div>
          <span v-if="model.id === selectedModel" class="check">✓</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue"

interface Model {
  id: string
  name: string
  description: string
}

const props = defineProps<{
  visible: boolean
  currentModel?: string
}>()

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void
  (e: "select", modelId: string): void
}>()

const selectedModel = ref(props.currentModel || "claude-opus-4-6-thinking")

const models: Model[] = [
  { id: "claude-opus-4-6-thinking", name: "Claude Opus 4", description: "最适合复杂推理" },
  { id: "claude-sonnet-4-6-thinking", name: "Claude Sonnet 4", description: "平衡性能与速度" },
  { id: "minimax-portal/MiniMax-M2.5", name: "MiniMax M2.5", description: "中文优化" },
  { id: "minimax-portal/MiniMax-M2.5-lightning", name: "MiniMax M2.5 Lightning", description: "快速响应" },
  { id: "google-antigravity/claude-opus-4-6-thinking", name: "Claude Opus (Alt)", description: "备用实例" },
]

function close() {
  emit("update:visible", false)
}

function selectModel(modelId: string) {
  selectedModel.value = modelId
  emit("select", modelId)
  close()
}
</script>

<style scoped>
.model-picker-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.model-picker {
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 400px;
  max-height: 80vh;
  overflow: hidden;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
}
.picker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #e2e8f0;
}
.title {
  font-weight: 600;
  font-size: 1.1em;
  color: #2d3748;
}
.close-btn {
  background: none;
  border: none;
  font-size: 1.5em;
  color: #a0aec0;
  cursor: pointer;
  line-height: 1;
}
.close-btn:hover {
  color: #4a5568;
}
.model-list {
  padding: 8px;
  max-height: 400px;
  overflow-y: auto;
}
.model-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.model-item:hover {
  background: #f7fafc;
}
.model-item.active {
  background: #ebf8ff;
  border: 1px solid #3182ce;
}
.model-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.model-name {
  font-weight: 500;
  color: #2d3748;
}
.model-desc {
  font-size: 0.85em;
  color: #718096;
}
.check {
  color: #3182ce;
  font-weight: bold;
}
</style>
