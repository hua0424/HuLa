/**
 * OpenClaw Gateway 连接管理器
 */

import { ConnectionState, type GatewayFrame, type HelloOk, type ConnectParams } from './types'
import { RequestManager } from './request'
import { EventDispatcher } from './events'

export class OpenClawConnection {
  private ws: WebSocket | null = null
  private state: ConnectionState = ConnectionState.DISCONNECTED
  private serverInfo: HelloOk['server'] | null = null
  private features: HelloOk['features'] | null = null
  private policy: HelloOk['policy'] | null = null
  
  private requestManager = new RequestManager()
  public events = new EventDispatcher()
  
  private reconnectConfig = {
    maxAttempts: 10,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    jitterFactor: 0.3
  }
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  
  private gatewayUrl = ''
  private gatewayToken = ''
  private deviceToken = ''
  
  private device = {
    id: '',
    publicKey: '',
    privateKey: ''
  }

  getState(): ConnectionState {
    return this.state
  }

  getServerInfo(): HelloOk['server'] | null {
    return this.serverInfo
  }

  getFeatures(): HelloOk['features'] | null {
    return this.features
  }

  getPolicy(): HelloOk['policy'] | null {
    return this.policy
  }

  async connect(config: {
    gatewayUrl: string
    gatewayToken?: string
    deviceToken?: string
    device?: { id: string; publicKey: string; privateKey: string }
  }): Promise<void> {
    this.gatewayUrl = config.gatewayUrl
    this.gatewayToken = config.gatewayToken || ''
    this.deviceToken = config.deviceToken || ''
    if (config.device) {
      this.device = config.device
    }

    return this.doConnect()
  }

  private async doConnect(): Promise<void> {
    this.setState(ConnectionState.CONNECTING)
    
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.gatewayUrl)
        
        this.ws.onopen = () => {
          this.setState(ConnectionState.HANDSHAKING)
          this.startHandshake().then(resolve).catch(reject)
        }
        
        this.ws.onclose = (event) => {
          this.handleClose(event)
        }
        
        this.ws.onerror = (event) => {
          this.handleError(event)
          reject(new Error('WebSocket connection failed'))
        }
        
        this.ws.onmessage = (event) => {
          this.handleMessage(event.data)
        }
      } catch (error) {
        this.setState(ConnectionState.ERROR)
        reject(error)
      }
    })
  }

  private async startHandshake(): Promise<void> {
    // 等待 connect.challenge 事件
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Handshake timeout: no challenge received'))
      }, 10000)

      const challengeHandler = (payload: any) => {
        clearTimeout(timeout)
        this.events.off('connect.challenge', challengeHandler)
        
        // 签名 nonce
        this.sendConnect(payload.nonce).then(resolve).catch(reject)
      }

      this.events.on('connect.challenge', challengeHandler)
    })
  }

  private async sendConnect(nonce: string): Promise<void> {
    const params: ConnectParams = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'openclaw-client',
        version: '1.0.0',
        platform: navigator.platform,
        mode: 'operator'
      },
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      device: this.device.id ? {
        id: this.device.id,
        publicKey: this.device.publicKey,
        signature: '', // TODO: 实现签名
        signedAt: Date.now(),
        nonce
      } : undefined,
      auth: {
        token: this.deviceToken || this.gatewayToken || undefined
      },
      locale: navigator.language,
      userAgent: navigator.userAgent
    }

    try {
      const response = await this.requestManager.send(this.ws!, 'connect', params)
      const helloOk = response as HelloOk
      
      this.serverInfo = helloOk.server
      this.features = helloOk.features
      this.policy = helloOk.policy
      
      if (helloOk.auth?.deviceToken) {
        this.deviceToken = helloOk.auth.deviceToken
      }
      
      this.setState(ConnectionState.CONNECTED)
      this.reconnectAttempt = 0
      this.startHeartbeat()
      
      // 发送 hello-ok 后需要获取 snapshot
      // 这里简化处理
    } catch (error) {
      this.setState(ConnectionState.ERROR)
      throw error
    }
  }

  private handleMessage(data: string): void {
    try {
      const frame: GatewayFrame = JSON.parse(data)
      
      if (frame.type === 'res') {
        this.requestManager.handleResponse(frame)
      } else if (frame.type === 'event') {
        this.events.dispatch(frame.event, frame.payload)
      }
    } catch (error) {
      console.error('[OpenClaw] Failed to parse message:', error)
    }
  }

  private handleClose(_event: CloseEvent): void {
    this.stopHeartbeat()
    
    if (this.state === ConnectionState.CONNECTED) {
      this.setState(ConnectionState.RECONNECTING)
      this.scheduleReconnect()
    } else if (this.state !== ConnectionState.RECONNECTING) {
      this.setState(ConnectionState.DISCONNECTED)
    }
  }

  private handleError(_event: Event): void {
    console.error('[OpenClaw] WebSocket error')
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= this.reconnectConfig.maxAttempts) {
      this.setState(ConnectionState.ERROR)
      return
    }

    const delay = this.getReconnectDelay()
    this.reconnectAttempt++

    this.reconnectTimer = setTimeout(() => {
      this.doConnect().catch(console.error)
    }, delay)
  }

  private getReconnectDelay(): number {
    const { baseDelayMs, maxDelayMs, jitterFactor } = this.reconnectConfig
    const exponential = baseDelayMs * Math.pow(2, this.reconnectAttempt)
    const capped = Math.min(exponential, maxDelayMs)
    const jitter = capped * jitterFactor * (Math.random() * 2 - 1)
    return Math.max(0, capped + jitter)
  }

  private startHeartbeat(): void {
    if (!this.policy) return
    
    this.heartbeatTimer = setTimeout(() => {
      // 超过 2x tickIntervalMs 没收到 tick，判定连接断开
      this.handleClose(new CloseEvent('heartbeat-timeout'))
    }, this.policy.tickIntervalMs * 2)

    this.events.on('tick', () => {
      if (this.heartbeatTimer) {
        clearTimeout(this.heartbeatTimer)
      }
      this.heartbeatTimer = setTimeout(() => {
        this.handleClose(new CloseEvent('heartbeat-timeout'))
      }, this.policy!.tickIntervalMs * 2)
    })
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private setState(state: ConnectionState): void {
    this.state = state
    this.events.dispatch('stateChanged', state)
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }
    this.stopHeartbeat()
    
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    
    this.setState(ConnectionState.DISCONNECTED)
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    if (this.state !== ConnectionState.CONNECTED || !this.ws) {
      throw new Error('Not connected')
    }
    return this.requestManager.send(this.ws, method, params) as Promise<T>
  }
}
