import { invokeScoped as invoke, listenBound as listenBase } from '@/services/sessionBinding'
import type { EventCallback, UnlistenFn } from '@tauri-apps/api/event'
import { error, info, warn } from '@tauri-apps/plugin-log'
import { useMitt } from '@/hooks/useMitt'
import { MittEnum } from '@/enums'
import { WsResponseMessageType } from '@/services/wsType'
import { useContactStore } from '@/stores/contacts'

// aichatoverview#402 真机取证探针：收集单次尝试的注册事件名（Tauri JS 侧不暴露
// callbackId，以同 attempt 内注册序号代之；见完成日志 events 列表顺序）。
let probeSink: ((event: string) => void) | null = null
const listen = <T>(event: string, callback: EventCallback<T>): Promise<UnlistenFn> => {
  probeSink?.(event)
  return listenBase<T>(event, callback)
}

/// WebSocket 连接状态
export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  ERROR = 'ERROR'
}

/// 连接健康状态
export interface ConnectionHealth {
  isHealthy: boolean
  lastPongTime?: number
  consecutiveFailures: number
  roundTripTime?: number
}

/// WebSocket 事件
export interface WebSocketEvent {
  type: 'ConnectionStateChanged' | 'MessageReceived' | 'HeartbeatStatusChanged' | 'Error'
  state?: ConnectionState
  isReconnection?: boolean
  is_reconnection?: boolean
  message?: any
  health?: ConnectionHealth
  details?: Record<string, any>
}

/**
 * Rust WebSocket 客户端封装
 * 提供与原始 WebSocket Worker 兼容的接口
 */
/**
 * 监听器管理器，类似 AbortController
 *
 * #402 清理确认语义：abort 只移除实际释放成功的监听，未确认（失败/超时）项
 * 保留在集合内并随返回值上报上层；调用方不得复用已 abort 的 controller。
 */
export class ListenerController {
  private listeners: Set<UnlistenFn> = new Set()
  private isAborted = false

  add(unlisten: UnlistenFn): void {
    if (this.isAborted) {
      // 如果已经中止，立即清理新添加的监听器（结果仅记日志，不掩盖调用方错误）
      try {
        Promise.resolve()
          .then(() => unlisten())
          .catch((err) => {
            error(`[ListenerController] 已中止后追加监听器清理失败: ${err}`)
          })
      } catch (err) {
        error(`[ListenerController] 已中止后追加监听器清理失败: ${err}`)
      }
      return
    }
    this.listeners.add(unlisten)
  }

  /**
   * 回滚本 controller 的全部监听。
   * @returns 未确认清理的 unlisten 列表（失败/超时）。空数组 = 全部确认清理。
   */
  async abort(): Promise<UnlistenFn[]> {
    if (this.isAborted) return [...this.listeners]

    this.isAborted = true

    // 逐个确认：只有实际释放成功的项才移除，失败/超时项保留并上报。
    const results = await Promise.all(
      [...this.listeners].map(async (unlisten) => {
        try {
          await Promise.race([
            Promise.resolve().then(() => unlisten()),
            new Promise((_, reject) => setTimeout(() => reject(new Error('清理超时')), 5000))
          ])
          return { unlisten, ok: true }
        } catch (err) {
          error(`[ListenerController] 清理监听器失败: ${err}`)
          return { unlisten, ok: false }
        }
      })
    )

    const unconfirmed = results.filter((r) => !r.ok).map((r) => r.unlisten)
    this.listeners = new Set(unconfirmed)
    if (unconfirmed.length > 0) {
      warn(`[ListenerController] ${unconfirmed.length} 个监听器清理未确认，已保留`)
    } else {
      info(`[ListenerController] 已清理所有监听器`)
    }
    return unconfirmed
  }

  get size(): number {
    return this.listeners.size
  }

  get aborted(): boolean {
    return this.isAborted
  }
}

export class RustWebSocketClient {
  private listenerController: ListenerController = new ListenerController()
  // aichatoverview#349：业务监听幂等——重复 mount/MSG_INIT/重连不再重复注册 Tauri 监听。
  private businessListenersReady = false
  // aichatoverview#402：单飞初始化——并发调用共享同一次尝试，不启动第二批注册。
  private businessListenersPromise: Promise<void> | null = null
  // aichatoverview#402：上次失败回滚后仍未确认清理的 unlisten，留待下次尝试先行释放。
  private pendingCleanup: UnlistenFn[] = []
  // aichatoverview#402：注册尝试序号（真机取证用探针字段）。
  private setupAttemptSeq = 0

