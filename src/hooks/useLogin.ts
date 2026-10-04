import { emit, listen } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useRouter } from 'vue-router'
import { EventEnum, MittEnum, TauriCommand } from '@/enums'
import { useWindow } from '@/hooks/useWindow.ts'
import { useChatStore } from '@/stores/chat'
import { useGlobalStore } from '@/stores/global.ts'
import { LoginStatus, useWsLoginStore } from '@/stores/ws'
import { isDesktop, isMac, isMobile, isWeb } from '@/utils/PlatformConstants'
import { ErrorType, invokeSilently, invokeWithErrorHandler } from '@/utils/TauriInvokeHandler.ts'
import { useSettingStore } from '../stores/setting'
import { useGroupStore } from '../stores/group'
import { useCachedStore } from '../stores/cached'
import { useConfigStore } from '../stores/config'
import { useUserStatusStore } from '../stores/userStatus'
import { useUserStore } from '../stores/user'
import { useLoginHistoriesStore } from '../stores/loginHistory'
import rustWebSocketClient from '@/services/webSocketRust'
import { useEmojiStore } from '@/stores/emoji'
import { getAllUserState, getUserDetail } from '../utils/ImRequestUtils'
import { useNetwork } from '@vueuse/core'
import { UserInfoType } from '../services/types'
import { getEnhancedFingerprint } from '../services/fingerprint'
import { captureSessionBinding, invokeScoped as invoke, isSessionCurrent } from '@/services/sessionBinding'
import { createBootAttempt, createRequestId, logBoot, scheduleIdle } from '@/utils/bootAttempt'
import { useMitt } from './useMitt'
// 安全日志：Tauri 环境用 plugin-log，浏览器 Web 环境降级到 console.log
const logInfo = (msg: string): void => {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    import('@tauri-apps/plugin-log').then(({ info }) => void info(msg)).catch(() => {})
  } else {
    console.log('[useLogin]', msg)
  }
}
import { ensureAppStateReady } from '@/utils/AppStateReady'
import { useI18nGlobal } from '../services/i18n'
import { useInitialSyncStore } from '@/stores/initialSync'
import { openExternalUrl } from './useLinkSegments'
import { TokenManager } from '@/utils/TokenManager'

