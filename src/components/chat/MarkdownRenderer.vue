<template>
  <div class="markdown-content" v-html="renderedContent"></div>
</template>

<script setup lang="ts">
import { computed } from "vue"

const props = defineProps<{
  content: string
}>()

const renderedContent = computed(() => {
  let html = props.content
  
  // 转义 HTML
  html = html.replace(/</g, "&lt;").replace(/>/g, "&gt;")
  
  // 代码块
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre class="code-block"><code class="language-${lang}">${code.trim()}</code></pre>`
  })
  
  // 行内代码
  html = html.replace(/`([^`]+)`/g, "<code class=\"inline-code\">$1</code>")
  
  // 粗体
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  
  // 斜体
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>")
  
  // 删除线
  html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>")
  
  // 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a href=\"$2\" target=\"_blank\">$1</a>")
  
  // 列表项
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>")
  html = html.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
  
  // 换行
  html = html.replace(/\n/g, "<br>")
  
  return html
})
</script>

<style scoped>
.markdown-content {
  line-height: 1.6;
}
.markdown-content :deep(pre.code-block) {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
}
.markdown-content :deep(code.inline-code) {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.9em;
}
.markdown-content :deep(a) {
  color: #3182ce;
  text-decoration: none;
}
.markdown-content :deep(a:hover) {
  text-decoration: underline;
}
.markdown-content :deep(ul) {
  padding-left: 20px;
  margin: 8px 0;
}
.markdown-content :deep(li) {
  margin: 4px 0;
}
</style>
