import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { info } from '@tauri-apps/plugin-log'
import { defineStore } from 'pinia'
import { homeWindowOnlyStorage } from '@/stores/persistHomeWindowOnly'
import { MittEnum, RoomTypeEnum, StoresEnum } from '@/enums'
import { isWeb } from '@/utils/PlatformConstants'
import type { FriendItem, RequestFriendItem, SessionItem } from '@/services/types'
import { useChatStore } from '@/stores/chat'
import { useFeedStore } from '@/stores/feed'
import { useMitt } from '@/hooks/useMitt.ts'
import { unreadCountManager } from '@/utils/UnreadCountManager'

export const useGlobalStore = defineStore(
  StoresEnum.GLOBAL,
  () => {
    const chatStore = useChatStore()
    const feedStore = useFeedStore()

    // 未读消息标记：好友请求未读数和新消息未读数
    // #239 PR2：A 类键 reactive→ref——收包整键替换写穿 ref.value，跨窗活同步落地（#237 终裁第 1 条）
    const unReadMark = ref<{
      newFriendUnreadCount: number
      newMsgUnreadCount: number
      newGroupUnreadCount: number
    }>({
      newFriendUnreadCount: 0,
      newGroupUnreadCount: 0,
      newMsgUnreadCount: 0
    })
    const unreadReady = ref<boolean>(true)

    // 当前阅读未读列表状态
    const currentReadUnreadList = ref<{ show: boolean; msgId: number | null }>({
      show: false,
      msgId: null
    })

    const currentSessionRoomId = ref('')
    const lastKnownSession = ref<SessionItem | null>(null)
    type CurrentSessionView = Omit<SessionItem, 'roomId'>
    const stripRoomId = (session?: SessionItem | null): CurrentSessionView | null => {
      if (!session) return null
      const { roomId: _omit, ...rest } = session
      return rest
    }
    // 当前会话信息：不暴露 roomId，统一从 currentSessionRoomId 读取
    const currentSession = computed((): CurrentSessionView | null => {
      const cachedRoomId = currentSessionRoomId.value
      if (!cachedRoomId) {
        lastKnownSession.value = null
        return null
      }

      let session: SessionItem | undefined = chatStore.getSession(cachedRoomId)
      if (!session) {
        session = chatStore.sessionList.find((item) => item.roomId === cachedRoomId)
      }
      if (session) {
        lastKnownSession.value = session
        return stripRoomId(session)
      }

      return lastKnownSession.value && lastKnownSession.value.roomId === cachedRoomId
        ? stripRoomId(lastKnownSession.value)
        : null
    })

    /** 当前选中的联系人信息 */
    const currentSelectedContact = ref<FriendItem | RequestFriendItem>()

    // 添加好友模态框信息 TODO: 虚拟列表添加好友有时候会不展示对应的用户信息
    const addFriendModalInfo = ref<{ show: boolean; uid?: string }>({
      show: false,
      uid: void 0
    })

    // 添加群聊模态框信息
    const addGroupModalInfo = ref<{ show: boolean; name?: string; avatar?: string; account?: string }>({
      show: false,
      name: '',
      avatar: '',
      account: ''
    })

    // 创建群聊模态框信息
    const createGroupModalInfo = reactive<{
      show: boolean
      isInvite: boolean // 是否为邀请模式
      selectedUid: number[] // 选中的用户ID列表
    }>({
      show: false,
      isInvite: false,
      selectedUid: []
    })

    /** 提示框显示状态 */
    const tipVisible = ref<boolean>(false)
    /** 系统托盘菜单显示的状态 */
    const isTrayMenuShow = ref<boolean>(false)

    // 设置提示框显示状态
    const setTipVisible = (visible: boolean) => {
      tipVisible.value = visible
    }

    // 更新全局未读消息计数
    const updateGlobalUnreadCount = () => {
      if (!isWeb()) info('[global]更新全局未读消息计数')
      // 使用统一的计数管理器，避免重复逻辑（包含朋友圈未读数）
      unreadCountManager.calculateTotal(chatStore.sessionList, unReadMark.value, feedStore.unreadCount)
    }

    // 兜底同步 Dock/角标，防止未读数与徽章不同步
    watch(
      () => ({
        msg: unReadMark.value.newMsgUnreadCount,
        friend: unReadMark.value.newFriendUnreadCount,
        group: unReadMark.value.newGroupUnreadCount,
        feed: feedStore.unreadCount // 添加朋友圈未读数监听
      }),
      () => {
        if (!unreadReady.value) return
        unreadCountManager.refreshBadge(unReadMark.value, feedStore.unreadCount)
      }
    )

    // 监听当前会话变化，添加防重复触发逻辑
    watch(currentSessionRoomId, async (val, oldVal) => {
      if (!val || val === oldVal) {
        return
      }

      try {
        await chatStore.changeRoom()
      } catch (error) {
        console.error('[global] 切换会话时加载消息失败:', error)
        return
      }

      const webviewWindowLabel = isWeb() ? { label: 'home' } : WebviewWindow.getCurrent()
      if (webviewWindowLabel.label !== 'home' && webviewWindowLabel.label !== '/mobile/message') {
        useMitt.emit(MittEnum.SESSION_CHANGED, {
          roomId: val,
          oldRoomId: oldVal ?? null
        })
        return
      }

      const session = chatStore.getSession(val)
      if (session?.unreadCount) {
        info(`[global]当前会话发生实际变化: ${oldVal} -> ${val}`)
        chatStore.markSessionRead(val)
      }

      // REQ-005 #59：进入群会话时预取当前用户的 aiclaw 归属缓存，
      // 让右键「群设置」门控能在同步 visible 谓词中读取。
      if (session?.type === RoomTypeEnum.GROUP) {
        const { useAiclawStore } = await import('@/stores/aiclaw')
        useAiclawStore().ensureLoaded()
      }

      useMitt.emit(MittEnum.SESSION_CHANGED, {
        roomId: val,
        oldRoomId: oldVal ?? null
      })
    })

    const updateCurrentSessionRoomId = (id: string) => {
      currentSessionRoomId.value = id
    }

    return {
      unReadMark,
      currentSession,
      addFriendModalInfo,
      addGroupModalInfo,
      currentSelectedContact,
      currentReadUnreadList,
      createGroupModalInfo,
      tipVisible,
      isTrayMenuShow,
      unreadReady,
      setTipVisible,
      updateGlobalUnreadCount,
      updateCurrentSessionRoomId,
      currentSessionRoomId
    }
  },
  {
    share: {
      enable: true,
      initialize: true
    },
    // #239：只主窗持久化，辅窗 noop——防多窗 last-writer-wins 快照倒退（#237 终裁第 4 条）
    persist: { storage: homeWindowOnlyStorage() }
  }
)
