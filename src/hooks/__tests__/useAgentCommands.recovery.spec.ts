import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentCommandRequest } from '@/services/agentCommands'

const api = vi.hoisted(() => ({ postAgentCommand: vi.fn(), getAgentCommand: vi.fn() }))
vi.mock('@/services/agentCommands', () => api)
const identity = { backendKey: 'test-backend', uid: '11', sessionEpoch: 7 }
const scopes: ReturnType<typeof effectScope>[] = []
const capability = {
  id: 'skill:example',
  name: 'Example',
  kind: 'skill' as const,
  source: 'skill',
  supported: true,
  executable: true,
  defaultVisibility: 'public' as const,
  scope: 'instance' as const,
  parameters: [{ name: 'arguments', type: 'string', required: false }]
}
let submitted: AgentCommandRequest

async function setup(binding: typeof identity | null = identity, roomId = 'r1', aiclawUid = 'agent') {
  const { sessionBinding } = await import('@/services/sessionBinding')
  sessionBinding.value = binding
  const { useAgentCommands } = await import('../useAgentCommands')
  const scope = effectScope()
  scopes.push(scope)
  const editor = ref(document.createElement('div'))
  const session = ref({ roomId, aiclawUid, group: false })
  const user = ref('11')
  const commands = scope.run(() =>
    useAgentCommands(
      editor,
      () => session.value,
      () => true,
      () => user.value
    )
  )!
  return { commands, editor, scope, session, sessionBinding, user }
}
async function submit() {
  const mounted = await setup()
  mounted.editor.value.textContent = '/'
  await mounted.commands.input()
  mounted.commands.select(mounted.commands.capabilities.value[0])
  mounted.commands.arguments.value = 'SECRET-ARGUMENT'
  await mounted.commands.send()
  return mounted
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  localStorage.clear()
  api.postAgentCommand.mockImplementation(async (body: AgentCommandRequest) => {
    if (body.operation === 'discover')
      return { ...body, status: 'completed', catalog: { version: 'v1', capabilities: [capability] } }
    submitted = body
    return { ...body, status: 'pending', approvalStatus: 'pending', expiresAt: Date.now() + 60_000 }
  })
  api.getAgentCommand.mockImplementation(async () => ({
    ...submitted,
    status: 'completed',
    approvalStatus: 'approved',
    phase: 'outcome'
  }))
})
afterEach(async () => {
  scopes.splice(0).forEach((scope) => scope.stop())
  const { clearCommandApprovalLocks } = await import('../useAgentApproval')
  clearCommandApprovalLocks()
  localStorage.clear()
  vi.clearAllMocks()
  vi.useRealTimers()
})

it('hydrates after a real module reset using only storage and the authoritative reload identity, without POST or touching a new draft', async () => {
  const old = await submit()
  const expiresAt = old.commands.approvalExpiresAt.value
  old.scope.stop()
  const { clearCommandApprovalLocks } = await import('../useAgentApproval')
  clearCommandApprovalLocks()
  const stored = JSON.stringify(localStorage)
  expect(stored).not.toContain('SECRET-ARGUMENT')
  expect(stored).not.toContain('parameters')
  expect(stored).not.toContain('catalog')
  vi.resetModules()
  api.getAgentCommand.mockImplementationOnce(async () => ({
    ...submitted,
    status: 'pending',
    approvalStatus: 'pending',
    expiresAt
  }))
  vi.advanceTimersByTime(50_000)
  const restored = await setup()
  restored.editor.value.textContent = 'new ordinary draft'
  await flush()
  expect(api.getAgentCommand).toHaveBeenCalledWith(submitted.requestId)
  expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
  expect(restored.commands.approvalExpiresAt.value).toBe(expiresAt)
  expect(restored.commands.approvalLocked.value).toBe(true)
  vi.advanceTimersByTime(10_000)
  expect(restored.commands.approvalLocked.value).toBe(false)
  expect(restored.editor.value.textContent).toBe('new ordinary draft')
})

