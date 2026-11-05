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
}
export type AgentCatalog = {
  version: string
  framework: string
  runtimeVersion: string
  capabilities: AgentCapability[]
}
export type AgentCommandRequest = {
  requestId: string
  roomId: string
  aiclawUid: string
  operation: 'discover' | 'invoke'
  capabilityId?: string
  parameters?: Record<string, never>
  catalogVersion?: string
}
export type AgentCommandResult = Pick<AgentCommandRequest, 'requestId' | 'roomId' | 'aiclawUid' | 'operation'> & {
  status: 'accepted' | 'completed' | 'failed' | 'unsupported' | 'unknown' | 'offline'
  catalog?: AgentCatalog
  text?: string
  error?: string
}

// Never opt into the wrapper's retry mode: a lost response is not permission to invoke again.
export const postAgentCommand = (body: AgentCommandRequest) =>
  imRequest<AgentCommandResult>({ url: ImUrlEnum.AICLAW_COMMANDS, body }, { showError: false })
export const getAgentCommand = (requestId: string) =>
  imRequest<AgentCommandResult>({ url: ImUrlEnum.AICLAW_COMMAND_RESULT, params: { requestId } }, { showError: false })
