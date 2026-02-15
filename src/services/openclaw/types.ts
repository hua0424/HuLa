/**
 * OpenClaw Gateway 协议类型定义
 */

// 帧类型
export interface RequestFrame {
  type: 'req'
  id: string
  method: string
  params?: unknown
}

export interface ResponseFrame {
  type: 'res'
  id: string
  ok: boolean
  payload?: unknown
  error?: ErrorShape
}

export interface EventFrame {
  type: 'event'
  event: string
  payload?: unknown
  seq?: number
  stateVersion?: number
}

export interface ErrorShape {
  code: string
  message: string
  details?: unknown
  retryable?: boolean
  retryAfterMs?: number
}

export type GatewayFrame = RequestFrame | ResponseFrame | EventFrame

// Connect
export interface ConnectParams {
  minProtocol: number
  maxProtocol: number
  client: {
    id: string
    displayName?: string
    version: string
    platform: string
    mode: 'operator'
  }
  role: 'operator'
  scopes: string[]
  device?: {
    id: string
    publicKey: string
    signature: string
    signedAt: number
    nonce?: string
  }
  auth?: {
    token?: string
  }
  locale?: string
  userAgent?: string
}

export interface HelloOk {
  type: 'hello-ok'
  protocol: number
  server: {
    version: string
    commit?: string
    host?: string
    connId: string
  }
  features: {
    methods: string[]
    events: string[]
  }
  snapshot: GatewaySnapshot
  canvasHostUrl?: string
  auth?: {
    deviceToken: string
    role: string
    scopes: string[]
  }
  policy: {
    maxPayload: number
    maxBufferedBytes: number
    tickIntervalMs: number
  }
}

export interface GatewaySnapshot {
  presence: Record<string, PresenceEntry>
  health: Record<string, unknown>
}

export interface PresenceEntry {
  deviceId: string
  roles: string[]
  scopes: string[]
  client?: {
    id: string
    version: string
    platform: string
    mode: string
  }
  connectedAt?: number
}

// Agent
export interface AgentParams {
  message: string
  sessionKey?: string
  thinking?: string
  attachments?: unknown[]
  timeout?: number
  idempotencyKey: string
}

export interface AgentEvent {
  runId: string
  seq: number
  stream: string
  ts: number
  data: Record<string, unknown>
}

// Exec Approval
export interface ExecApprovalRequest {
  id: string
  command: string
  cwd?: string | null
  host?: string | null
  security?: string | null
  agentId?: string | null
  sessionKey?: string | null
  timeoutMs?: number
}

export interface ExecApprovalResolve {
  id: string
  decision: 'allow-once' | 'allow-always' | 'deny'
}

// 连接状态
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  HANDSHAKING = 'handshaking',
  PAIRING = 'pairing',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}