export const useLogin = () => {
  const { resizeWindow } = useWindow()
  const globalStore = useGlobalStore()
  const loginStore = useWsLoginStore()
  const chatStore = useChatStore()
  const settingStore = useSettingStore()
  const { isTrayMenuShow } = storeToRefs(globalStore)
  const groupStore = useGroupStore()
  const cachedStore = useCachedStore()
  const configStore = useConfigStore()
  const userStatusStore = useUserStatusStore()
  const userStore = useUserStore()
  const loginHistoriesStore = useLoginHistoriesStore()
  const initialSyncStore = useInitialSyncStore()
  const { createWebviewWindow } = useWindow()

  const { t, locale } = useI18nGlobal()

  /**
   * 清空 localStorage 中用户相关的持久化数据
   * 防止 Pinia 在页面刷新时自动恢复旧账号数据
   */
  const clearUserLocalStorage = () => {
    const userScopedStoreKeys = ['group', 'contacts', 'feed', 'cached']
    userScopedStoreKeys.forEach((key) => {
      localStorage.removeItem(key)
    })
    console.log('[useLogin] User localStorage has been cleared')
  }

  /**
   * 清空消息缓存和群组数据
   * 在新数据加载完成后调用，避免旧消息混入
   */
  const clearMessageCache = () => {
    // 清空消息缓存（messageMap 是 reactive Record，需要逐个删除键）
    for (const key of Object.keys(chatStore.messageMap)) {
      delete chatStore.messageMap[key]
    }
    // aichatoverview#285：账号退出/切换清理全部历史浏览进度与进行中请求
    chatStore.clearHistoryProgress()
    // 清空群组成员数据
    for (const key of Object.keys(groupStore.userListMap)) {
      delete groupStore.userListMap[key]
    }
    console.log('[useLogin] Message cache has been cleared')
  }

  /**
   * 在 composable 初始化时获取 router 实例
   * 注意: useRouter() 必须在组件 setup 上下文中调用
   * 不能在异步回调中调用 useRouter(),因为那时已经失去了 Vue 组件上下文
   * 所以在这里提前获取并保存 router 实例,供后续异步操作使用
   */
  let router: ReturnType<typeof useRouter> | null = null
  try {
    router = useRouter()
  } catch (_e) {
    void logInfo('[useLogin] 无法获取 router 实例,可能不在组件上下文中')
  }

  /** 网络连接是否正常 */
  const { isOnline } = useNetwork()
  const loading = ref(false)
  /** 登录按钮的文本内容 */
  const loginText = ref(isOnline.value ? t('login.button.login.default') : t('login.button.login.network_error'))
  const loginDisabled = ref(!isOnline.value)

  // 语言包异步加载完成后，同步更新按钮文本（仅在空闲/非加载状态下更新，避免覆盖进行中的状态文本）
  watch(locale, () => {
    if (!loading.value) {
      loginText.value = isOnline.value ? t('login.button.login.default') : t('login.button.login.network_error')
    }
  })
  /** 账号信息 */
  const info = ref({
    account: '',
    password: '',
    avatar: '',
    name: '',
    uid: ''
  })
  const uiState = ref<'manual' | 'auto'>('manual')
  /**
   * 设置登录状态(系统托盘图标，系统托盘菜单选项)
   */
  const setLoginState = async () => {
    // 登录成功后删除本地存储的wsLogin，防止用户在二维码页面刷新出二维码但是不使用二维码登录，导致二维码过期或者登录失败
    if (localStorage.getItem('wsLogin')) {
      localStorage.removeItem('wsLogin')
    }
    isTrayMenuShow.value = true
    if (!isMobile()) {
      await resizeWindow('tray', 130, 356)
    }
  }

  /**
   * 登出账号
   */
  const logout = async () => {
    globalStore.updateCurrentSessionRoomId('')
    // aichatoverview#285：退出即清理历史浏览进度与进行中请求，旧请求结果不再写入
    chatStore.clearHistoryProgress()

    const sendLogoutEvent = async () => {
      const binding = isWeb() ? null : await captureSessionBinding()
      await invokeSilently(TauriCommand.UPDATE_USER_LAST_OPT_TIME, { binding })
      await invokeSilently('ws_disconnect', { binding })
      await invokeWithErrorHandler(TauriCommand.REMOVE_TOKENS, { binding }, { showError: false })
    }

    if (isDesktop()) {
      const { createWebviewWindow } = useWindow()
      isTrayMenuShow.value = false
      try {
        await sendLogoutEvent()
        // 创建登录窗口
        await createWebviewWindow('登录', 'login', 320, 490, undefined, false, 320, 490)
        // 发送登出事件
        await emit(EventEnum.LOGOUT)

        // 调整托盘大小
        await resizeWindow('tray', 130, 44)
      } catch (_error) {
        void logInfo('创建登录窗口失败')
      }
    } else {
      try {
        await sendLogoutEvent()
        // 发送登出事件
        await emit(EventEnum.LOGOUT)
      } catch (_error) {
        void logInfo('登出失败')
        window.$message.error('登出失败')
      }
    }
  }

  // const { openExternalUrl } = useLinkSegments()

  /** 重置登录的状态 */
  const resetLoginState = async (isAutoLogin = false) => {
    // 1. 清理本地存储
    if (!isAutoLogin) {
      // TODO 未来这里需要区分账号，切换不同的account；用不同的REFRESH_TOKEN调用
      localStorage.removeItem('user')
      localStorage.removeItem('TOKEN')
      localStorage.removeItem('REFRESH_TOKEN')
    }
    settingStore.closeAutoLogin()
    loginStore.loginStatus = LoginStatus.Init
    globalStore.updateCurrentSessionRoomId('')
    // 2. 清除系统托盘图标上的未读数
    if (isMac()) {
      const homeWindow = await WebviewWindow.getByLabel('home')
      if (homeWindow) {
        await homeWindow.setBadgeCount(undefined)
      }
    }
  }

  // aichatoverview#349：分阶段同步。
  // 前台只等本地可读（会话列表本地快照 + 当前窗口首屏），其余全量预热
  // （全部群成员/群资料/各会话消息页/角标/表情预取）进 idle 补齐队列，不阻塞窗口与发送。
  // 每个补齐任务带独立 requestId，排队/执行/丢弃/失败分别记入 boot 日志。
  const scheduleBackfill = async (
    bootAttempt: string,
    tasks: Array<{ phase: string; run: () => Promise<unknown> | unknown }>
  ) => {
    const binding = isWeb() ? null : await captureSessionBinding().catch(() => null)
    if (!binding && !isWeb()) {
      logBoot(bootAttempt, createRequestId(bootAttempt, 'backfill'), 'backfill_dropped', 'binding expired')
      return
    }
    tasks.forEach(({ phase, run }, index) => {
      const requestId = createRequestId(bootAttempt, phase)
      logBoot(bootAttempt, requestId, 'backfill_queued', `depth=${tasks.length - index}`)
      scheduleIdle(async () => {
        if (binding && !isSessionCurrent(binding)) {
          logBoot(bootAttempt, requestId, 'backfill_dropped', 'binding expired')
          return
        }
        try {
          await run()
          logBoot(bootAttempt, requestId, 'backfill_done')
        } catch (error) {
          logBoot(bootAttempt, requestId, 'backfill_failed', error instanceof Error ? error.message : String(error))
        }
      })
    })
  }

  const restoreSessionSelection = (previousSessionRoomId: string) => {
    if (!previousSessionRoomId) {
      return
    }
    const sessionExists = chatStore.sessionList.some((s) => s.roomId === previousSessionRoomId)
    if (!sessionExists) {
      // 会话已不存在，清空选中（增量同步不重置仍存在的选中）
      globalStore.updateCurrentSessionRoomId('')
    }
  }

  const init = async (options?: { isInitialSync?: boolean }) => {
    const emojiStore = useEmojiStore()
    // aichatoverview#349：同 bootAttempt 串起认证/库绑定/本地可读/补齐全链路。
    const bootAttempt = createBootAttempt()
    const requestIdFor = (phase: string) => createRequestId(bootAttempt, phase)

    // 保存当前选中的会话，同步后如果该会话仍存在则恢复选中状态
    const previousSessionRoomId = globalStore.currentSessionRoomId
    logBoot(bootAttempt, requestIdFor('boot_start'), 'boot_start', `previousSession=${previousSessionRoomId || '-'}`)

    // 清空 localStorage，防止页面刷新时恢复旧账号数据
    clearUserLocalStorage()

    // 清空消息缓存，避免旧消息混入新账号
    clearMessageCache()

    // 立即清空旧账号的会话列表，并立即获取新账号数据
    // 这样用户看到的是短暂加载而不是错误的旧数据
    chatStore.sessionList.length = 0
    groupStore.groupDetails.length = 0

    // #349：业务监听先于 WS 启动（幂等实现，重复调用不重复注册 Tauri 监听）。
    // mitt 业务消费者在 App setup 顶层早已注册；这里保证生产者侧就绪才建连。
    const listenersReq = requestIdFor('listeners')
    await rustWebSocketClient.setupBusinessMessageListeners().catch((error: unknown) => {
      logBoot(bootAttempt, listenersReq, 'listeners_failed', error instanceof Error ? error.message : String(error))
    })
    logBoot(bootAttempt, listenersReq, 'listeners_ready')

    // 连接 ws：只等连接/鉴权，不等全量同步。
    // 服务端认证结果由 Rust 侧独立报告（auth_failed 位/4001 自愈），此处只记建连。
    chatStore.syncLoading = true
    try {
      await rustWebSocketClient.initConnect()
      logBoot(bootAttempt, requestIdFor('ws_connect'), 'ws_connect')

      // 会话列表优先本地可读：store 内先读本地快照上屏，再触发后台同步。
      await chatStore.getSessionList(true)
      logBoot(bootAttempt, requestIdFor('local_readable'), 'local_readable', `sessions=${chatStore.sessionList.length}`)
      restoreSessionSelection(previousSessionRoomId)

      // 用户相关数据初始化（在线状态独立分区：失败只记日志，不挡本地可读与发送）
      try {
        userStatusStore.stateList = await getAllUserState()
        logBoot(bootAttempt, requestIdFor('profile_state'), 'profile_state_ready')
      } catch (error) {
        logBoot(
          bootAttempt,
          requestIdFor('profile_state'),
          'profile_state_failed',
          error instanceof Error ? error.message : String(error)
        )
      }
      const userDetail: any = await getUserDetail()
      userStatusStore.stateId = userDetail.userStateId
      const account = {
        ...userDetail,
        client: isDesktop() ? 'PC' : 'MOBILE'
      }
      userStore.userInfo = account
      // 记住密码时保存密码到登录历史
      // 注意: 桌面端 init() 运行在 home 窗口,这里的 useLogin()/info 与登录窗口是不同实例,
      // info.value.password 为空。Login 窗口在登录成功后会将密码(+timestamp)暂存到
      // localStorage.__pendingHistoryPassword,这里读取并校验 TTL,过期视为残留废弃。
      // TTL 30s: 覆盖 home 窗口创建 + WS 连接 + getAllUserState/getUserDetail 两次 HTTP,
      // 同时避免明文密码长期残留 (init() 内 await 链已经消耗 1-3s,不能太短)
      const HISTORY_PASSWORD_TTL_MS = 30_000
      const historyEntry: any = { ...account }
      let pendingPassword = ''
      try {
        const raw = localStorage.getItem('__pendingHistoryPassword')
        if (raw) {
          const parsed = JSON.parse(raw) as { password?: string; ts?: number }
          if (parsed?.password && parsed?.ts && Date.now() - parsed.ts < HISTORY_PASSWORD_TTL_MS) {
            pendingPassword = parsed.password
          }
        }
      } catch (_e) {
        // 解析失败,忽略
      }
      const existingEntry = loginHistoriesStore.loginHistories.find((h: any) => h.account === account.account)
      if (localStorage.getItem('rememberPassword') === 'true') {
        historyEntry.password = info.value.password || pendingPassword || existingEntry?.password || ''
      } else {
        // 取消记住密码: 显式清空 history 中的旧密码
        historyEntry.password = ''
      }
      // 用完即删,避免明文密码长期残留
      localStorage.removeItem('__pendingHistoryPassword')
      loginHistoriesStore.addLoginHistory(historyEntry)
      // 初始化表情列表并在后台预取本地缓存（使用 worker + 并发限制）
      void emojiStore.initEmojis().catch(() => {
        void logInfo('[login] 初始化表情失败')
      })

      // 在 sqlite 中存储用户信息（本次 UID 的库绑定点：发送乐观消息依赖它）
      await invokeWithErrorHandler(
        TauriCommand.SAVE_USER_INFO,
        {
          userInfo: {
            uid: account.uid,
            // aichatoverview#47: 把当前用户类型入库，send_msg 创建乐观消息时使用。
            userType: userDetail.userType
          }
        },
        {
          customErrorMessage: '保存用户信息失败',
          errorType: ErrorType.Client
        }
      )
      logBoot(bootAttempt, requestIdFor('db_binding'), 'db_binding', `uid=${account.uid}`)

      // 数据初始化（配置分区独立失败：用缓存或默认值继续，不挡本地可读与发送）
      try {
        const cachedConfig = localStorage.getItem('config')
        if (cachedConfig) {
          configStore.config = JSON.parse(cachedConfig).config
        } else {
          await configStore.initConfig()
        }
        logBoot(bootAttempt, requestIdFor('profile_config'), 'profile_config_ready')
      } catch (error) {
        logBoot(
          bootAttempt,
          requestIdFor('profile_config'),
          'profile_config_failed',
          error instanceof Error ? error.message : String(error)
        )
      }
      const isInitialSync = options?.isInitialSync ?? !initialSyncStore.isSynced(account.uid)
      logBoot(bootAttempt, requestIdFor('boot_mode'), 'boot_mode', `isInitialSync=${isInitialSync}`)

      // 当前窗口首屏：本地页优先，缺页才补远端（store 内房级锁已覆盖并发）；
      // 失败只记日志，会话列表仍可读。
      const currentRoomId = globalStore.currentSessionRoomId
      if (currentRoomId) {
        try {
          await chatStore.fetchCurrentRoomRemoteOnce()
          logBoot(bootAttempt, requestIdFor('current_window'), 'current_window_ready', `room=${currentRoomId}`)
        } catch (error) {
          logBoot(
            bootAttempt,
            requestIdFor('current_window'),
            'current_window_failed',
            error instanceof Error ? error.message : String(error)
          )
        }
      }

      // 强制持久化
      chatStore.$persist?.()
      cachedStore.$persist?.()
      globalStore.$persist?.()

      await setLoginState()
      logBoot(bootAttempt, requestIdFor('foreground'), 'foreground_ready')
    } finally {
      // 前台只等本地可读与当前窗口；syncLoading 关闭后列表 spinner 消失，后台补齐继续。
      chatStore.syncLoading = false
    }

    // #349：全量预热进 idle 补齐（不阻塞返回，移动端 splash 也可直接关闭）。
    // 现有 HTTP/Rust 锁语义保留：Rust 侧 MESSAGE_SYNC_LOCK + 10s 冷却不断，
    // 前端房级锁（remoteSyncLocks）与 pLimit 并发不变。
    const groupSessions = chatStore.getGroupSessions()
    void scheduleBackfill(bootAttempt, [
      {
        phase: 'backfill_members',
        run: () =>
          Promise.all([
            ...groupSessions.map((session) => groupStore.getGroupUserList(session.roomId, true)),
            groupStore.setGroupDetails()
          ])
      },
      { phase: 'backfill_msgs', run: () => chatStore.setAllSessionMsgList(20) },
      { phase: 'backfill_badges', run: () => cachedStore.getAllBadgeList() },
      {
        phase: 'backfill_emoji',
        run: () => emojiStore.prefetchEmojiToLocal().catch(() => logInfo('[login] 预热表情缓存失败'))
      }
    ])
  }

  /**
   * 根据平台类型执行不同的跳转逻辑
   * 桌面端: 创建主窗口
   * 移动端: 路由跳转到主页
   */
  const routerOrOpenHomeWindow = async () => {
    if (isDesktop()) {
      const registerWindow = await WebviewWindow.getByLabel('register')
      if (registerWindow) {
        await registerWindow.close().catch(() => {
          void logInfo('关闭注册窗口失败')
        })
      }
      await createWebviewWindow('HuLa', 'home', 960, 720, 'login', true, 330, 480, undefined, false)
      // 只有在成功创建home窗口并且已登录的情况下才显示托盘菜单
      globalStore.isTrayMenuShow = true
    } else {
      // 移动端使用路由跳转
      router?.push('/mobile/home')
    }
  }

  const normalLogin = async (
    deviceType: 'PC' | 'MOBILE',
    syncRecentMessages: boolean,
    auto: boolean = settingStore.login.autoLogin
  ) => {
    loading.value = true
    loginText.value = t('login.status.logging_in')
    loginDisabled.value = true
    const hasStoredUserInfo = !!userStore.userInfo && !!userStore.userInfo.account
    if (auto && !hasStoredUserInfo) {
      loading.value = false
      loginDisabled.value = false
      loginText.value = isOnline.value ? t('login.button.login.default') : t('login.button.login.network_error')
      uiState.value = 'manual'
      settingStore.setAutoLogin(false)
      logInfo('自动登录信息已失效，请手动登录')
      return
    }

    // 根据auto参数决定从哪里获取登录信息
    const loginInfo = auto && userStore.userInfo ? (userStore.userInfo as UserInfoType) : info.value
    const account = loginInfo?.account
    const password = loginInfo?.password ?? info.value.password
    if (!account) {
      loading.value = false
      loginDisabled.value = false
      loginText.value = isOnline.value ? '登录' : '网络异常'
      if (auto) {
        uiState.value = 'manual'
        settingStore.setAutoLogin(false)
      }
      logInfo('账号信息缺失，请重新输入')
      return
    }

    // 存储此次登陆设备指纹
    const clientId = await getEnhancedFingerprint()
    localStorage.setItem('clientId', clientId)

    await ensureAppStateReady()

    // Web 模式：调用 webLoginCommand 替代 Tauri login_command
    if (isWeb()) {
      try {
        const { webLoginCommand } = await import('@/services/webLoginCommand')
        await webLoginCommand({ account, password, uid: auto ? userStore.userInfo?.uid : undefined }, auto)
        loginDisabled.value = true
        loading.value = false
        loginText.value = t('login.status.success_redirect')
        if (!auto && isMobile()) {
          settingStore.setAutoLogin(true)
        }
        useMitt.emit(MittEnum.MSG_INIT)
      } catch (e: any) {
        window.$message.error(e?.message ?? String(e))
        loading.value = false
        loginDisabled.value = false
        loginText.value = t('login.button.login.default')
        if (auto) {
          uiState.value = 'manual'
          loginDisabled.value = false
          loginText.value = t('login.button.login.default')
          settingStore.setAutoLogin(false)
          if (userStore.userInfo) {
            info.value.account = userStore.userInfo.account || userStore.userInfo.email || ''
            info.value.avatar = userStore.userInfo.avatar
            info.value.name = userStore.userInfo.name
            info.value.uid = userStore.userInfo.uid
          }
        }
      }
      return
    }

    invoke('login_command', {
      data: {
        account: account,
        password: password,
        deviceType: deviceType,
        systemType: '2',
        clientId: clientId,
        grantType: 'PASSWORD',
        isAutoLogin: auto,
        asyncData: syncRecentMessages,
        uid: auto ? userStore.userInfo!.uid : null
      }
    })
      .then(async (_: any) => {
        // 数据库切换已在后端 login_command 中完成
        loginDisabled.value = true
        loading.value = false
        loginText.value = t('login.status.success_redirect')

        // 仅在移动端的首次手动登录时，才默认打开自动登录开关
        if (!auto && isMobile()) {
          settingStore.setAutoLogin(true)
        }

        // 桌面端: 跨窗口暂存密码,供 home 窗口 init() 写 loginHistory 时读取
        // (useLogin() 在不同窗口是独立实例,info.value 不共享,只能通过 localStorage/store 桥接)
        // 安全考虑:附带 timestamp,init() 端校验 30s TTL,避免崩溃/异常导致明文密码残留
        if (!isMobile() && !isWeb()) {
          if (localStorage.getItem('rememberPassword') === 'true' && password) {
            localStorage.setItem('__pendingHistoryPassword', JSON.stringify({ password, ts: Date.now() }))
          } else {
            // 未勾选"记住密码"时,主动清空,避免历史残留
            localStorage.removeItem('__pendingHistoryPassword')
          }
        }

        // 移动端登录之后，初始化数据
        if (isMobile()) {
          await init()
          await invoke('hide_splash_screen') // 初始化完再关闭启动页
        }
        useMitt.emit(MittEnum.MSG_INIT)

        await routerOrOpenHomeWindow()
      })
      .catch((e: any) => {
        window.$message.error(e)
        loading.value = false
        loginDisabled.value = false
        loginText.value = t('login.button.login.default')
        // 如果是自动登录失败，切换到手动登录界面并重置按钮状态
        if (auto) {
          uiState.value = 'manual'
          loginDisabled.value = false
          loginText.value = t('login.button.login.default')
          // 取消自动登录
          settingStore.setAutoLogin(false)
          // 自动填充之前尝试登录的账号信息到手动登录表单
          if (userStore.userInfo) {
            info.value.account = userStore.userInfo.account || userStore.userInfo.email || ''
            info.value.avatar = userStore.userInfo.avatar
            info.value.name = userStore.userInfo.name
            info.value.uid = userStore.userInfo.uid
          }
          // Token 过期时,移动端跳转到登录页
          if (isMobile()) {
            router?.replace('/mobile/login')
          }
        }
      })
  }

  const giteeLogin = async () => {
    try {
      loading.value = true
      loginDisabled.value = true
      loginText.value = t('login.status.logging_in')

      const clientId = await getEnhancedFingerprint()
      localStorage.setItem('clientId', clientId)

      await ensureAppStateReady()

      const port: number = await invoke('start_oauth_server')
      const redirectUri = `http://127.0.0.1:${port}/`

      // 监听 OAuth 回调
      let isProcessing = false
      const unlisten = await listen<string>('oauth-token', async (event) => {
        if (isProcessing) return
        isProcessing = true

        try {
          const payload = event.payload || ''
          const params = new URLSearchParams(payload)
          const token = params.get('token') || ''
          const refreshToken = params.get('refreshToken') || ''
          const uid = params.get('uid') || ''
          if (!token || !refreshToken) {
            throw new Error('授权回调缺少 token 或 refreshToken')
          }
          const targetUid = uid || undefined
          // 先切换到用户专属数据库
          if (targetUid) {
            await invoke('switch_user_database', { uid: targetUid })
          }
          await TokenManager.updateToken(token, refreshToken, targetUid)
          await invoke('sync_messages', {
            param: {
              asyncData: true,
              fullSync: false,
              uid: targetUid
            }
          })
          loginDisabled.value = true
          loading.value = false
          loginText.value = t('login.status.success_redirect')
          useMitt.emit(MittEnum.MSG_INIT)
          await routerOrOpenHomeWindow()
        } catch {
          window.$message.error('Gitee 登录失败')
          loading.value = false
          loginDisabled.value = false
          loginText.value = t('login.button.login.default')
        } finally {
          if (typeof unlisten === 'function') {
            unlisten()
          }
        }
      })

      let baseUrl = ''

      // 1. 优先尝试从 Tauri 后端获取配置 (local.yaml)
      try {
        const backendSettings = (await invoke('get_settings')) as Partial<import('@/services/tauriCommand').Settings>
        if (backendSettings && backendSettings.backend) {
          // 兼容 snake_case (Rust默认) 和 camelCase (可能的序列化配置)
          // @ts-expect-error
          baseUrl = backendSettings.backend.base_url || backendSettings.backend.baseUrl || ''
        }
      } catch (_e) {
        void logInfo('Failed to get settings from backend')
      }

      // 简化：仅从后端配置读取 base_url（来源 base.yaml）

      if (!baseUrl) {
        window.$message.error('请先在设置中配置服务器地址')
        loading.value = false
        loginDisabled.value = false
        return
      }

      // 移除末尾斜杠
      baseUrl = baseUrl.replace(/\/$/, '')

      console.log('baseUrl', baseUrl)

      // 后端已配置固定回调地址 http://127.0.0.1:36677/
      const authorizeUrlEndpoint = `${baseUrl}/oauth/anyTenant/gitee/authorize-url?redirect=${encodeURIComponent(redirectUri)}`

      // 先请求后端获取真正的授权地址
      // 注意：这里需要根据项目使用的 HTTP 客户端来调用
      // 假设 invoke 无法直接调用后端 HTTP 接口，需要用 fetch 或 axios
      // 这里暂时使用 fetch，如果项目有封装好的 http client 应该使用它
      const response = await fetch(authorizeUrlEndpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      })

      const resText = await response.text()

      let resJson
      try {
        resJson = JSON.parse(resText)
      } catch (_e) {
        throw new Error(`解析响应失败: ${resText.substring(0, 100)}...`)
      }

      if (resJson.code === 200 || resJson.code === 0) {
        const giteeAuthUrl = resJson.data
        await openExternalUrl(giteeAuthUrl)
      } else {
        throw new Error(resJson.msg || '获取授权地址失败')
      }
    } catch (_e) {
      window.$message.error('Gitee 登录失败')
      loading.value = false
      loginDisabled.value = false
      loginText.value = t('login.button.login.default')
    }
  }

  const githubLogin = async () => {
    try {
      loading.value = true
      loginDisabled.value = true
      loginText.value = t('login.status.logging_in')
      const clientId = await getEnhancedFingerprint()
      localStorage.setItem('clientId', clientId)
      await ensureAppStateReady()
      const port: number = await invoke('start_oauth_server')
      const redirectUri = `http://127.0.0.1:${port}/`
      let isProcessing = false
      const unlisten = await listen<string>('oauth-token', async (event) => {
        if (isProcessing) return
        isProcessing = true
        try {
          const payload = event.payload || ''
          const params = new URLSearchParams(payload)
          const token = params.get('token') || ''
          const refreshToken = params.get('refreshToken') || ''
          const uid = params.get('uid') || ''
          if (!token || !refreshToken) {
            throw new Error('授权回调缺少 token 或 refreshToken')
          }
          const targetUid = uid || undefined
          // 先切换到用户专属数据库
          if (targetUid) {
            await invoke('switch_user_database', { uid: targetUid })
          }
          await TokenManager.updateToken(token, refreshToken, targetUid)
          await invoke('sync_messages', {
            param: {
              asyncData: true,
              fullSync: false,
              uid: targetUid
            }
          })
          loginDisabled.value = true
          loading.value = false
          loginText.value = t('login.status.success_redirect')
          useMitt.emit(MittEnum.MSG_INIT)
          await routerOrOpenHomeWindow()
        } catch {
          window.$message.error('GitHub 登录失败')
          loading.value = false
          loginDisabled.value = false
          loginText.value = t('login.button.login.default')
        } finally {
          if (typeof unlisten === 'function') {
            unlisten()
          }
        }
      })
      let baseUrl = ''
      try {
        const backendSettings = (await invoke('get_settings')) as Partial<import('@/services/tauriCommand').Settings>
        if (backendSettings && backendSettings.backend) {
          // @ts-expect-error
          baseUrl = backendSettings.backend.base_url || backendSettings.backend.baseUrl || ''
        }
      } catch (_e) {}
      if (!baseUrl) {
        window.$message.error('请先在设置中配置服务器地址')
        loading.value = false
        loginDisabled.value = false
        return
      }
      baseUrl = baseUrl.replace(/\/$/, '')
      const authorizeUrlEndpoint = `${baseUrl}/oauth/anyTenant/github/authorize-url?redirect=${encodeURIComponent(redirectUri)}`
      const response = await fetch(authorizeUrlEndpoint, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
      const resText = await response.text()
      let resJson
      try {
        resJson = JSON.parse(resText)
      } catch {
        throw new Error(`解析响应失败: ${resText.substring(0, 100)}...`)
      }
      if (resJson.code === 200 || resJson.code === 0) {
        const githubAuthUrl = resJson.data
        await openExternalUrl(githubAuthUrl)
      } else {
        throw new Error(resJson.msg || '获取授权地址失败')
      }
    } catch (_e) {
      window.$message.error('GitHub 登录失败')
      loading.value = false
      loginDisabled.value = false
      loginText.value = t('login.button.login.default')
    }
  }

  const gitcodeLogin = async () => {
    try {
      loading.value = true
      loginDisabled.value = true
      loginText.value = t('login.status.logging_in')
      const clientId = await getEnhancedFingerprint()
      localStorage.setItem('clientId', clientId)
      await ensureAppStateReady()
      const port: number = await invoke('start_oauth_server')
      const redirectUri = `http://127.0.0.1:${port}/`
      let isProcessing = false
      const unlisten = await listen<string>('oauth-token', async (event) => {
        if (isProcessing) return
        isProcessing = true
        try {
          const payload = event.payload || ''
          const params = new URLSearchParams(payload)
          const token = params.get('token') || ''
          const refreshToken = params.get('refreshToken') || ''
          const uid = params.get('uid') || ''
          if (!token || !refreshToken) {
            throw new Error('授权回调缺少 token 或 refreshToken')
          }
          const targetUid = uid || undefined
          // 先切换到用户专属数据库
          if (targetUid) {
            await invoke('switch_user_database', { uid: targetUid })
          }
          await TokenManager.updateToken(token, refreshToken, targetUid)
          await invoke('sync_messages', {
            param: {
              asyncData: true,
              fullSync: false,
              uid: targetUid
            }
          })
          loginDisabled.value = true
          loading.value = false
          loginText.value = t('login.status.success_redirect')
          useMitt.emit(MittEnum.MSG_INIT)
          await routerOrOpenHomeWindow()
        } finally {
          if (typeof unlisten === 'function') {
            unlisten()
          }
        }
      })
      let baseUrl = ''
      try {
        const backendSettings = (await invoke('get_settings')) as Partial<import('@/services/tauriCommand').Settings>
        if (backendSettings && backendSettings.backend) {
          // @ts-expect-error
          baseUrl = backendSettings.backend.base_url || backendSettings.backend.baseUrl || ''
        }
      } catch (_e) {}
      if (!baseUrl) {
        window.$message.error('请先在设置中配置服务器地址')
        loading.value = false
        loginDisabled.value = false
        return
      }
      baseUrl = baseUrl.replace(/\/$/, '')
      const authorizeUrlEndpoint = `${baseUrl}/oauth/anyTenant/gitcode/authorize-url?redirect=${encodeURIComponent(redirectUri)}`
      const response = await fetch(authorizeUrlEndpoint, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
      const resText = await response.text()
      let resJson
      try {
        resJson = JSON.parse(resText)
      } catch {
        throw new Error(`解析响应失败: ${resText.substring(0, 100)}...`)
      }
      if (resJson.code === 200 || resJson.code === 0) {
        const gitcodeAuthUrl = resJson.data
        await openExternalUrl(gitcodeAuthUrl)
      } else {
        throw new Error(resJson.msg || '获取授权地址失败')
      }
    } catch (_e) {
      window.$message.error('GitCode 登录失败')
      loading.value = false
      loginDisabled.value = false
      loginText.value = t('login.button.login.default')
    }
  }

  return {
    resetLoginState,
    setLoginState,
    logout,
    normalLogin,
    giteeLogin,
    githubLogin,
    gitcodeLogin,
    loading,
    loginText,
    loginDisabled,
    info,
    uiState,
    init
  }
}