it('recovers on remount and reconnect with the original ID despite a changed draft and never replays POST', async () => {
  const old = await submit()
  old.scope.stop()
  api.getAgentCommand.mockRejectedValueOnce(new Error('offline'))
  const restored = await setup()
  restored.editor.value.textContent = 'keep me'
  await flush()
  const { useMitt } = await import('../useMitt')
  const { WsResponseMessageType } = await import('@/services/wsType')
  useMitt.emit(WsResponseMessageType.ONLINE, { _sessionBinding: identity })
  await flush()
  expect(api.getAgentCommand).toHaveBeenCalledTimes(2)
  expect(api.getAgentCommand).toHaveBeenLastCalledWith(submitted.requestId)
  expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
  expect(restored.commands.status.value).toBe('completed')
  expect(restored.commands.approvalLocked.value).toBe(false)
  expect(restored.editor.value.textContent).toBe('keep me')
})

it.each([null, { ...identity, uid: '22' }, { ...identity, backendKey: 'other' }, { ...identity, sessionEpoch: 8 }])(
  'does not hydrate under an untrusted or different identity %j',
  async (binding) => {
    const old = await submit()
    old.scope.stop()
    vi.resetModules()
    const restored = await setup(binding)
    await flush()
    expect(api.getAgentCommand).not.toHaveBeenCalled()
    expect(restored.commands.requestId.value).toBe('')
    expect(restored.commands.approvalLocked.value).toBe(false)
  }
)

it.each([
  ['r2', 'agent'],
  ['r1', 'other-agent']
])('does not restore another room/agent %s/%s', async (room, agent) => {
  const old = await submit()
  old.scope.stop()
  const restored = await setup(identity, room, agent)
  await flush()
  expect(api.getAgentCommand).not.toHaveBeenCalled()
  expect(restored.commands.requestId.value).toBe('')
})

it.each([
  { observed: undefined },
  { binding: { ...identity, sessionEpoch: 6 } },
  { receipt: { operation: 'discover' } },
  { receipt: { status: 'granted' } },
  { receipt: { expiresAt: 'later' } }
])('rejects malformed or foreign persisted metadata without GET or POST %j', async (patch) => {
  const old = await submit()
  old.scope.stop()
  const key = Object.keys(localStorage).find((key) => key.startsWith('agent-command-recovery:'))!
  const stored = JSON.parse(localStorage.getItem(key)!)
  localStorage.setItem(key, JSON.stringify({ ...stored, ...patch, receipt: { ...stored.receipt, ...patch.receipt } }))
  vi.resetModules()
  const restored = await setup()
  await flush()
  expect(api.getAgentCommand).not.toHaveBeenCalled()
  expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
  expect(restored.commands.requestId.value).toBe('')
  expect(restored.commands.approvalLocked.value).toBe(false)
})

it('ignores a deferred old GET after identity changes and does not unlock the new room', async () => {
  const old = await submit()
  old.scope.stop()
  let resolve!: (result: unknown) => void
  api.getAgentCommand.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const restored = await setup()
  await flush()
  restored.sessionBinding.value = { ...identity, sessionEpoch: 8 }
  restored.editor.value.textContent = 'different login draft'
  resolve({ ...submitted, status: 'completed', phase: 'outcome', approvalStatus: 'approved' })
  await flush()
  expect(restored.commands.receipt.value).toBeUndefined()
  expect(restored.commands.requestId.value).toBe('')
  expect(restored.editor.value.textContent).toBe('different login draft')
})

it('unlocks at the original pending deadline but keeps unknown recovery GET-only, and approved work survives that deadline', async () => {
  const old = await submit()
  old.scope.stop()
  vi.advanceTimersByTime(61_000)
  api.getAgentCommand.mockResolvedValueOnce({
    ...submitted,
    status: 'accepted',
    phase: 'dispatch',
    approvalStatus: 'approved'
  })
  const restored = await setup()
  await flush()
  expect(restored.commands.status.value).toBe('approved')
  expect(restored.commands.approvalLocked.value).toBe(false)
  await restored.commands.reconcile()
  expect(restored.commands.status.value).toBe('completed')
  expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
})

it('releases an expired pending lock without inventing an execution outcome when GET is offline', async () => {
  const old = await submit()
  old.scope.stop()
  vi.advanceTimersByTime(61_000)
  api.getAgentCommand.mockRejectedValue(new Error('offline'))
  const restored = await setup()
  await flush()
  expect(restored.commands.approvalLocked.value).toBe(false)
  expect(restored.commands.status.value).toBe('unknown')
  await restored.commands.reconcile()
  expect(api.getAgentCommand).toHaveBeenCalledTimes(2)
  expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
})

