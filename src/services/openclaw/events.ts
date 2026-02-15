/**
 * 事件分发器
 */

type EventHandler = (payload: unknown) => void

export class EventDispatcher {
  private handlers = new Map<string, Set<EventHandler>>()
  private wildcardHandlers = new Set<EventHandler>()

  on(event: string, handler: EventHandler): () => void {
    if (event === '*') {
      this.wildcardHandlers.add(handler)
      return () => this.wildcardHandlers.delete(handler)
    }
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }
    this.handlers.get(event)!.add(handler)
    return () => this.handlers.get(event)?.delete(handler)
  }

  once(event: string, handler: EventHandler): void {
    const wrappedHandler = (payload: unknown) => {
      this.off(event, wrappedHandler)
      handler(payload)
    }
    this.on(event, wrappedHandler)
  }

  off(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler)
  }

  dispatch(event: string, payload: unknown): void {
    this.handlers.get(event)?.forEach(h => h(payload))
    this.wildcardHandlers.forEach(h => h({ event, payload }))
  }

  clear(): void {
    this.handlers.clear()
    this.wildcardHandlers.clear()
  }
}
