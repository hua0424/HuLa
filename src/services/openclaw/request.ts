/**
 * 请求/响应匹配器
 */

import type { ResponseFrame, ErrorShape } from './types'

type PendingRequest = {
  resolve: (payload: unknown) => void
  reject: (error: ErrorShape) => void
  timer: ReturnType<typeof setTimeout>
}

export class RequestManager {
  private pending = new Map<string, PendingRequest>()

  send(ws: WebSocket, method: string, params?: unknown, opts?: {
    timeoutMs?: number
    idempotencyKey?: string
  }): Promise<unknown> {
    const id = opts?.idempotencyKey || globalThis.crypto.randomUUID()
    const frame = { type: 'req', id, method, params }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        const error: ErrorShape = { code: 'timeout', message: 'Request timed out' }
        reject(error)
      }, opts?.timeoutMs ?? 30000)

      this.pending.set(id, { resolve, reject, timer })
      ws.send(JSON.stringify(frame))
    })
  }

  handleResponse(frame: ResponseFrame): boolean {
    const pending = this.pending.get(frame.id)
    if (!pending) return false

    clearTimeout(pending.timer)
    this.pending.delete(frame.id)

    if (frame.ok) {
      pending.resolve(frame.payload)
    } else {
      const error = frame.error ?? { code: 'unknown', message: 'Unknown error' }
      pending.reject(error)
    }
    return true
  }

  rejectAll(reason: string): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      const error: ErrorShape = { code: 'disconnected', message: reason }
      pending.reject(error)
    }
    this.pending.clear()
  }
}