it('queries the frozen submitted ID during pending polling even when its editor HTML silently changes', async () => {
  const mounted = await submit()
  mounted.editor.value.textContent = 'different draft'
  await vi.advanceTimersByTimeAsync(2_000)
  expect(mounted.commands.status.value).toBe('completed')
  expect(mounted.commands.approvalLocked.value).toBe(false)
  expect(mounted.editor.value.textContent).toBe('different draft')
  expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
})

it.each([false, true])(
  'retains submitted query ownership through real input/IME (%s) and a deferred recovery GET',
  async (composing) => {
    const old = await submit()
    const body = submitted
    old.scope.stop()
    let resolve!: (result: unknown) => void
    api.getAgentCommand.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const restored = await setup()
    await flush()
    restored.editor.value.textContent = 'my new draft'
    await restored.commands.input(composing)
    resolve({ ...body, status: 'completed', phase: 'outcome', approvalStatus: 'approved' })
    await flush()
    expect(restored.commands.requestId.value).toBe(body.requestId)
    expect(restored.commands.status.value).toBe('completed')
    expect(restored.commands.approvalLocked.value).toBe(false)
    expect(restored.editor.value.textContent).toBe('my new draft')
    expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
  }
)

it.each([false, true])(
  'unlocks the submitted ID through approved WS after real input/IME (%s), without replaying',
  async (composing) => {
    const mounted = await submit()
    const body = submitted
    mounted.editor.value.textContent = 'my new draft'
    await mounted.commands.input(composing)
    const { useMitt } = await import('../useMitt')
    const { WsResponseMessageType } = await import('@/services/wsType')
    useMitt.emit(WsResponseMessageType.COMMAND_APPROVAL_RESULT, {
      _sessionBinding: identity,
      requestId: body.requestId,
      roomId: body.roomId,
      aiclawUid: body.aiclawUid,
      callerUid: '11',
      approvalStatus: 'approved'
    })
    expect(mounted.commands.requestId.value).toBe(body.requestId)
    expect(mounted.commands.status.value).toBe('approved')
    expect(mounted.commands.approvalLocked.value).toBe(false)
    expect(mounted.editor.value.textContent).toBe('my new draft')
    expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
  }
)

it.each([false, true])(
  'keeps pending polling and approved WS monotonic across real input/IME (%s)',
  async (composing) => {
    const mounted = await submit()
    const body = submitted
    let resolve!: (result: unknown) => void
    api.getAgentCommand.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    vi.advanceTimersByTime(2_000)
    await flush()
    mounted.editor.value.textContent = 'do not replace this draft'
    await mounted.commands.input(composing)
    const { useMitt } = await import('../useMitt')
    const { WsResponseMessageType } = await import('@/services/wsType')
    useMitt.emit(WsResponseMessageType.COMMAND_APPROVAL_RESULT, {
      _sessionBinding: identity,
      requestId: body.requestId,
      roomId: body.roomId,
      aiclawUid: body.aiclawUid,
      callerUid: '11',
      approvalStatus: 'approved'
    })
    resolve({ ...body, status: 'pending', approvalStatus: 'pending', expiresAt: Date.now() + 58_000 })
    await flush()
    expect(mounted.commands.requestId.value).toBe(body.requestId)
    expect(mounted.commands.status.value).toBe('approved')
    expect(mounted.commands.approvalLocked.value).toBe(false)
    expect(mounted.editor.value.textContent).toBe('do not replace this draft')
    expect(api.getAgentCommand).toHaveBeenCalledTimes(1)
    expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
  }
)

