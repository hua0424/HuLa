<template>
  <div class="exec-approval">
    <div class="approval-header">
      <span class="warning-icon">⚠️</span>
      <span>待审批的 Shell 命令</span>
    </div>
    <div class="approval-content">
      <div class="command-label">命令:</div>
      <pre class="command">{{ command }}</pre>
      <div v-if="cwd" class="cwd">
        <span class="label">工作目录:</span> {{ cwd }}
      </div>
    </div>
    <div class="approval-actions">
      <button class="btn deny" @click="deny">拒绝</button>
      <button class="btn allow-once" @click="allowOnce">允许一次</button>
      <button class="btn allow-always" @click="allowAlways">总是允许</button>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  id: string
  command: string
  cwd?: string
}>()

const emit = defineEmits<{
  (e: "resolve", decision: "allow-once" | "allow-always" | "deny"): void
}>()

function deny() {
  emit("resolve", "deny")
}

function allowOnce() {
  emit("resolve", "allow-once")
}

function allowAlways() {
  emit("resolve", "allow-always")
}
</script>

<style scoped>
.exec-approval {
  background: #fff5f5;
  border: 1px solid #fc8181;
  border-radius: 8px;
  padding: 12px;
  margin: 8px 0;
}
.approval-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #c53030;
  font-weight: 600;
  margin-bottom: 12px;
}
.warning-icon {
  font-size: 1.2em;
}
.command-label {
  font-size: 0.85em;
  color: #718096;
  margin-bottom: 4px;
}
.command {
  background: #1a202c;
  color: #68d391;
  padding: 12px;
  border-radius: 6px;
  font-family: monospace;
  font-size: 0.9em;
  overflow-x: auto;
  margin: 0;
}
.cwd {
  margin-top: 8px;
  font-size: 0.85em;
  color: #4a5568;
}
.cwd .label {
  color: #718096;
}
.approval-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.btn {
  flex: 1;
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}
.btn.deny {
  background: #e2e8f0;
  color: #4a5568;
}
.btn.deny:hover {
  background: #cbd5e0;
}
.btn.allow-once {
  background: #f6ad55;
  color: #744210;
}
.btn.allow-once:hover {
  background: #ed8936;
}
.btn.allow-always {
  background: #48bb78;
  color: white;
}
.btn.allow-always:hover {
  background: #38a169;
}
</style>
