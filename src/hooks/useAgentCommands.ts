import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import {
  getAgentCommand,
  postAgentCommand,
  type AgentCapability,
  type AgentCatalog,
  type AgentCommandRequest,
  type AgentCommandResult
} from '@/services/agentCommands'

type Target = { roomId: string; aiclawUid: string; group: boolean }
type Intent = { html: string; roomId: string; aiclawUid: string; mention?: Element; version: string }

/** Composer/API seam. Mention provenance is local node identity, never serialized HTML. */
export function useAgentCommands(
  editor: Ref<HTMLElement | undefined>,
  session: () => Target,
  isAgent: (uid: string) => boolean
) {
  const mentions = new WeakMap<Element, string>()
  const catalog = shallowRef<AgentCatalog>()
  const selected = shallowRef<Intent>()
  const status = ref('')
  const requestId = ref('')
  const busy = ref(false)
  let epoch = 0
  let blocked = false
  let consumed = false
  let discovered: Intent | undefined

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
    if (selected.value || consumed) blocked = true
    selected.value = undefined
    discovered = undefined
    catalog.value = undefined
    busy.value = false
    status.value = blocked ? 'changed' : ''
  }
  function cancel() {
    blocked = false
    consumed = false
    selected.value = undefined
    invalidate()
    requestId.value = ''
  }
  watch(() => [session().roomId, session().aiclawUid, session().group], invalidate, { flush: 'sync' })
  onScopeDispose(() => {
    epoch++
  })

  async function request(
    body: AgentCommandRequest,
    generation: number,
    intent: Omit<Intent, 'version'>
  ): Promise<AgentCommandResult | undefined> {
    requestId.value = body.requestId
    let result = await postAgentCommand(body)
    // Bounded reconciliation only; never repeat the POST after an ambiguous transport result.
    for (let attempt = 0; result?.status === 'accepted' && attempt < 10 && generation === epoch; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      if (generation !== epoch) return
      if (!same(intent, target())) {
        invalidate()
        return
      }
      result = await getAgentCommand(body.requestId)
    }
    if (generation !== epoch) return
    if (!same(intent, target())) {
      invalidate()
      return
    }
    if (
      !result ||
      result.requestId !== body.requestId ||
      String(result.roomId) !== body.roomId ||
      String(result.aiclawUid) !== body.aiclawUid ||
      result.operation !== body.operation
    ) {
      status.value = 'unknown'
      return
    }
    status.value = result.status === 'accepted' ? 'unknown' : result.status
    return result
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
    } catch {
      if (generation === epoch) status.value = 'unknown'
    } finally {
      if (generation === epoch) busy.value = false
    }
  }
  const capabilities = computed(() => catalog.value?.capabilities.filter((c) => c.defaultVisibility === 'public') || [])
  const executable = (capability: AgentCapability) =>
    capability.id === 'model.list' &&
    capability.supported &&
    capability.executable &&
    !capability.parameters?.some((p) => p.required)
  function select(capability: AgentCapability) {
    if (
      busy.value ||
      consumed ||
      !capabilities.value.includes(capability) ||
      !executable(capability) ||
      !same(discovered, target())
    )
      return
    selected.value = { ...discovered! }
    consumed = false
    blocked = false
    status.value = 'selected'
  }
  async function send(): Promise<boolean> {
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
    consumed = true
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
          capabilityId: 'model.list',
          parameters: {},
          catalogVersion: intent.version
        },
        generation,
        intent
      )
    } catch {
      if (generation === epoch) status.value = 'unknown'
    } finally {
      if (generation === epoch) busy.value = false
    }
    return true
  }
  return {
    capabilities,
    selected,
    status,
    requestId,
    busy,
    executable,
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