it.each(['user', 'room', 'binding'])(
  'still rejects an edited invocation query after a true %s change',
  async (change) => {
    const old = await submit()
    const body = submitted
    old.scope.stop()
    let resolve!: (result: unknown) => void
    api.getAgentCommand.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const restored = await setup()
    await flush()
    restored.editor.value.textContent = 'new scope draft'
    await restored.commands.input(true)
    if (change === 'user') restored.user.value = '22'
    if (change === 'room') restored.session.value = { roomId: 'r2', aiclawUid: 'agent', group: false }
    if (change === 'binding') restored.sessionBinding.value = { ...identity, sessionEpoch: 8 }
    resolve({ ...body, status: 'completed', approvalStatus: 'approved', phase: 'outcome' })
    await flush()
    expect(restored.commands.requestId.value).toBe('')
    expect(restored.commands.receipt.value).toBeUndefined()
    expect(restored.commands.approvalLocked.value).toBe(false)
    expect(restored.editor.value.textContent).toBe('new scope draft')
    expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
  }
)

it('keeps the submitted owner across a real new menu lookup without using that menu as execution authority', async () => {
  const mounted = await submit()
  const body = submitted
  mounted.editor.value.textContent = '/new'
  await mounted.commands.input()
  mounted.commands.select(mounted.commands.capabilities.value[0])
  expect(mounted.commands.requestId.value).toBe(body.requestId)
  await vi.advanceTimersByTimeAsync(2_000)
  expect(mounted.commands.receipt.value?.requestId).toBe(body.requestId)
  expect(mounted.commands.status.value).toBe('completed')
  expect(mounted.commands.approvalLocked.value).toBe(false)
  expect(mounted.editor.value.textContent).toBe('/new')
  expect(api.postAgentCommand.mock.calls.filter(([request]) => request.operation === 'invoke')).toHaveLength(1)
})

it('keeps a submitted ID queryable on reconnect after real input and loss of the initial POST response', async () => {
  const mounted = await setup()
  mounted.editor.value.textContent = '/'
  await mounted.commands.input()
  mounted.commands.select(mounted.commands.capabilities.value[0])
  let reject!: (error: Error) => void
  api.postAgentCommand.mockImplementationOnce((body: AgentCommandRequest) => {
    submitted = body
    return new Promise((...callbacks) => {
      reject = callbacks[1]
    })
  })
  const pending = mounted.commands.send()
  await flush()
  const body = submitted
  mounted.editor.value.textContent = 'my pending draft'
  await mounted.commands.input(true)
  reject(new Error('response lost'))
  await pending
  const { useMitt } = await import('../useMitt')
  const { WsResponseMessageType } = await import('@/services/wsType')
  useMitt.emit(WsResponseMessageType.ONLINE, { _sessionBinding: identity })
  await flush()
  expect(api.getAgentCommand).toHaveBeenCalledWith(body.requestId)
  expect(mounted.commands.status.value).toBe('completed')
  expect(mounted.commands.requestId.value).toBe(body.requestId)
  expect(mounted.editor.value.textContent).toBe('my pending draft')
  expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
})

it('recovers an accepted request after losing the initial POST response, without treating local unknown as server evidence', async () => {
  api.postAgentCommand.mockImplementationOnce(async (body) => ({
    ...body,
    status: 'completed',
    catalog: { version: 'v1', capabilities: [capability] }
  }))
  api.postAgentCommand.mockImplementationOnce(async (body) => {
    submitted = body
    throw new Error('response lost')
  })
  const old = await submit()
  old.scope.stop()
  vi.resetModules()
  api.getAgentCommand.mockResolvedValueOnce({
    ...submitted,
    status: 'accepted',
    phase: 'accepted',
    approvalStatus: 'approved'
  })
  const restored = await setup()
  await flush()
  expect(restored.commands.status.value).toBe('accepted')
  expect(restored.commands.receipt.value?.phase).toBe('accepted')
  expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
})

it.each([
  { generation: 'other' },
  { nativeRef: { sessionId: 'other', inputId: 'i1' } },
  { nativeRef: { sessionId: 's1', inputId: 'other' } },
  { receiptRevision: 2 },
  { receiptRevision: undefined }
])('retains persisted native correlation against a stale GET %j', async (stale) => {
  const old = await submit()
  old.scope.stop()
  const accepted = {
    ...submitted,
    status: 'accepted',
    phase: 'accepted',
    approvalStatus: 'approved',
    generation: 'g1',
    nativeRef: { sessionId: 's1', inputId: 'i1' },
    receiptRevision: 3
  }
  api.getAgentCommand.mockResolvedValueOnce(accepted)
  const first = await setup()
  await flush()
  first.scope.stop()
  vi.resetModules()
  api.getAgentCommand.mockResolvedValueOnce({ ...accepted, status: 'completed', phase: 'outcome', ...stale })
  const restored = await setup()
  await flush()
  expect(restored.commands.status.value).toBe('accepted')
  expect(restored.commands.receipt.value).toMatchObject({
    generation: 'g1',
    nativeRef: { sessionId: 's1', inputId: 'i1' },
    receiptRevision: 3
  })
  expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
})

