import { useMitt } from '@/hooks/useMitt'
import { WsResponseMessageType } from '@/services/wsType'
import { useContactStore } from '@/stores/contacts'
import { getEnhancedFingerprint } from '@/services/fingerprint'

export enum WebConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  ERROR = 'ERROR'
}

const HEARTBEAT_INTERVAL = 9900
const MAX_RECONNECT_DELAY = 30000
const BASE_RECONNECT_DELAY = 1000

class WebSocketWebClient {
  private ws: WebSocket | null = null
  private state: WebConnectionState = WebConnectionState.DISCONNECTED
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private shouldReconnect = false
  private messageListenersSetup = false

  async initConnect(): Promise<void> {
    const wsUrlRaw = import.meta.env.VITE_WEB_WS_URL
    if (!wsUrlRaw) {
      console.error('[WebWS] VITE_WEB_WS_URL 未配置')
      return
    }
    // 支持相对路径（如 /api/ws/ws），转换为 ws:// 或 wss:// 绝对 URL
    const wsUrl = wsUrlRaw.startsWith('/')
      ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${wsUrlRaw}`
      : wsUrlRaw

    const { useUserStore } = await import('@/stores/user')
    const userStore = useUserStore()
    const token = (userStore.userInfo as any)?.token
    if (!token) {
      console.warn('[WebWS] 未找到 token，跳过 WS 连接')
      return
    }

    this.shouldReconnect = true
    this.reconnectAttempts = 0
    const clientId = await getEnhancedFingerprint()
    await this.connect(wsUrl, token, clientId)
  }

  private async connect(wsUrl: string, token: string, clientId: string): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return
    }

    this.state = WebConnectionState.CONNECTING
    const url = `${wsUrl}?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      console.log('[WebWS] 连接已建立')
      this.state = WebConnectionState.CONNECTED
      this.reconnectAttempts = 0
      this.startHeartbeat()
    }

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data)
    }

    this.ws.onerror = (err) => {
      console.error('[WebWS] 连接错误:', err)
      this.state = WebConnectionState.ERROR
    }

    this.ws.onclose = (event) => {
      console.warn('[WebWS] 连接已关闭, code:', event.code)
      this.state = WebConnectionState.DISCONNECTED
      this.stopHeartbeat()
      if (this.shouldReconnect) {
        this.scheduleReconnect()
      }
    }
  }

  private handleMessage(raw: string): void {
    let parsed: { type: string; data: any }
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.warn('[WebWS] 无法解析消息:', raw)
      return
    }

    const { type, data } = parsed
    const mitt = useMitt

    switch (type) {
      case 'loginSuccess':
        mitt.emit(WsResponseMessageType.LOGIN_SUCCESS, data)
        break
      case 'receiveMessage':
        mitt.emit(WsResponseMessageType.RECEIVE_MESSAGE, data)
        break
      case 'msgRecall':
        mitt.emit(WsResponseMessageType.MSG_RECALL, data)
        break
      case 'msgMarkItem':
        mitt.emit(WsResponseMessageType.MSG_MARK_ITEM, data)
        break
      case 'online':
        mitt.emit(WsResponseMessageType.ONLINE, data)
        break
      case 'offline':
        mitt.emit(WsResponseMessageType.OFFLINE, data)
        break
      case 'userStateChange':
        mitt.emit(WsResponseMessageType.USER_STATE_CHANGE, data)
        break
      case 'newApply':
        mitt.emit(WsResponseMessageType.REQUEST_NEW_FRIEND, data)
        break
      case 'groupSetAdmin':
        mitt.emit(WsResponseMessageType.GROUP_SET_ADMIN_SUCCESS, data)
        break
      case 'notifyEvent':
        mitt.emit(WsResponseMessageType.NOTIFY_EVENT, data)
        break
      case 'requestApprovalFriend':
        mitt.emit(WsResponseMessageType.REQUEST_APPROVAL_FRIEND, data)
        break
      case 'memberChange':
        mitt.emit(WsResponseMessageType.WS_MEMBER_CHANGE, data)
        break
      case 'roomInfoChange':
        mitt.emit(WsResponseMessageType.ROOM_INFO_CHANGE, data)
        break
      case 'myRoomInfoChange':
        mitt.emit(WsResponseMessageType.MY_ROOM_INFO_CHANGE, data)
        break
      case 'roomGroupNoticeMsg':
        mitt.emit(WsResponseMessageType.ROOM_GROUP_NOTICE_MSG, data)
        break
      case 'roomEditGroupNoticeMsg':
        mitt.emit(WsResponseMessageType.ROOM_EDIT_GROUP_NOTICE_MSG, data)
        break
      case 'roomDissolution':
        mitt.emit(WsResponseMessageType.ROOM_DISSOLUTION, data)
        break
      case 'VideoCallRequest':
        mitt.emit(WsResponseMessageType.VideoCallRequest, data)
        break
      case 'CallAccepted':
        mitt.emit(WsResponseMessageType.CallAccepted, data)
        break
      case 'CallRejected':
        mitt.emit(WsResponseMessageType.CallRejected, data)
        break
      case 'RoomClosed':
        mitt.emit(WsResponseMessageType.RoomClosed, data)
        break
      case 'WEBRTC_SIGNAL':
        mitt.emit(WsResponseMessageType.WEBRTC_SIGNAL, data)
        break
      case 'JoinVideo':
        mitt.emit(WsResponseMessageType.JoinVideo, data)
        break
      case 'LeaveVideo':
        mitt.emit(WsResponseMessageType.LeaveVideo, data)
        break
      case 'DROPPED':
        mitt.emit(WsResponseMessageType.DROPPED, data)
        break
      case 'CANCEL':
        mitt.emit(WsResponseMessageType.CANCEL, data)
        break
      case 'tokenExpired':
        mitt.emit(WsResponseMessageType.TOKEN_EXPIRED, data)
        break
      case 'invalidUser':
        mitt.emit(WsResponseMessageType.INVALID_USER, data)
        break
      case 'deleteFriend': {
        const contactStore = useContactStore()
        contactStore.deleteContact(data)
        break
      }
      case 'feedSendMsg':
        mitt.emit(WsResponseMessageType.FEED_SEND_MSG, data)
        break
      case 'feedNotify':
        mitt.emit(WsResponseMessageType.FEED_NOTIFY, data)
        break
      // AIclaw 流式消息
      case 'streamStart':
        mitt.emit(WsResponseMessageType.STREAM_START, data)
        break
      case 'streamDelta':
        mitt.emit(WsResponseMessageType.STREAM_DELTA, data)
        break
      case 'streamEnd':
        mitt.emit(WsResponseMessageType.STREAM_END, data)
        break
      case 'aiclawAuthRequest':
        mitt.emit(WsResponseMessageType.AICLAW_AUTH_REQUEST, data)
        break
      // REQ-004: AIclaw 思考流式消息
      case 'thinkingStart':
        mitt.emit(WsResponseMessageType.THINKING_START, data)
        break
      case 'thinkingDelta':
        mitt.emit(WsResponseMessageType.THINKING_DELTA, data)
        break
      case 'thinkingEnd':
        mitt.emit(WsResponseMessageType.THINKING_END, data)
        break
      // REQ-004: 群配置变更广播
      case 'groupConfigChange':
        mitt.emit(WsResponseMessageType.AICLAW_GROUP_CONFIG_UPDATE, data)
        break
      default:
        console.debug('[WebWS] 未处理的消息类型:', type)
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: '2' }))
      }
    }, HEARTBEAT_INTERVAL)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return
    const delay = Math.min(BASE_RECONNECT_DELAY * 2 ** this.reconnectAttempts, MAX_RECONNECT_DELAY)
    this.reconnectAttempts++
    this.state = WebConnectionState.RECONNECTING
    console.log(`[WebWS] ${delay}ms 后尝试重连 (第${this.reconnectAttempts}次)`)
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      const { useUserStore } = await import('@/stores/user')
      const userStore = useUserStore()
      const token = (userStore.userInfo as any)?.token
      const wsUrlRaw = import.meta.env.VITE_WEB_WS_URL
      if (token && wsUrlRaw) {
        const wsUrl = wsUrlRaw.startsWith('/')
          ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${wsUrlRaw}`
          : wsUrlRaw
        const clientId = await getEnhancedFingerprint()
        await this.connect(wsUrl, token, clientId)
      }
    }, delay)
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.stopHeartbeat()
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.state = WebConnectionState.DISCONNECTED
  }

  async sendMessage(data: any): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    } else {
      console.warn('[WebWS] WebSocket 未连接，消息发送失败')
    }
  }

  async getState(): Promise<WebConnectionState> {
    return this.state
  }

  async isConnected(): Promise<boolean> {
    return this.state === WebConnectionState.CONNECTED
  }

  async forceReconnect(): Promise<void> {
    this.disconnect()
    this.shouldReconnect = true
    await this.initConnect()
  }

  async setupBusinessMessageListeners(): Promise<void> {
    if (this.messageListenersSetup) return
    this.messageListenersSetup = true
    // Web 模式下消息监听已在 onmessage 中处理，此处为兼容接口
    console.log('[WebWS] setupBusinessMessageListeners (Web 模式，消息监听已在 onmessage 中处理)')
  }
}

const webSocketWebClient = new WebSocketWebClient()

// 注册到全局，供 webSocketRust.ts 中的 web 代理使用
;(globalThis as any).__webSocketWebClient = webSocketWebClient

export default webSocketWebClient
