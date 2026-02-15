/**
 * Agent 流式处理
 */

import type { AgentEvent, AgentParams } from './types'
import { OpenClawConnection } from './connection'

export interface AgentRunState {
  runId: string
  status: 'pending' | 'streaming' | 'tool_use' | 'completed' | 'error'
  textBuffer: string
  thinkingBuffer: string
  toolCalls: ToolCallState[]
  startedAt: number
}

export interface ToolCallState {
  id: string
  name: string
  params: unknown
  status: 'pending' | 'running' | 'success' | 'error'
  result?: unknown
  startedAt: number
  finishedAt?: number
}

export class AgentStreamHandler {
  private connection: OpenClawConnection
  private activeRuns = new Map<string, AgentRunState>()

  constructor(connection: OpenClawConnection) {
    this.connection = connection
    
    // 监听 agent 事件
    this.connection.events.on('agent', (payload) => {
      this.handleAgentEvent(payload as AgentEvent)
    })
  }

  handleAgentEvent(event: AgentEvent): void {
    let run = this.activeRuns.get(event.runId)
    if (!run) {
      run = {
        runId: event.runId,
        status: 'streaming',
        textBuffer: '',
        thinkingBuffer: '',
        toolCalls: [],
        startedAt: event.ts
      }
      this.activeRuns.set(event.runId, run)
    }

    switch (event.stream) {
      case 'text_delta':
        run.textBuffer += event.data.text ?? ''
        run.status = 'streaming'
        break

      case 'thinking':
        run.thinkingBuffer += event.data.text ?? ''
        break

      case 'tool_use':
        run.status = 'tool_use'
        run.toolCalls.push({
          id: event.data.id as string,
          name: event.data.name as string,
          params: event.data.input,
          status: 'running',
          startedAt: event.ts
        })
        break

      case 'tool_result':
        const tool = run.toolCalls.find(t => t.id === event.data.toolCallId)
        if (tool) {
          tool.result = event.data.output
          tool.status = event.data.isError ? 'error' : 'success'
          tool.finishedAt = event.ts
        }
        break

      case 'message_end':
        run.status = 'completed'
        break

      case 'error':
        run.status = 'error'
        break
    }
  }

  async sendMessage(params: AgentParams): Promise<{ runId: string }> {
    return this.connection.request('agent', params)
  }

  getRun(runId: string): AgentRunState | undefined {
    return this.activeRuns.get(runId)
  }
}