it('does not let an old same-room GET overwrite or unlock a newly submitted ID', async () => {
  const old = await submit()
  const previous = submitted
  old.scope.stop()
  let resolve!: (result: unknown) => void
  api.getAgentCommand.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const restored = await setup()
  await flush()
  // The original pending lock expires, not the execution request.
  vi.advanceTimersByTime(60_000)
  restored.editor.value.textContent = '/'
  await restored.commands.input()
  restored.commands.select(restored.commands.capabilities.value[0])
  await restored.commands.send()
  const newest = submitted
  expect(newest.requestId).not.toBe(previous.requestId)
  const { useMitt } = await import('../useMitt')
  const { WsResponseMessageType } = await import('@/services/wsType')
  useMitt.emit(WsResponseMessageType.COMMAND_APPROVAL_RESULT, {
    _sessionBinding: identity,
    requestId: previous.requestId,
    roomId: previous.roomId,
    aiclawUid: previous.aiclawUid,
    callerUid: '11',
    approvalStatus: 'approved'
  })
  expect(restored.commands.approvalLocked.value).toBe(true)
  resolve({ ...previous, status: 'completed', phase: 'outcome', approvalStatus: 'approved' })
  await flush()
  expect(restored.commands.requestId.value).toBe(newest.requestId)
  expect(restored.commands.status.value).toBe('pending')
  expect(restored.commands.approvalLocked.value).toBe(true)
})

it('never renews the original approval deadline from a later pending GET', async () => {
  const old = await submit()
  const deadline = old.commands.approvalExpiresAt.value
  old.scope.stop()
  vi.advanceTimersByTime(61_000)
  api.getAgentCommand.mockResolvedValueOnce({
    ...submitted,
    status: 'pending',
    approvalStatus: 'pending',
    expiresAt: Date.now() + 60_000
  })
  const restored = await setup()
  await flush()
  expect(restored.commands.approvalLocked.value).toBe(false)
  expect(restored.commands.receipt.value?.expiresAt).toBe(deadline)
  expect(restored.commands.status.value).toBe('unknown')
})

it('does not accept an old-binding or wrong-agent approval WS and persists verified outcome monotonically across reload', async () => {
  const old = await submit()
  const { useMitt } = await import('../useMitt')
  const { WsResponseMessageType } = await import('@/services/wsType')
  for (const event of [
    { _sessionBinding: { ...identity, sessionEpoch: 6 }, aiclawUid: 'agent' },
    { _sessionBinding: identity, aiclawUid: 'other' }
  ])
    useMitt.emit(WsResponseMessageType.COMMAND_APPROVAL_RESULT, {
      ...event,
      requestId: submitted.requestId,
      roomId: 'r1',
      callerUid: '11',
      approvalStatus: 'approved'
    })
  expect(old.commands.approvalLocked.value).toBe(true)
  old.scope.stop()
  api.getAgentCommand.mockResolvedValueOnce({
    ...submitted,
    status: 'completed',
    phase: 'outcome',
    approvalStatus: 'approved',
    generation: 'g1',
    receiptRevision: 3
  })
  const restored = await setup()
  await flush()
  expect(restored.commands.status.value).toBe('completed')
  restored.scope.stop()
  vi.resetModules()
  api.getAgentCommand.mockResolvedValueOnce({
    ...submitted,
    status: 'pending',
    approvalStatus: 'pending',
    expiresAt: Date.now() + 60_000
  })
  const reloaded = await setup()
  await flush()
  expect(reloaded.commands.status.value).toBe('completed')
  expect(reloaded.commands.approvalLocked.value).toBe(false)
})