  constructor() {
    info('[RustWS] Rust WebSocket 客户端初始化')
  }

  /**
   * 初始化 WebSocket 连接
   */
  async initConnect(): Promise<void> {
    try {
      const clientId = localStorage.getItem('clientId')

      const params = {
        clientId: clientId || ''
      }

      info(`[RustWS] 初始化连接参数: ${JSON.stringify(params)}`)

      await invoke('ws_init_connection', { params })

      info('[RustWS] WebSocket 连接初始化成功')
    } catch (err) {
      error(`[RustWS] 连接初始化失败: ${err}`)
      throw err
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    try {
      await invoke('ws_disconnect')
      info('[RustWS] WebSocket 连接已断开')
    } catch (err) {
      error(`[RustWS] 断开连接失败: ${err}`)
    }
  }

  /**
   * 发送消息
   */
  async sendMessage(data: any): Promise<void> {
    try {
      await invoke('ws_send_message', {
        params: { data }
      })
    } catch (err: any) {
      error(`[RustWS] 发送消息失败: ${err}`)
      throw err
    }
  }

  /**
   * 获取连接状态
   */
  async getState(): Promise<ConnectionState> {
    try {
      const state = await invoke<ConnectionState>('ws_get_state')
      return state
    } catch (err) {
      error(`[RustWS] 获取连接状态失败: ${err}`)
      return ConnectionState.ERROR
    }
  }

  /**
   * 强制重连
   */
  async forceReconnect(): Promise<void> {
    try {
      await invoke('ws_force_reconnect')
      info('[RustWS] 强制重连成功')
    } catch (err) {
      error(`[RustWS] 强制重连失败: ${err}`)
      throw err
    }
  }

  /**
   * 检查是否已连接
   */
  async isConnected(): Promise<boolean> {
    try {
      const connected = await invoke<boolean>('ws_is_connected')
      return connected
    } catch (err) {
      error(`[RustWS] 检查连接状态失败: ${err}`)
      return false
    }
  }

  /**
   * 更新配置
   */
  async updateConfig(config: {
    heartbeatInterval?: number
    heartbeatTimeout?: number
    maxReconnectAttempts?: number
    reconnectDelayMs?: number
  }): Promise<void> {
    try {
      await invoke('ws_update_config', {
        params: config
      })
      info('[RustWS] 配置更新成功')
    } catch (err) {
      error(`[RustWS] 配置更新失败: ${err}`)
      throw error
    }
  }

  /**
   * 设置事件监听器
   */
  // private async setupEventListener(): Promise<void> {
  //   try {
  //     info(`[RustWS] 开始设置事件监听器，当前业务监听器数量: ${this.listenerController.size}`)

  //     // 清理旧的监听器
  //     if (this.eventListener) {
  //       this.eventListener()
  //       info('[RustWS] 已清理主事件监听器')
  //     }

  //     // 高效清理所有业务监听器（并行 + 超时）
  //     const oldListenerCount = this.listenerController.size
  //     await this.listenerController.abort()
  //     this.listenerController = new ListenerController()
  //     info(`[RustWS] 已高效清理 ${oldListenerCount} 个业务监听器`)

  //     // 监听 WebSocket 事件
  //     this.eventListener = await listen<WebSocketEvent>('websocket-event', (event) => {
  //       this.handleWebSocketEvent(event.payload)
  //     })

  //     // 设置业务消息监听器
  //     await this.setupBusinessMessageListeners()

  //     info(`[RustWS] 事件监听器设置完成，新的业务监听器数量: ${this.listenerController.size}`)
  //   } catch (err) {
  //     error(`[RustWS] 设置事件监听器失败: ${err}`)
  //   }
  // }

  /**
   * 设置业务消息监听器
   * 监听 Rust 端发送的具体业务消息事件
   *
   * aichatoverview#402 单飞语义：首调用同步建立 in-flight 尝试并开始注册；
   * 并发调用等待同一成功/失败，不启动第二批监听；顺序重复调用直接返回。
   * 只有全部注册成功才置 ready；失败回滚确认后传播同一失败并允许重试。
   */
  public setupBusinessMessageListeners(): Promise<void> {
    if (this.businessListenersReady) return Promise.resolve()
    const inflight = this.businessListenersPromise
    if (inflight) return inflight
    const attempt = this.runSetupAttempt()
    this.businessListenersPromise = attempt
    const clear = () => {
      if (this.businessListenersPromise === attempt) this.businessListenersPromise = null
    }
    attempt.then(clear, clear)
    return attempt
  }

  /**
   * 单次注册尝试：先释放上次残留的未确认清理项（仍失败则拒绝本次尝试，
   * 不注册新监听——阻止盲重试堆积幽灵监听），再执行全量注册。
   */
  private async runSetupAttempt(): Promise<void> {
    const attempt = ++this.setupAttemptSeq
    const startedAt = Date.now()
    info(`[RustWS] 业务监听注册开始 attempt=${attempt}`)
    await this.drainPendingCleanup(attempt)
    const attemptEvents: string[] = []
    probeSink = (event) => {
      attemptEvents.push(event)
    }
    try {
      await this.registerBusinessListeners()
    } catch (err) {
      probeSink = null
      // 回滚本 attempt 已成功注册的监听；确认清理完成后换新 controller。
      const unconfirmed = await this.listenerController.abort()
      this.listenerController = new ListenerController()
      if (unconfirmed.length > 0) {
        this.pendingCleanup.push(...unconfirmed)
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `[RustWS] 业务监听注册失败 attempt=${attempt} 且 ${unconfirmed.length} 个监听回滚未确认（已保留，拒绝盲重试）: ${msg}`
        )
      }
      throw err
    }
    probeSink = null
    this.businessListenersReady = true
    info(
      `[RustWS] 业务监听注册完成 attempt=${attempt} listeners=${this.listenerController.size} costMs=${Date.now() - startedAt} events=[${attemptEvents.join(',')}]`
    )
  }

