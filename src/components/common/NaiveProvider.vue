<template>
  <n-config-provider :theme="globalTheme" :locale="zhCN" :date-locale="dateZhCN">
    <n-loading-bar-provider>
      <n-dialog-provider>
        <n-notification-provider :max="notificMax">
          <n-message-provider :max="messageMax">
            <n-modal-provider>
              <slot></slot>
              <naive-provider-content />
            </n-modal-provider>
          </n-message-provider>
        </n-notification-provider>
      </n-dialog-provider>
    </n-loading-bar-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { ref, defineComponent, h } from "vue"
import { darkTheme, dateZhCN, zhCN } from "naive-ui"

const { notificMax, messageMax } = defineProps<{
  notificMax?: number
  messageMax?: number
}>()
defineOptions({ name: "NaiveProvider" })

const prefersDark = window.matchMedia("(prefers-color-scheme: dark)")
const globalTheme = ref(prefersDark.matches ? darkTheme : null)
prefersDark.addEventListener("change", (e) => {
  globalTheme.value = e.matches ? darkTheme : null
})

const registerNaiveTools = () => {
  window.$loadingBar = useLoadingBar()
  window.$dialog = useDialog()
  window.$notification = useNotification()
  window.$message = useMessage()
  window.$modal = useModal()
}

const NaiveProviderContent = defineComponent({
  name: "NaiveProviderContent",
  setup() { registerNaiveTools() },
  render() { return h("div") }
})
</script>
