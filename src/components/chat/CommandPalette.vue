<template>
  <div v-if="visible" class="command-palette">
    <div class="command-header">命令</div>
    <div class="command-list">
      <div
        v-for="(cmd, index) in filteredCommands"
        :key="cmd.name"
        class="command-item"
        :class="{ active: index === selectedIndex }"
        @click="selectCommand(cmd)"
      >
        <span class="command-name">{{ cmd.name }}</span>
        <span class="command-desc">{{ cmd.description }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue"

interface Command {
  name: string
  description: string
  action: () => void
}

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void
  (e: "execute", command: string): void
}>()

const visible = ref(false)
const selectedIndex = ref(0)

const commands: Command[] = [
  { name: "/stop", description: "中断当前运行", action: () => executeCommand("/stop") },
  { name: "/reset", description: "重置当前会话", action: () => executeCommand("/reset") },
  { name: "/clear", description: "清空聊天记录", action: () => executeCommand("/clear") },
  { name: "/model", description: "切换模型", action: () => executeCommand("/model") },
  { name: "/tools", description: "查看可用工具", action: () => executeCommand("/tools") },
  { name: "/help", description: "显示帮助", action: () => executeCommand("/help") },
]

const filteredCommands = computed(() => {
  if (!props.modelValue.startsWith("/")) {
    visible.value = false
    return []
  }
  visible.value = true
  return commands.filter(cmd => 
    cmd.name.toLowerCase().includes(props.modelValue.toLowerCase())
  )
})

watch(() => props.modelValue, () => {
  selectedIndex.value = 0
})

function selectCommand(cmd: Command) {
  emit("update:modelValue", cmd.name + " ")
  visible.value = false
  cmd.action()
}

function executeCommand(cmd: string) {
  emit("execute", cmd)
  visible.value = false
}

function handleKeydown(e: KeyboardEvent) {
  if (!visible.value) return
  
  if (e.key === "ArrowDown") {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % filteredCommands.value.length
  } else if (e.key === "ArrowUp") {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + filteredCommands.value.length) % filteredCommands.value.length
  } else if (e.key === "Enter") {
    e.preventDefault()
    if (filteredCommands.value[selectedIndex.value]) {
      selectCommand(filteredCommands.value[selectedIndex.value])
    }
  } else if (e.key === "Escape") {
    visible.value = false
  }
}

defineExpose({ handleKeydown })
</script>

<style scoped>
.command-palette {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  margin-bottom: 4px;
  max-height: 200px;
  overflow-y: auto;
}
.command-header {
  padding: 8px 12px;
  font-size: 0.75em;
  color: #718096;
  text-transform: uppercase;
  border-bottom: 1px solid #e2e8f0;
}
.command-item {
  display: flex;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.command-item:hover,
.command-item.active {
  background: #f7fafc;
}
.command-name {
  font-weight: 500;
  color: #2d3748;
  font-family: monospace;
}
.command-desc {
  color: #718096;
  font-size: 0.85em;
}
</style>