  /**
   * 释放上次失败残留的未确认清理项；仍有未确认则拒绝本次尝试。
   */
  private async drainPendingCleanup(attempt: number): Promise<void> {
    if (this.pendingCleanup.length === 0) return
    const pending = this.pendingCleanup
    this.pendingCleanup = []
    const stillUnconfirmed: UnlistenFn[] = []
    for (const unlisten of pending) {
      try {
        await Promise.race([
          Promise.resolve().then(() => unlisten()),
          new Promise((_, reject) => setTimeout(() => reject(new Error('清理超时')), 5000))
        ])
      } catch (err) {
        error(`[ListenerController] 残留监听器清理仍失败: ${err}`)
        stillUnconfirmed.push(unlisten)
      }
    }
    if (stillUnconfirmed.length > 0) {
      this.pendingCleanup.push(...stillUnconfirmed)
      throw new Error(
        `[RustWS] 业务监听注册拒绝 attempt=${attempt}：上次残留 ${stillUnconfirmed.length} 个监听清理仍未确认`
      )
    }
  }

  /**
   * 全量业务监听注册体（无守卫；单飞/幂等由 setupBusinessMessageListeners 保证）。
   */
  private async registerBusinessListeners(): Promise<void> {
    const contactStore = useContactStore()
    this.listenerController.add(
      await listen('ws-login-success', (event: any) => {
        info('登录成功')
        useMitt.emit(WsResponseMessageType.LOGIN_SUCCESS, event.payload)
      })
    )

    // 消息相关事件
    const listenerIndex = this.listenerController.size
    this.listenerController.add(
      await listen('ws-receive-message', (event: any) => {
        info(`[ws]收到消息[监听器${listenerIndex}]: ${JSON.stringify(event.payload)}`)
        // debugger
        useMitt.emit(WsResponseMessageType.RECEIVE_MESSAGE, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-msg-recall', (event: any) => {
        info('撤回')
        useMitt.emit(WsResponseMessageType.MSG_RECALL, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-msg-mark-item', (event: any) => {
        info(`消息标记: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.MSG_MARK_ITEM, event.payload)
      })
    )

    // 用户状态相关事件
    this.listenerController.add(
      await listen('ws-online', (event: any) => {
        info(`上线: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.ONLINE, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-offline', (event: any) => {
        info(`下线: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.OFFLINE, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-user-state-change', (event: any) => {
        info(`用户状态改变: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.USER_STATE_CHANGE, event.payload)
      })
    )

    // 好友相关事件
    this.listenerController.add(
      await listen('ws-request-new-apply', (event: any) => {
        info('好友申请')
        useMitt.emit(WsResponseMessageType.REQUEST_NEW_FRIEND, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-group-set-admin-success', (event: any) => {
        useMitt.emit(WsResponseMessageType.GROUP_SET_ADMIN_SUCCESS, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-request-notify-event', (event: any) => {
        info(`通知事件: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.NOTIFY_EVENT, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-request-approval-friend', (event: any) => {
        info(`同意好友申请: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.REQUEST_APPROVAL_FRIEND, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-member-change', (event: any) => {
        useMitt.emit(WsResponseMessageType.WS_MEMBER_CHANGE, event.payload)
      })
    )

    // 房间/群聊相关事件
    this.listenerController.add(
      await listen('ws-room-info-change', (event: any) => {
        info(`群主修改群聊信息: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.ROOM_INFO_CHANGE, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-my-room-info-change', (event: any) => {
        info(`自己修改我在群里的信息: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.MY_ROOM_INFO_CHANGE, event.payload)
      })
    )

    // REQ-016 #194：资料变更（改名/简介/头像 profile；好友备注 remark）
    this.listenerController.add(
      await listen('ws-user-info-change', (event: any) => {
        info(`资料变更: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.USER_INFO_CHANGE, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-room-group-notice-msg', (event: any) => {
        info(`发布群公告: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.ROOM_GROUP_NOTICE_MSG, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-room-edit-group-notice-msg', (event: any) => {
        info(`编辑群公告: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.ROOM_EDIT_GROUP_NOTICE_MSG, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-room-dissolution', (event: any) => {
        info(`群解散: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.ROOM_DISSOLUTION, event.payload)
      })
    )

    // 视频通话相关事件
    this.listenerController.add(
      await listen('ws-video-call-request', (event: any) => {
        info(`收到通话请求: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.VideoCallRequest, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-call-accepted', (event: any) => {
        info(`通话被接受: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.CallAccepted, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-call-rejected', (event: any) => {
        info(`通话被拒绝: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.CallRejected, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-room-closed', (event: any) => {
        info(`房间已关闭: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.RoomClosed, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-webrtc-signal', (event: any) => {
        info(`收到信令消息: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.WEBRTC_SIGNAL, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-join-video', (event: any) => {
        info(`用户加入房间: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.JoinVideo, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-leave-video', (event: any) => {
        info(`用户离开房间: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.LeaveVideo, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-dropped', (event: any) => {
        useMitt.emit(WsResponseMessageType.DROPPED, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-cancel', (event: any) => {
        info(`已取消通话: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.CANCEL, event.payload)
      })
    )

    // 系统相关事件
    this.listenerController.add(
      await listen('ws-token-expired', (event: any) => {
        info('账号在其他设备登录')
        useMitt.emit(WsResponseMessageType.TOKEN_EXPIRED, event.payload)
      })
    )

    // REQ-017 #198：Rust 侧 WS 鉴权失败（4001 + refresh-token 自愈失败）→ 跳登录重鉴
    this.listenerController.add(
      await listen('ws-auth-failed', (event: any) => {
        warn(`[RustWS] WS 鉴权失败，跳登录重鉴: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.WS_AUTH_FAILED, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-invalid-user', (event: any) => {
        info('无效用户')
        useMitt.emit(WsResponseMessageType.INVALID_USER, event.payload)
      })
    )

    // 未知消息类型
    this.listenerController.add(
      await listen('ws-unknown-message', (event: any) => {
        info(`接收到未处理类型的消息: ${JSON.stringify(event.payload)}`)
      })
    )

    this.listenerController.add(
      await listen('ws-delete-friend', (event: any) => {
        info(`删除好友: ${JSON.stringify(event.payload)}`)
        contactStore.deleteContact(event.payload)
      })
    )

    // 朋友圈相关事件
    this.listenerController.add(
      await listen('ws-feed-send-msg', (event: any) => {
        info(`收到朋友圈消息: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.FEED_SEND_MSG, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-feed-notify', (event: any) => {
        info(`收到朋友圈通知: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.FEED_NOTIFY, event.payload)
      })
    )

    // AIclaw 流式消息事件
    this.listenerController.add(
      await listen('ws-stream-start', (event: any) => {
        useMitt.emit(WsResponseMessageType.STREAM_START, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-stream-delta', (event: any) => {
        useMitt.emit(WsResponseMessageType.STREAM_DELTA, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-stream-end', (event: any) => {
        useMitt.emit(WsResponseMessageType.STREAM_END, event.payload)
      })
    )

    this.listenerController.add(
      await listen('ws-aiclaw-auth-request', (event: any) => {
        useMitt.emit(WsResponseMessageType.AICLAW_AUTH_REQUEST, event.payload)
      })
    )

    // REQ-004: AIclaw 思考流式消息事件
    this.listenerController.add(
      await listen('ws-thinking-start', (event: any) => {
        info(`AIclaw 思考开始: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.THINKING_START, event.payload)
      })
    )

    // S4 起客户端不再监听 ws-thinking-delta（思考全文改为按需 REST 拉取）

    this.listenerController.add(
      await listen('ws-thinking-end', (event: any) => {
        info(`AIclaw 思考结束: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.THINKING_END, event.payload)
      })
    )

    // REQ-004: 群配置变更广播事件
    this.listenerController.add(
      await listen('ws-group-config-change', (event: any) => {
        info(`群配置变更广播: ${JSON.stringify(event.payload)}`)
        useMitt.emit(WsResponseMessageType.AICLAW_GROUP_CONFIG_UPDATE, event.payload)
      })
    )

    // 后台联系人列表同步完成事件（离线错过群解散推送的兜底刷新）
    this.listenerController.add(
      await listen('contacts-synced', (event: any) => {
        info(`后台联系人列表同步完成: ${JSON.stringify(event.payload)}`)
        useMitt.emit(MittEnum.CONTACTS_SYNCED, event.payload)
      })
    )
  }
}
const isInTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

let rustWebSocketClient: any

if (!isInTauri) {
  // Web 模式：返回代理，运行时委托给已注册的 webSocketWebClient
  const getWebClient = () => (globalThis as any).__webSocketWebClient
  rustWebSocketClient = {
    initConnect: () => getWebClient()?.initConnect() ?? Promise.resolve(),
    disconnect: () => getWebClient()?.disconnect(),
    sendMessage: (data: any) => getWebClient()?.sendMessage(data) ?? Promise.resolve(),
    getState: () => getWebClient()?.getState() ?? Promise.resolve('DISCONNECTED'),
    isConnected: () => getWebClient()?.isConnected() ?? Promise.resolve(false),
    forceReconnect: () => getWebClient()?.forceReconnect() ?? Promise.resolve(),
    setupBusinessMessageListeners: () => getWebClient()?.setupBusinessMessageListeners() ?? Promise.resolve()
  }
} else {
  info('创建RustWebSocketClient')
  // 创建全局实例
  rustWebSocketClient = new RustWebSocketClient()
}

// 使用 Tauri 原生事件监听窗口焦点变化（跨平台兼容）
// 防止重复设置窗口焦点监听器
// let isWindowListenerInitialized = false

// if (!isWindowListenerInitialized) {
//   isWindowListenerInitialized = true
//   ;(async () => {
//     try {
//       const currentWindow = getCurrentWebviewWindow()

//       // 监听窗口获得焦点事件
//       await currentWindow.listen('tauri://focus', () => {
//         info('[RustWS] 窗口获得焦点，设置应用状态为前台')
//         rustWebSocketClient.setAppBackgroundState(false)
//       })

//       // 监听窗口失去焦点事件
//       await currentWindow.listen('tauri://blur', () => {
//         info('[RustWS] 窗口失去焦点，设置应用状态为后台')
//         rustWebSocketClient.setAppBackgroundState(true)
//       })

//       info('[RustWS] 窗口焦点事件监听器已设置')
//     } catch (err) {
//       error(`[RustWS] 设置窗口焦点监听器失败: ${err}`)
//     }
//   })()
// }

export default rustWebSocketClient
