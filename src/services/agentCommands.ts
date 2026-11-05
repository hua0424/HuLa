import { ImUrlEnum } from '@/enums'
import { imRequest } from '@/utils/ImRequestUtils'

export type AgentCapability = {
  id: string
  kind: 'model' | 'skill' | 'command'
  name: string
  description: string
  supported: boolean
  executable: boolean
  defaultVisibility: 'public' | 'hidden'
  scope: 'workspace' | 'conversation' | 'instance'
  parameters: { name: string; type: string; required: boolean }[]
  reason?: string
  source?: string
}
export type AgentModel = { providerId: string; modelId: string; label: string; connected: boolean }
export type ModelPage = { items: AgentModel[]; total: number; offset: number; nextOffset?: number }
export type AgentCatalog = {
  version: string
  framework: string
  runtimeVersion: string
  capabilities: AgentCapability[]
  models?: ModelPage
}
export type AgentCommandRequest = {
  requestId: string
  roomId: string
  aiclawUid: string
  operation: 'discover' | 'invoke'
  capabilityId?: string
  parameters?: { arguments?: string; providerId?: string; modelId?: string; query?: string; offset?: number }
  catalogVersion?: string
}
export type AgentCommandResult = Pick<AgentCommandRequest, 'requestId' | 'roomId' | 'aiclawUid' | 'operation'> & {
  status: 'accepted' | 'completed' | 'failed' | 'noop' | 'unsupported' | 'unknown' | 'offline'
  phase?: 'dispatch' | 'accepted' | 'outcome'
  generation?: string
  nativeRef?: { sessionId: string; inputId?: string; messageId?: string; parentId?: string; turnId?: string }
  effect?:
    | { kind: 'reset'; sessionId: string; generation: string }
    | { kind: 'compact'; controlId: string; summaryId?: string; summary: boolean }
    | { kind: 'model'; providerId: string; modelId: string; effective: 'next_request' }
  receiptRevision?: number
  reconciled?: boolean
  catalog?: AgentCatalog
  text?: string
  error?: string
}

// Never opt into the wrapper's retry mode: a lost response is not permission to invoke again.
export const postAgentCommand = (body: AgentCommandRequest) =>
  imRequest<AgentCommandResult>({ url: ImUrlEnum.AICLAW_COMMANDS, body }, { showError: false })
export const getAgentCommand = (requestId: string) =>
  imRequest<AgentCommandResult>({ url: ImUrlEnum.AICLAW_COMMAND_RESULT, params: { requestId } }, { showError: false })
