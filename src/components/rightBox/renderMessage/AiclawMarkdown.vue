<template>
  <div ref="rootRef" data-testid="aiclaw-markdown" class="aiclaw-markdown" @click.capture="handleClickCapture">
    <MarkdownRender
      :content="props.content"
      custom-id="aiclaw-md"
      :code-block-stream="false"
      :typewriter="false"
      :batch-rendering="false"
      :custom-markdown-it="lockdownMarkdownIt"
      :code-block-max-width="'100%'"
      :code-block-props="codeBlockProps"
      :is-dark="isDarkMode" />
  </div>
</template>

<script setup lang="ts">
import { MarkdownRender, MarkdownCodeBlockNode, setCustomComponents, enableMermaid } from 'markstream-vue'
import type { MarkdownIt } from 'markstream-vue'
import { storeToRefs } from 'pinia'
import { ThemeEnum } from '@/enums'
import { openExternalUrl } from '@/hooks/useLinkSegments'
import { useSettingStore } from '@/stores/setting'
import 'markstream-vue/index.css'

// #435：aiclaw 气泡的 markdown 一次性渲染。code_block 强制走 shiki 静态路径
// （MarkdownCodeBlockNode），不走默认 Monaco 编辑器（重、可编辑，不适合聊天展示）。
setCustomComponents('aiclaw-md', { code_block: MarkdownCodeBlockNode })
// mermaid 动态 import：无图表块时零运行时成本。
enableMermaid()

const props = defineProps<{
  content: string
}>()

// ponytail: 聊天场景不需要字号/预览控制条，只留复制+折叠；isShowPreview 关 html/svg 预览按钮。
const codeBlockProps = {
  showCopyButton: true,
  showExpandButton: true,
  showPreviewButton: false,
  showFontSizeButtons: false,
  enableFontSizeControl: false,
  isShowPreview: false
}

const settingStore = useSettingStore()
const { themes } = storeToRefs(settingStore)
const isDarkMode = computed(() => themes.value.content === ThemeEnum.DARK)

// 第一防线：解析层请求禁原始 HTML。注：markstream-vue 0.0.3-beta.4
// 的 markdown-it-ts 实例上 disable(html) 并不可靠（实测 html_inline 仍出现），
// 此处仅作尽力而为，真正兜底靠下面的渲染后消毒。
const lockdownMarkdownIt = (md: MarkdownIt) => {
  try {
    md.options.html = false
    md.disable(['html_block', 'html_inline'])
  } catch {
    /* 忽略：beta 版 API 漂移时以后置消毒为准 */
  }
  return md
}

// 第二防线（主防线）：渲染后原地消毒。
// 不能对整树做 innerHTML 重写式消毒（会销毁 Vue 组件的事件监听，代码块复制按钮等），
// 故做属性/元素级原地剥离，保留 DOM 与监听。渲染 HTML 只来自解析器可信模板与
// mermaid SVG（其内部已做 sanitizer），此处是确定性兜底。
const DANGEROUS_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'link',
  'meta',
  'base',
  'frame',
  'frameset'
])
// 与库内链接白名单同口径：http(s)/mailto/tel/站内锚/站内路径/图片 data URL 放行
const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/|data:image\/(?:png|gif|jpe?g|webp);)/i
const DANGEROUS_STYLE = /javascript:|vbscript:|expression\s*\(|url\s*\(\s*javascript:|@import/i
const rootRef = ref<HTMLElement | null>(null)
const sanitizeRendered = () => {
  const root = rootRef.value
  if (!root) return
  const els = [root, ...Array.from(root.querySelectorAll('*'))]
  for (const el of els) {
    const tag = el.tagName.toLowerCase()
    if (DANGEROUS_TAGS.has(tag)) {
      el.remove()
      continue
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name)
        continue
      }
      if ((name === 'href' || name === 'src' || name === 'xlink:href') && !SAFE_URL.test(attr.value.trim())) {
        el.removeAttribute(attr.name)
        continue
      }
      if (name === 'style' && DANGEROUS_STYLE.test(attr.value)) {
        el.removeAttribute(attr.name)
      }
    }
  }
}

onMounted(() => {
  sanitizeRendered()
})
onUpdated(() => {
  sanitizeRendered()
})

// 链接一律外部浏览器打开；站内锚（脚注回跳）放行原生行为；
// 危险伪协议即使漏过消毒也在捕获阶段拦死（不再冒泡、不跳转）。
const handleClickCapture = (e: MouseEvent) => {
  const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]')
  if (!anchor) return
  const href = (anchor.getAttribute('href') || '').trim()
  if (/^\s*(javascript|data|vbscript):/i.test(href)) {
    e.preventDefault()
    e.stopPropagation()
    return
  }
  if (!/^https?:\/\//i.test(href)) return
  e.preventDefault()
  e.stopPropagation()
  void openExternalUrl(href)
}
</script>

<style scoped>
.aiclaw-markdown {
  user-select: text;
  overflow-wrap: anywhere;
}
/* 代码块/表格不撑破气泡：横向滚动 */
.aiclaw-markdown :deep(.code-block-container),
.aiclaw-markdown :deep(.code-block-content) {
  max-width: 100%;
  overflow-x: auto;
}
.aiclaw-markdown :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
}
.aiclaw-markdown :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
}
.aiclaw-markdown :deep(img) {
  max-width: 100%;
}
/* #436：mermaid 图不撑破气泡：宽图按比例缩进容器（窄屏/移动端同样生效） */
.aiclaw-markdown :deep(svg) {
  max-width: 100%;
  height: auto;
}
</style>
