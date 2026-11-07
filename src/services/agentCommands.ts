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
  /** aichatoverview#504：服务端判定标注（open/需主人审批）；closed 项已被服务端移除 */
  permission?: 'open' | 'approval_required'
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
export type AgentCommandApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'invalidated'
export type AgentCommandResult = Pick<AgentCommandRequest, 'requestId' | 'roomId' | 'aiclawUid' | 'operation'> & {
  status: 'pending' | 'accepted' | 'completed' | 'failed' | 'noop' | 'unsupported' | 'unknown' | 'offline'
  approvalStatus?: AgentCommandApprovalStatus
  expiresAt?: number
  phase?: 'dispatch' | 'accepted' | 'outcome' | 'approval'
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

/** aichatoverview#505：主人待审批列表（服务端只返回当前认证主人的申请）。 */
export type AgentCommandApproval = {
  requestId: string
  roomId: string
  aiclawUid: string
  capabilityId?: string
  parameters?: AgentCommandRequest['parameters']
  callerUid: string
  expiresAt: number
}
export const getAgentCommandApprovals = () =>
  imRequest<AgentCommandApproval[]>({ url: ImUrlEnum.AICLAW_COMMAND_APPROVALS }, { showError: false })
export const approveAgentCommand = (requestId: string) =>
  imRequest<AgentCommandResult>({ url: ImUrlEnum.AICLAW_COMMAND_APPROVE, params: { requestId } }, { showError: false })
export const rejectAgentCommand = (requestId: string) =>
  imRequest<AgentCommandResult>({ url: ImUrlEnum.AICLAW_COMMAND_REJECT, params: { requestId } }, { showError: false })

/** aichatoverview#504：主人命令权限行（默认规则行 roomId=0，群覆盖行 roomId>0）。 */
export type CommandPolicyRow = {
  roomId: number
  capabilityId: string
  state: 'open' | 'closed' | 'approval_required'
  mode?: 'all' | 'list' | null
  allowedUids?: number[] | null
  version?: number | null
}
/** aichatoverview#504：主人命令权限视图（仅主人可见）。 */
export type CommandPolicy = {
  defaults: CommandPolicyRow[]
  rows: CommandPolicyRow[]
  effective: Record<string, string>
}
export type CommandPolicyUpdateItem = {
  capabilityId: string
  state: 'open' | 'closed' | 'approval_required'
  mode?: 'all' | 'list'
  allowedUids?: number[]
  version?: number
}
/** aichatoverview#504：读取默认规则与覆盖行（roomId 缺省=默认规则）。 */
export const getCommandPolicy = (params: { aiclawUid: string; roomId?: string }) =>
  imRequest<CommandPolicy>({ url: ImUrlEnum.AICLAW_COMMAND_POLICY, params }, { showError: false })
/** aichatoverview#504：主人更新（仅主人；显式行 insert 或版本 CAS update）。 */
export const putCommandPolicy = (body: { aiclawUid: string; roomId?: string; items: CommandPolicyUpdateItem[] }) =>
  imRequest<unknown>({ url: ImUrlEnum.AICLAW_COMMAND_POLICY_UPDATE, body }, { showError: false })
