import { invoke } from '@tauri-apps/api/core'
import { type } from '@tauri-apps/plugin-os'
import {
  createRouter,
  createWebHistory,
  type NavigationGuardNext,
  type RouteLocationNormalized,
  type RouteRecordRaw
} from 'vue-router'

import Message from '@/views/homeWindow/message/index.vue'
import SearchDetails from '@/views/homeWindow/SearchDetails.vue'

import MobileHome from '#/layout/index.vue'
import ChatRoomLayout from '#/layout/chat-room/ChatRoomLayout.vue'
import ChatSetting from '#/views/chat-room/ChatSetting.vue'
import MobileChatMain from '#/views/chat-room/MobileChatMain.vue'
import SearchChatContent from '#/views/chat-room/SearchChatContent.vue'
import MediaViewer from '#/views/chat-room/MediaViewer.vue'
import MobileLogin from '#/login.vue'
import Splashscreen from '#/views/Splashscreen.vue'
import SyncData from '#/views/SyncData.vue'
import MobileServiceAgreement from '#/views/MobileServiceAgreement.vue'
import MobilePrivacyAgreement from '#/views/MobilePrivacyAgreement.vue'

const { BASE_URL } = import.meta.env
const isMobile = type() === 'ios' || type() === 'android'

// 移动端路由配置
const getMobileRoutes = (): Array<RouteRecordRaw> => [
  {
    path: '/',
    name: 'mobileRoot',
    redirect: '/mobile/login'
  },
  {
    path: '/mobile/login',
    name: 'mobileLogin',
    component: MobileLogin
  },
  {
    path: '/mobile/splashscreen',
    name: 'splashscreen',
    component: Splashscreen
  },
  {
    path: '/mobile/serviceAgreement',
    name: 'mobileServiceAgreement',
    component: MobileServiceAgreement
  },
  {
    path: '/mobile/privacyAgreement',
    name: 'mobilePrivacyAgreement',
    component: MobilePrivacyAgreement
  },
  {
    path: '/mobile/syncData',
    name: 'mobileSyncData',
    component: SyncData
  },
  {
    path: '/mobile/chatRoom',
    name: 'mobileChatRoom',
    component: ChatRoomLayout,
    children: [
      {
        path: '',
        name: 'mobileChatRoomDefault',
        redirect: '/mobile/chatRoom/chatMain'
      },
      {
        path: 'chatMain/:uid?',
        name: 'mobileChatMain',
        component: MobileChatMain,
        props: true,
        meta: { keepAlive: true }
      },
      {
        path: 'setting',
        name: 'mobileChatSetting',
        component: ChatSetting
      },
      {
        path: 'searchContent',
        name: 'mobileSearchChatContent',
        component: SearchChatContent
      },
      {
        path: 'mediaViewer',
        name: 'mobileMediaViewer',
        component: MediaViewer
      }
    ]
  },
  {
    path: '/mobile/home',
    name: 'mobileHome',
    component: MobileHome
  }
]

// 桌面端路由配置
const getDesktopRoutes = (): Array<RouteRecordRaw> => [
  {
    path: '/home',
    name: 'home',
    component: () => import('@/layout/index.vue'),
    children: [
      {
        path: '/message',
        name: 'message',
        component: Message
      },
      {
        path: '/searchDetails',
        name: 'searchDetails',
        component: SearchDetails
      }
    ]
  },
  {
    path: '/fileManager',
    name: 'fileManager',
    component: () => import('@/views/fileManagerWindow/index.vue')
  },
  {
    path: '/previewFile',
    name: 'previewFile',
    component: () => import('@/views/previewFileWindow/index.vue')
  },
  {
    path: '/chat-history',
    name: 'chat-history',
    component: () => import('@/views/chatHistory/index.vue')
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/moreWindow/settings/index.vue'),
    children: [
      {
        path: '/general',
        name: 'general',
        component: () => import('@/views/moreWindow/settings/General.vue')
      },
      {
        path: '/notification',
        name: 'notification',
        component: () => import('@/views/moreWindow/settings/Notification.vue')
      },
      {
        path: '/versatile',
        name: 'versatile',
        component: () => import('@/views/moreWindow/settings/Versatile.vue')
      },
      {
        path: '/shortcut',
        name: 'shortcut',
        component: () => import('@/views/moreWindow/settings/Shortcut.vue')
      }
    ]
  },
  {
    path: '/about',
    name: 'about',
    component: () => import('@/views/aboutWindow/index.vue')
  },
  {
    path: '/alone',
    name: 'alone',
    component: () => import('@/views/homeWindow/message/Alone.vue')
  }
]

// 通用路由
const getCommonRoutes = (): Array<RouteRecordRaw> => [
  {
    path: '/',
    redirect: '/home'
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/loginWindow/Login.vue')
  },
  {
    path: '/splashscreen',
    name: 'splashscreen',
    component: Splashscreen
  },
  {
    path: '/tray',
    name: 'tray',
    component: () => import('@/views/Tray.vue')
  },
  {
    path: '/notify',
    name: 'notify',
    component: () => import('@/views/Notify.vue')
  },
  {
    path: '/update',
    name: 'update',
    component: () => import('@/views/Update.vue')
  },
  {
    path: '/checkupdate',
    name: 'checkupdate',
    component: () => import('@/views/CheckUpdate.vue')
  },
  {
    path: '/capture',
    name: 'capture',
    component: () => import('@/views/Capture.vue')
  },
  {
    path: '/imageViewer',
    name: 'imageViewer',
    component: () => import('@/views/imageViewerWindow/index.vue')
  },
  {
    path: '/videoViewer',
    name: 'videoViewer',
    component: () => import('@/views/videoViewerWindow/index.vue')
  },
  {
    path: '/modal-serviceAgreement',
    name: 'modal-serviceAgreement',
    component: () => import('@/views/agreementWindow/Server.vue')
  },
  {
    path: '/modal-privacyAgreement',
    name: 'modal-privacyAgreement',
    component: () => import('@/views/agreementWindow/Privacy.vue')
  }
]

const getAllRoutes = (): Array<RouteRecordRaw> => {
  const commonRoutes = getCommonRoutes()
  if (isMobile) {
    return [...commonRoutes, ...getMobileRoutes()]
  } else {
    return [...commonRoutes, ...getDesktopRoutes()]
  }
}

const router: any = createRouter({
  history: createWebHistory(BASE_URL),
  routes: getAllRoutes()
})

router.beforeEach(async (to: RouteLocationNormalized, _from: RouteLocationNormalized, next: NavigationGuardNext) => {
  if (!isMobile) {
    console.log('[守卫] 非移动端，直接放行')
    return next()
  }

  try {
    const isLoginPage = to.path === '/mobile/login'
    const isSplashPage = to.path === '/mobile/splashscreen'
    const isAgreementPage = to.path === '/mobile/serviceAgreement' || to.path === '/mobile/privacyAgreement'

    if (isSplashPage || isAgreementPage) {
      return next()
    }

    // 简化：移动端也直接放行（后续加入配对逻辑后需要调整）
    return next()
  } catch (error) {
    console.error('[守卫] 获取token错误:', error)
    if (to.path !== '/mobile/login') {
      return next('/mobile/login')
    }
    return next()
  }
})

export default router
