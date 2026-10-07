<template>
  <!-- 主容器维持 600px 的最小宽度，确保聊天侧边信息不过度挤压 -->
  <main data-tauri-drag-region class="flex-1 bg-[--right-bg-color] flex flex-col min-h-0 min-w-600px">
    <div
      :style="{ background: shouldShowChat ? 'var(--right-theme-bg-color)' : '' }"
      data-tauri-drag-region
      class="flex-1 flex flex-col min-h-0">
      <ActionBar :current-label="appWindow?.label ?? ''" />

      <!-- 需要判断当前路由是否是信息详情界面 -->
      <div class="flex-1 min-h-0 flex flex-col">
        <ChatBox v-if="shouldShowChat" />

        <!-- #339：好友进入聊天的在途目标态——只呈现目标加载/失败，不呈现旧房间 -->
        <div
          v-else-if="sessionOpening"
          data-testid="session-opening"
          class="flex-center size-full select-none flex-col gap-12px">
          <template v-if="!sessionOpening.error">
            <n-spin :size="20" data-testid="session-opening-loading" :aria-label="openingText" />
            <span class="text-(14px [--text-color])">{{ openingText }}</span>
          </template>
          <template v-else>
            <div data-testid="session-opening-error" class="flex-center flex-col gap-12px">
              <span class="text-(14px [--text-color])">{{ t('home.chat_main.opening_failed') }}</span>
              <n-button secondary type="primary" data-testid="session-opening-retry" @click="retrySessionOpening">
                {{ t('home.chat_main.retry') }}
              </n-button>
            </div>
          </template>
        </div>

        <Details :content="detailsContent" v-else-if="detailsShow && isDetails && detailsContent?.type !== 'apply'" />

        <!-- 好友申请列表（REQ-017 #204 A2：:key 按类型销毁重建，切换 friend/group 重拉数据） -->
        <ApplyList
          v-else-if="detailsContent && isDetails && detailsContent.type === 'apply'"
          :key="detailsContent.applyType"
          :type="detailsContent.applyType" />

        <!-- 聊天界面背景图标 -->
        <div v-else class="flex-center size-full select-none">
          <img class="w-150px h-140px" src="/logoD.png" alt="" />
        </div>
      </div>
    </div>
  </main>
</template>
<script setup lang="ts">
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { MittEnum, ThemeEnum } from '@/enums'
import { useMitt } from '@/hooks/useMitt.ts'
import { useCommon } from '@/hooks/useCommon.ts'
import router from '@/router'
import type { DetailsContent } from '@/services/types'
import { useSettingStore } from '@/stores/setting.ts'
import { useGlobalStore } from '@/stores/global'
import { useGroupStore } from '@/stores/group.ts'
import { isWeb } from '@/utils/PlatformConstants'
import { useI18n } from 'vue-i18n'

const appWindow = isWeb() ? null : WebviewWindow.getCurrent()
const { t } = useI18n()
const settingStore = useSettingStore()
const { themes } = storeToRefs(settingStore)
const globalStore = useGlobalStore()
const groupStore = useGroupStore()
const { openMsgSession } = useCommon()
const { currentSessionRoomId, sessionOpening } = storeToRefs(globalStore)
const detailsShow = ref(false)
const detailsContent = ref<DetailsContent>()
const imgTheme = ref<ThemeEnum>(themes.value.content)
const prefers = matchMedia('(prefers-color-scheme: dark)')
const isChatRoute = computed(() => router.currentRoute.value.path.includes('/message'))
// 只要路由在消息页且选中了会话（即便会话详情尚未同步），就展示 ChatBox
const shouldShowChat = computed(() => isChatRoute.value && !!currentSessionRoomId.value)
const isDetails = computed(() => {
  return router.currentRoute.value.path.includes('/friendsList')
})

// #339：在途目标名（缓存命中即立即确认目标好友，未命中则通用加载文案）
const openingText = computed(() => {
  const name = sessionOpening.value ? groupStore.getUserInfo(sessionOpening.value.uid)?.name : ''
  return name ? t('home.chat_main.opening_loading_with_name', { name }) : t('home.chat_main.opening_loading')
})

// #339：失败重试沿用同一入口；入口内已处理错误呈现，这里吞掉透传拒绝避免未处理 rejection
const retrySessionOpening = () => {
  const opening = sessionOpening.value
  if (opening) openMsgSession(opening.uid, opening.type).catch(() => {})
}

/** 跟随系统主题模式切换主题 */
const followOS = () => {
  imgTheme.value = prefers.matches ? ThemeEnum.DARK : ThemeEnum.LIGHT
}

watchEffect(() => {
  if (themes.value.pattern === ThemeEnum.OS) {
    followOS()
    prefers.addEventListener('change', followOS)
  } else {
    imgTheme.value = themes.value.content || ThemeEnum.LIGHT
    prefers.removeEventListener('change', followOS)
  }
})

onMounted(() => {
  // 好友详情页面通过 mitt 接收主体传来的选中信息
  if (isDetails) {
    useMitt.on(MittEnum.APPLY_SHOW, (event: { context: DetailsContent }) => {
      detailsContent.value = event.context
    })
    useMitt.on(MittEnum.DETAILS_SHOW, (event: any) => {
      detailsContent.value = event.context
      detailsShow.value = event.detailsShow as boolean
    })
  }
})
</script>
