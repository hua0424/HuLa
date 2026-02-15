/**
 * OpenClaw Gateway 协议层
 * 提供 WebSocket 连接、请求/响应管理、事件分发、Agent 流式处理
 */

export * from './types'
export * from './connection'
export * from './events'
export * from './agent'

import { OpenClawConnection } from './connection'
import { EventDispatcher } from './events'

// 全局连接实例
let globalConnection: OpenClawConnection | null = null

export function getConnection(): OpenClawConnection | null {
  return globalConnection
}

export function setConnection(conn: OpenClawConnection): void {
  globalConnection = conn
}

export const events = new EventDispatcher()
