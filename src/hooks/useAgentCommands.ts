import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import {
  getAgentCommand,
  postAgentCommand,
  type AgentCapability,
  type AgentCatalog,
  type AgentCommandRequest,
  type AgentCommandResult,
  type AgentModel,
  type ModelPage
} from '@/services/agentCommands'
import { commandApprovalLock, lockCommandApproval, unlockCommandApproval } from '@/hooks/useAgentApproval'
import { useMitt } from '@/hooks/useMitt'
import { WsResponseMessageType, type CommandApprovalPayload } from '@/services/wsType'

type Target = { roomId: string; aiclawUid: string; group: boolean }
type Intent = { html: string; roomId: string; aiclawUid: string; mention?: Element; version: string }

/** Composer/API seam. Mention provenance is local node identity, never serialized HTML. */
export function useAgentCommands(
  editor: Ref<HTMLElement | undefined>,
  session: () => Target,
  isAgent: (uid: string) => boolean,
  userId: () => string = () => ''
) {
  const mentions = new WeakMap<Element, string>()
  const catalog = shallowRef<AgentCatalog>()
  const selected = shallowRef<Intent & { capability: AgentCapability }>()
  const argumentsText = ref('')
  const modelQuery = ref('')
  const models = shallowRef<ModelPage>()
  const selectedModel = shallowRef<AgentModel>()
  const modelsBusy = ref(false)
  const modelStatus = ref('')
  let modelEpoch = 0
  let pageQuery = ''
  const status = ref('')
  const requestId = ref('')
  const receipt = shallowRef<AgentCommandResult>()
  let trackedRequest: AgentCommandRequest | undefined
  let trackedIntent: Omit<Intent, 'version'> | undefined
  const busy = ref(false)
  const submitted = ref(false)
  let epoch = 0
  let blocked = false
  let consumed: Intent | undefined
  let discovered: Intent | undefined
  let approvalPollTimer: ReturnType<typeof setTimeout> | undefined
  function stopApprovalPoll() {
    if (approvalPollTimer === undefined) return
    clearTimeout(approvalPollTimer)
    approvalPollTimer = undefined
  }

  function target(): Omit<Intent, 'version'> | undefined {
    const el = editor.value
    const s = session()
    if (!el || !s.roomId || el.querySelector('#replyDiv,img,video,audio,[data-type]')) return
    const nodes = Array.from(el.querySelectorAll('[id="aitSpan"]'))
    let uid = s.aiclawUid
    let mention: Element | undefined
    if (s.group) {
      if (nodes.length !== 1) return
      mention = nodes[0]
      uid = mentions.get(mention) || ''
      // Only a leading selected mention followed by slash; no quoted or surrounding prose.
      const before = document.createRange()
      before.selectNodeContents(el)
      before.setEndBefore(mention)
      if (before.toString().trim()) return
    } else if (nodes.length) return
    if (!isAgent(uid)) return
    const clone = el.cloneNode(true) as HTMLElement
    clone.querySelectorAll('[id="aitSpan"]').forEach((node) => node.remove())
    if (!/^\/[\w.-]*$/.test((clone.textContent || '').trim())) return
    return { html: el.innerHTML, roomId: s.roomId, aiclawUid: uid, mention }
  }
  const same = (a: Omit<Intent, 'version'> | undefined, b: Omit<Intent, 'version'> | undefined) =>
    !!a && !!b && a.html === b.html && a.roomId === b.roomId && a.aiclawUid === b.aiclawUid && a.mention === b.mention

  function invalidate() {
    epoch++
    receipt.value = undefined
    trackedRequest = undefined
    trackedIntent = undefined
    requestId.value = ''
    if (consumed && consumed.html !== editor.value?.innerHTML) {
      // Submitted-draft dedup must not trap a genuinely new ordinary message.
      consumed = undefined
      blocked = false
    } else if (selected.value || consumed) blocked = true
    submitted.value = !!consumed
    selected.value = undefined
    argumentsText.value = ''
    selectedModel.value = undefined
    models.value = undefined
    modelQuery.value = ''
    modelsBusy.value = false
    modelStatus.value = ''
    modelEpoch++
    discovered = undefined
    catalog.value = undefined
    busy.value = false
    status.value = blocked ? 'changed' : ''
  }
  function cancel() {
    stopApprovalPoll()
    blocked = false
    consumed = undefined
    selected.value = undefined
    invalidate()
    requestId.value = ''
  }
  const approvalLocked = computed(() => !!commandApprovalLock(userId(), session().roomId))
  const approvalExpiresAt = computed(() => commandApprovalLock(userId(), session().roomId)?.expiresAt)
  function restoreApprovalLock() {
    const lock = commandApprovalLock(userId(), session().roomId)
    if (!lock) return
    requestId.value = lock.requestId
    status.value = 'pending'
  }
  watch(
    [() => session().roomId, () => session().aiclawUid, () => session().group],
    () => {
      cancel()
      restoreApprovalLock()
    },
    { flush: 'sync' }
  )
  restoreApprovalLock()
  useMitt.on(WsResponseMessageType.COMMAND_APPROVAL_RESULT, (data: CommandApprovalPayload) => {
    if (!data?.requestId) return
    const uid = userId()
    if (!uid || (data.callerUid && String(data.callerUid) !== uid)) return
    const roomId = String(data.roomId ?? '')
    // 只解锁该用户该房间对应的申请；旧事件/切房间/换账号不会锁住别处。
    unlockCommandApproval(uid, roomId, data.requestId)
    if (data.requestId !== requestId.value || roomId !== session().roomId) return
    if (receipt.value) {
      receipt.value =
        data.approvalStatus === 'approved'
          ? { ...receipt.value, approvalStatus: 'approved', status: 'accepted', phase: 'dispatch', error: undefined }
          : {
              ...receipt.value,
              approvalStatus: data.approvalStatus,
              status: 'noop',
              phase: 'approval',
              error: data.error || `approval_${data.approvalStatus}`
            }
    }
    status.value =
      data.approvalStatus === 'approved'
        ? 'approved'
        : data.approvalStatus === 'rejected'
          ? 'rejected'
          : data.approvalStatus === 'expired'
            ? 'expired'
            : 'invalidated'
  })
  onScopeDispose(() => {
    stopApprovalPoll()
    epoch++
  })

  const receiptStatus = (result?: AgentCommandResult) =>
    result?.status === 'accepted' ? (result.phase === 'accepted' ? 'accepted' : 'unknown') : result?.status || 'unknown'

  async function request(
    body: AgentCommandRequest,
    generation: number,
    intent: Omit<Intent, 'version'>,
    options: { page?: number; reconcile?: boolean } = {}
  ): Promise<AgentCommandResult | undefined> {
    const primary = options.page === undefined
    const current = () => {
      if (generation !== epoch || (!primary && options.page !== modelEpoch)) return false
      if (!same(intent, target())) {
        invalidate()
        return false
      }
      return true
    }
    let confirmed = primary && options.reconcile ? receipt.value : undefined
    if (primary && !options.reconcile) {
      requestId.value = body.requestId
      trackedRequest = body
      trackedIntent = intent
      receipt.value = undefined
    }
    const consume = (result: AgentCommandResult | undefined) => {
      if (!current()) return false
      if (
        !result ||
        result.requestId !== body.requestId ||
        String(result.roomId) !== body.roomId ||
        String(result.aiclawUid) !== body.aiclawUid ||
        result.operation !== body.operation
      )
        return false
      if (confirmed && confirmed.status !== 'pending') {
        if (confirmed.generation && result.generation !== confirmed.generation) return false
        for (const key of ['sessionId', 'inputId', 'messageId', 'parentId', 'turnId'] as const) {
          if (confirmed.nativeRef?.[key] && result.nativeRef?.[key] !== confirmed.nativeRef[key]) return false
        }
        if (
          confirmed.receiptRevision !== undefined &&
          (result.receiptRevision === undefined || result.receiptRevision < confirmed.receiptRevision)
        )
          return false
        if (confirmed.status === 'unknown' && result.status === 'accepted') return false
        if (!['accepted', 'unknown'].includes(confirmed.status)) return false
        // A delayed dispatch observation cannot erase a proven native ACK.
        if (confirmed.phase === 'accepted' && result.status === 'accepted' && result.phase !== 'accepted') return false
      }
      confirmed = result
      if (primary) {
        receipt.value = result
        status.value = receiptStatus(result)
        if (result.status === 'pending' && result.approvalStatus === 'pending' && result.expiresAt) {
          lockCommandApproval(userId(), body.roomId, result.requestId, result.expiresAt)
        } else if (result.approvalStatus && result.approvalStatus !== 'pending') {
          unlockCommandApproval(userId(), body.roomId, result.requestId)
          status.value = result.approvalStatus
        }
      }
      return true
    }
    const pollPending = () => {
      stopApprovalPoll()
      approvalPollTimer = setTimeout(async () => {
        approvalPollTimer = undefined
        if (generation !== epoch || !commandApprovalLock(userId(), body.roomId)) return
        try {
          const next = await getAgentCommand(body.requestId)
          if (generation !== epoch || !consume(next)) return
          if (
            next?.status === 'pending' &&
            next.approvalStatus === 'pending' &&
            commandApprovalLock(userId(), body.roomId)
          )
            pollPending()
        } catch {
          // 网络失败不制造终态；锁到期或 WS/GET 成功前继续按服务端真相重试。
          if (generation === epoch && commandApprovalLock(userId(), body.roomId)) pollPending()
        }
      }, 2_000)
    }
    try {
      let result = options.reconcile ? await getAgentCommand(body.requestId) : await postAgentCommand(body)
      if (!consume(result)) return
      // WS 可能丢失；pending 期间用有界 GET 兜底，批准/拒绝/过期后立即解锁。
      if (primary && result?.status === 'pending' && result.approvalStatus === 'pending') pollPending()
      // Bounded GET only; native work continues after the UI stops waiting.
      for (let attempt = 0; !options.reconcile && result?.status === 'accepted' && attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        if (!current()) return
        result = await getAgentCommand(body.requestId)
        if (!consume(result)) return
      }
      return confirmed
    } catch (error) {
      // Preserve the last verified receipt, not the transport failure's guess —
      // except authoritative server denials, which the caller maps to explicit states.
      // #504 P1-2：字面量 'command_policy_denied_*' 必须与服务端
      // AiclawCommandPolicyService.DENIED_CLOSED/DENIED_APPROVAL 同一常量源（含后缀 :capabilityId），改动需两侧同步。
      const denied = error instanceof Error ? error.message : String(error ?? '')
      if (denied.includes('command_policy_denied_')) throw error
      return undefined
    } finally {
      if (current() && primary) status.value = receiptStatus(confirmed)
    }
  }

  async function reconcile() {
    if (!trackedRequest || !trackedIntent || busy.value || !['accepted', 'unknown'].includes(status.value)) return
    const generation = epoch
    busy.value = true
    try {
      const body = trackedRequest
      const intent = trackedIntent
      const result = await request(body, generation, intent, { reconcile: true })
      if (
        generation === epoch &&
        body.operation === 'discover' &&
        result?.status === 'completed' &&
        result.catalog &&
        Array.isArray(result.catalog.capabilities)
      ) {
        catalog.value = result.catalog
        discovered = { ...intent, version: result.catalog.version }
        status.value = blocked ? 'changed' : ''
      }
    } finally {
      if (generation === epoch) busy.value = false
    }
  }

  async function input(composing = false) {
    invalidate()
    if (composing) return
    const current = target()
    if (!current) return
    const generation = epoch
    busy.value = true
    status.value = 'loading'
    try {
      const result = await request(
        { requestId: crypto.randomUUID(), roomId: current.roomId, aiclawUid: current.aiclawUid, operation: 'discover' },
        generation,
        current
      )
      if (generation !== epoch || !same(current, target())) return
      if (result?.status === 'completed' && result.catalog && Array.isArray(result.catalog.capabilities)) {
        catalog.value = result.catalog
        discovered = { ...current, version: result.catalog.version }
        status.value = blocked ? 'changed' : ''
      }
    } catch (error) {
      // aichatoverview#504：服务端门控拒绝（菜单过期/权限变更）用明确状态，不冒充 unknown。
      if (generation === epoch) {
        const message = error instanceof Error ? error.message : String(error ?? '')
        if (message.includes('command_policy_denied_approval')) status.value = 'needs_approval'
        else if (message.includes('command_policy_denied_closed')) status.value = 'not_permitted'
        else status.value = 'unknown'
      }
    } finally {
      if (generation === epoch) busy.value = false
    }
  }
  const capabilities = computed(() => catalog.value?.capabilities.filter((c) => c.defaultVisibility === 'public') || [])
  /** aichatoverview#504：服务端标注需主人审批的能力（closed 项已被服务端移除）。 */
  const needsApproval = (capability: AgentCapability) => capability.permission === 'approval_required'
  const executable = (capability: AgentCapability) => {
    const names =
      capability.id === 'model.set'
        ? ['providerId', 'modelId']
        : capability.id.startsWith('skill:')
          ? ['arguments']
          : []
    return (
      capability.supported &&
      capability.executable &&
      (['model.list', 'model.set', 'session.reset', 'session.compact'].includes(capability.id) ||
        (capability.id.startsWith('skill:') && capability.kind === 'skill' && capability.source === 'skill')) &&
      !capability.parameters?.some((p) => p.type !== 'string' || !names.includes(p.name))
    )
  }
  function select(capability: AgentCapability) {
    if (busy.value || consumed || !capabilities.value.includes(capability) || !same(discovered, target())) return
    if (!executable(capability)) {
      // A rejected explicit intent must not become an ordinary chat submission.
      selected.value = undefined
      blocked = true
      status.value = 'changed'
      return
    }
    selected.value = { ...discovered!, capability }
    argumentsText.value = ''
    selectedModel.value = undefined
    models.value = undefined
    modelQuery.value = ''
    modelStatus.value = ''
    modelEpoch++
    consumed = undefined
    blocked = false
    status.value = 'selected'
  }
  async function searchModels(offset = 0) {
    const intent = selected.value
    if (!intent || intent.capability.id !== 'model.set' || consumed || !same(intent, target())) return
    const query = modelQuery.value
    if (query.length > 256 || !Number.isSafeInteger(offset) || offset < 0) {
      modelStatus.value = 'parameters_invalid'
      return
    }
    if (query !== pageQuery) offset = 0
    const generation = epoch
    const pageGeneration = ++modelEpoch
    const body: AgentCommandRequest = {
      requestId: crypto.randomUUID(),
      roomId: intent.roomId,
      aiclawUid: intent.aiclawUid,
      operation: 'discover',
      capabilityId: 'model.set',
      parameters: { query, offset }
    }
    modelsBusy.value = true
    modelStatus.value = ''
    try {
      const result = await request(body, generation, intent, { page: pageGeneration })
      if (
        generation !== epoch ||
        pageGeneration !== modelEpoch ||
        query !== modelQuery.value ||
        !same(intent, target())
      )
        return
      if (result?.status !== 'completed') {
        modelStatus.value = 'unknown'
        return
      }
      if (result.catalog?.version !== intent.version) {
        modelStatus.value = 'catalog_stale'
        selectedModel.value = undefined
        return
      }
      const page = result.catalog.models
      if (!page || page.items.length > 100 || page.offset !== offset) {
        modelStatus.value = 'unknown'
        return
      }
      models.value = page
      pageQuery = query
    } catch {
      if (generation === epoch && pageGeneration === modelEpoch) modelStatus.value = 'unknown'
    } finally {
      if (generation === epoch && pageGeneration === modelEpoch) modelsBusy.value = false
    }
  }
  function chooseModel(model: AgentModel) {
    if (!consumed && models.value?.items.includes(model) && !modelsBusy.value) selectedModel.value = model
  }
  async function send(): Promise<boolean> {
    // 真实发送入口也必须被锁；不能只把按钮画成 disabled。
    if (approvalLocked.value) {
      status.value = 'pending'
      return true
    }
    if (consumed && consumed.html !== editor.value?.innerHTML) invalidate()
    if (consumed || blocked) {
      if (blocked) status.value = 'changed'
      return true
    }
    const intent = selected.value
    if (!intent) return false
    if (!same(intent, target())) {
      invalidate()
      return true
    }
    const id = intent.capability.id
    const parameters: AgentCommandRequest['parameters'] = {}
    const validId = (value: string) =>
      value.length > 0 &&
      value.length <= 256 &&
      Array.from(value).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    if (id === 'model.set') {
      const model = selectedModel.value
      if (!model || !validId(model.providerId) || !validId(model.modelId) || modelStatus.value === 'catalog_stale') {
        status.value = 'parameters_invalid'
        return true
      }
      parameters.providerId = model.providerId
      parameters.modelId = model.modelId
    } else if (id.startsWith('skill:')) {
      if (
        argumentsText.value.length > 4096 ||
        (intent.capability.parameters.some((p) => p.name === 'arguments' && p.required) && !argumentsText.value)
      ) {
        status.value = 'parameters_invalid'
        return true
      }
      parameters.arguments = argumentsText.value
    }
    consumed = intent
    submitted.value = true
    busy.value = true
    status.value = 'loading'
    const generation = ++epoch
    try {
      await request(
        {
          requestId: crypto.randomUUID(),
          roomId: intent.roomId,
          aiclawUid: intent.aiclawUid,
          operation: 'invoke',
          capabilityId: id,
          parameters,
          catalogVersion: intent.version
        },
        generation,
        intent
      )
    } catch (error) {
      // aichatoverview#504：服务端门控拒绝（菜单过期/权限变更）用明确状态，不冒充 unknown。
      if (generation === epoch) {
        const message = error instanceof Error ? error.message : String(error ?? '')
        if (message.includes('command_policy_denied_approval')) status.value = 'needs_approval'
        else if (message.includes('command_policy_denied_closed')) status.value = 'not_permitted'
        else status.value = 'unknown'
      }
    } finally {
      if (generation === epoch) busy.value = false
    }
    return true
  }
  return {
    capabilities,
    selected,
    arguments: argumentsText,
    modelQuery,
    models,
    selectedModel,
    modelsBusy,
    modelStatus,
    searchModels,
    chooseModel,
    status,
    requestId,
    receipt,
    approvalLocked,
    approvalExpiresAt,
    reconcile,
    busy,
    submitted,
    executable,
    needsApproval,
    select,
    send,
    input,
    invalidate,
    cancel,
    registerMention: (node: Element, uid: string) => {
      mentions.set(node, uid)
    }
  }
}
