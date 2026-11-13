import { effectScope, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ postAgentCommand: vi.fn(), getAgentCommand: vi.fn() }))
vi.mock('@/services/agentCommands', () => api)
import { useAgentCommands } from '../useAgentCommands'
import { clearCommandApprovalLocks } from '../useAgentApproval'
import { useMitt } from '../useMitt'
import { WsResponseMessageType } from '@/services/wsType'

const model = {
  id: 'model.list',
  name: 'Models',
  description: 'Native models',
  kind: 'model' as const,
  supported: true,
  executable: true,
  defaultVisibility: 'public' as const,
  scope: 'instance' as const,
  parameters: []
}
const skill = {
  ...model,
  id: 'skill:native/name',
  kind: 'skill' as const,
  source: 'skill',
  parameters: [{ name: 'arguments', type: 'string', required: false }]
}
const setModel = {
  ...model,
  id: 'model.set',
  parameters: [
    { name: 'providerId', type: 'string', required: true },
    { name: 'modelId', type: 'string', required: true }
  ]
}
const catalog = { version: 'v1', framework: 'opencode', runtimeVersion: '1', capabilities: [model] }
const scopes: ReturnType<typeof effectScope>[] = []
function setup(group = false, userId = '11') {
  const editor = ref(document.createElement('div'))
  const session = ref({ roomId: 'r1', aiclawUid: group ? '' : 'agent', group })
  const scope = effectScope()
  scopes.push(scope)
  const commands = scope.run(() =>
    useAgentCommands(
      editor,
      () => session.value,
      (uid) => uid === 'agent',
      () => userId
    )
  )!
  api.postAgentCommand.mockImplementation(async (req) => ({
    ...req,
    status: 'completed',
    catalog: req.operation === 'discover' ? catalog : undefined
  }))
  return { editor, session, commands }
}
afterEach(() => {
  scopes.splice(0).forEach((s) => s.stop())
  clearCommandApprovalLocks()
  vi.clearAllMocks()
  vi.useRealTimers()
})
it.each(['session.reset', 'session.compact', 'skill:native/name'])(
  'explicitly invokes native capability %s with its own parameters',
  async (id) => {
    const { editor, commands } = setup()
    const capability = id.startsWith('skill:') ? skill : { ...model, id }
    api.postAgentCommand.mockImplementation(async (body) => ({
      ...body,
      status: 'completed',
      catalog: { ...catalog, capabilities: [capability] }
    }))
    editor.value.textContent = '/'
    await commands.input()
    commands.select(commands.capabilities.value[0])
    commands.arguments.value = '  https://example.test/<literal>\n keep whitespace '
    expect(await commands.send()).toBe(true)
    expect(api.postAgentCommand.mock.calls[1][0]).toMatchObject({
      capabilityId: id,
      parameters: id.startsWith('skill:') ? { arguments: '  https://example.test/<literal>\n keep whitespace ' } : {}
    })
  }
)

it.each([
  { kind: 'skill' as const, source: undefined },
  { kind: 'skill' as const, source: 'command' },
  { kind: 'skill' as const, source: 'mcp' },
  { kind: 'command' as const, source: 'skill' }
])('rejects skill provenance $kind/$source without executing or falling back to chat', async (provenance) => {
  const { editor, commands } = setup()
  api.postAgentCommand.mockImplementation(async (body) => ({
    ...body,
    status: 'completed',
    catalog: { ...catalog, capabilities: [{ ...skill, ...provenance }] }
  }))
  editor.value.textContent = '/'
  await commands.input()
  const capability = commands.capabilities.value[0]
  expect(commands.executable(capability)).toBe(false)
  commands.select(capability)
  expect(commands.selected.value).toBeUndefined()
  expect(await commands.send()).toBe(true)
  expect(api.postAgentCommand).toHaveBeenCalledTimes(1)
})

it('blocks missing model parameters then sends the exact disconnected native pair, without splitting IDs', async () => {
  const { editor, commands } = setup()
  const nativeModel = { providerId: 'provider/a', modelId: 'models/b:c', label: 'Native model', connected: false }
  api.postAgentCommand.mockImplementation(async (body) => ({
    ...body,
    status: 'completed',
    catalog: {
      ...catalog,
      capabilities: [setModel],
      models: { items: [nativeModel], total: 8944, offset: 0, nextOffset: 100 }
    }
  }))
  editor.value.textContent = '/'
  await commands.input()
  commands.select(commands.capabilities.value[0])
  expect(await commands.send()).toBe(true)
  expect(commands.status.value).toBe('parameters_invalid')
  expect(api.postAgentCommand.mock.calls.filter(([body]) => body.operation === 'invoke')).toHaveLength(0)
  await commands.searchModels()
  commands.chooseModel(commands.models.value!.items[0])
  await commands.send()
  expect(api.postAgentCommand.mock.calls.at(-1)![0]).toMatchObject({
    capabilityId: 'model.set',
    parameters: { providerId: 'provider/a', modelId: 'models/b:c' }
  })
})

it.each(['budget', 'network'])(
  'retains verified native acceptance after %s and explicitly reconciles without POST',
  async (failure) => {
    vi.useFakeTimers()
    const { editor, commands } = setup()
    editor.value.textContent = '/'
    await commands.input()
    commands.select(commands.capabilities.value[0])
    const nativeRef = { sessionId: 'native-old', inputId: 'input-1' }
    api.postAgentCommand.mockImplementationOnce(async (body) => ({
      ...body,
      status: 'accepted',
      phase: 'accepted',
      receiptRevision: 1,
      nativeRef,
      generation: '7'
    }))
    api.getAgentCommand.mockImplementation(async () => {
      if (failure === 'network') throw new Error('disconnected')
      return {
        ...api.postAgentCommand.mock.calls[1][0],
        status: 'accepted',
        phase: 'accepted',
        receiptRevision: 1,
        nativeRef,
        generation: '7'
      }
    })
    const pending = commands.send()
    await vi.runAllTimersAsync()
    await pending
    expect(commands.status.value).toBe('accepted')
    expect(commands.receipt.value).toMatchObject({ nativeRef, generation: '7', receiptRevision: 1 })
    api.getAgentCommand.mockResolvedValue({
      ...api.postAgentCommand.mock.calls[1][0],
      status: 'noop',
      phase: 'outcome',
      receiptRevision: 2,
      nativeRef,
      generation: '7'
    })
    await commands.reconcile()
    expect(commands.status.value).toBe('noop')
    expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
  }
)

it('rejects a foreign accepted POST before polling and reconciles only the original ID', async () => {
  const { editor, commands } = setup()
  editor.value.textContent = '/'
  await commands.input()
  commands.select(commands.capabilities.value[0])
  api.postAgentCommand.mockImplementationOnce(async (body) => ({
    ...body,
    roomId: 'foreign',
    status: 'accepted',
    phase: 'accepted'
  }))
  await commands.send()
  expect(commands.status.value).toBe('unknown')
  expect(api.getAgentCommand).not.toHaveBeenCalled()
  const body = api.postAgentCommand.mock.calls[1][0]
  api.getAgentCommand.mockResolvedValue({
    ...body,
    status: 'completed',
    phase: 'outcome',
    receiptRevision: 2,
    reconciled: true
  })
  await commands.reconcile()
  expect(api.getAgentCommand).toHaveBeenCalledWith(body.requestId)
  expect(commands.status.value).toBe('completed')
  expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
})

it('pages the full inventory, retains explicit selection across pages and resets new search to zero', async () => {
  vi.useFakeTimers()
  const { editor, commands } = setup()
  const first = { providerId: 'p/one', modelId: 'id/one', label: 'One', connected: false }
  const second = { providerId: 'p/two', modelId: 'id/two', label: 'Two', connected: true }
  api.postAgentCommand.mockImplementation(async (body) => ({
    ...body,
    status: body.capabilityId ? 'accepted' : 'completed',
    phase: 'dispatch',
    catalog: { ...catalog, capabilities: [setModel] }
  }))
  api.getAgentCommand.mockImplementation(async (requestId) => {
    const body = api.postAgentCommand.mock.calls.find(([body]) => body.requestId === requestId)![0]
    return {
      ...body,
      status: 'completed',
      catalog: {
        ...catalog,
        models: {
          items: [body.parameters.offset ? second : first],
          total: body.parameters.query ? 1 : 8944,
          offset: body.parameters.offset,
          nextOffset: body.parameters.offset || body.parameters.query ? undefined : 100
        }
      }
    }
  })
  editor.value.textContent = '/'
  await commands.input()
  commands.select(commands.capabilities.value[0])
  const originalId = commands.requestId.value
  let pending = commands.searchModels()
  await vi.runAllTimersAsync()
  await pending
  commands.chooseModel(commands.models.value!.items[0])
  pending = commands.searchModels(100)
  await vi.runAllTimersAsync()
  await pending
  expect(commands.models.value).toMatchObject({ total: 8944, offset: 100, items: [second] })
  expect(commands.selectedModel.value).toEqual(first)
  expect(commands.requestId.value).toBe(originalId)
  commands.modelQuery.value = 'specific'
  pending = commands.searchModels(100)
  await vi.runAllTimersAsync()
  await pending
  expect(api.postAgentCommand.mock.calls.at(-1)![0].parameters).toEqual({ query: 'specific', offset: 0 })
  expect(commands.models.value).toMatchObject({ total: 1, offset: 0 })
  expect(commands.models.value?.nextOffset).toBeUndefined()
})

it('ignores stale model searches and never silently selects a replacement', async () => {
  const { editor, commands } = setup()
  api.postAgentCommand.mockImplementation(async (body) => ({
    ...body,
    status: 'completed',
    catalog: { ...catalog, capabilities: [setModel] }
  }))
  editor.value.textContent = '/'
  await commands.input()
  commands.select(commands.capabilities.value[0])
  let resolve!: (value: unknown) => void
  api.postAgentCommand.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r
      })
  )
  const oldSearch = commands.searchModels()
  const oldBody = api.postAgentCommand.mock.calls.at(-1)![0]
  commands.modelQuery.value = 'new'
  api.postAgentCommand.mockImplementationOnce(async (body) => ({
    ...body,
    status: 'completed',
    catalog: { ...catalog, models: { items: [], total: 0, offset: 0 } }
  }))
  await commands.searchModels()
  resolve({
    ...oldBody,
    status: 'completed',
    catalog: {
      ...catalog,
      models: { items: [{ providerId: 'p', modelId: 'old', label: 'Old', connected: true }], total: 8944, offset: 0 }
    }
  })
  await oldSearch
  expect(commands.models.value?.total).toBe(0)
  expect(commands.selectedModel.value).toBeUndefined()
})

it('dismisses only local UI, allowing a new command while an old native request still runs', async () => {
  const { editor, commands } = setup()
  editor.value.textContent = '/'
  await commands.input()
  commands.select(commands.capabilities.value[0])
  let resolve!: (value: unknown) => void
  api.postAgentCommand.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r
      })
  )
  const old = commands.send()
  const oldBody = api.postAgentCommand.mock.calls.at(-1)![0]
  commands.cancel()
  await commands.input()
  commands.select(commands.capabilities.value[0])
  await commands.send()
  const newId = commands.requestId.value
  resolve({ ...oldBody, status: 'failed', phase: 'outcome' })
  await old
  expect(commands.requestId.value).toBe(newId)
  expect(newId).not.toBe(oldBody.requestId)
  expect(commands.status.value).toBe('completed')
  expect(api.postAgentCommand.mock.calls.filter(([body]) => body.operation === 'invoke')).toHaveLength(2)
})

it('restores a lost discovery through explicit GET without rediscovering or invoking', async () => {
  const { editor, commands } = setup()
  api.postAgentCommand.mockRejectedValueOnce(new Error('lost discovery'))
  editor.value.textContent = '/'
  await commands.input()
  const body = api.postAgentCommand.mock.calls[0][0]
  api.getAgentCommand.mockResolvedValue({ ...body, status: 'completed', catalog })
  await commands.reconcile()
  expect(commands.capabilities.value).toEqual([model])
  commands.select(commands.capabilities.value[0])
  expect(commands.status.value).toBe('selected')
  expect(api.postAgentCommand).toHaveBeenCalledTimes(1)
})

it('requires one genuine selected group mention, never a pasted data UID', async () => {
  const { editor, commands } = setup(true)
  editor.value.innerHTML = '<span id="aitSpan" data-ait-uid="agent">@Agent</span> /'
  await commands.input()
  expect(api.postAgentCommand).not.toHaveBeenCalled()
  const node = editor.value.firstElementChild!
  commands.registerMention(node, 'agent')
  await commands.input()
  expect(api.postAgentCommand).toHaveBeenCalledTimes(1)
  commands.select(commands.capabilities.value[0])
  node.replaceWith(node.cloneNode(true)) // identical HTML, different node identity
  expect(await commands.send()).toBe(true)
  expect(api.postAgentCommand).toHaveBeenCalledTimes(1)
  expect(commands.status.value).toBe('changed')
})
it('synchronously invalidates selected intent on edit and room change', async () => {
  const { editor, session, commands } = setup()
  editor.value.textContent = '/'
  await commands.input()
  commands.select(commands.capabilities.value[0])
  editor.value.textContent = 'ordinary edit'
  void commands.input()
  await commands.send()
  expect(api.postAgentCommand).toHaveBeenCalledTimes(1)
  commands.cancel()
  expect(await commands.send()).toBe(false)
  editor.value.textContent = '/'
  await commands.input()
  commands.select(commands.capabilities.value[0])
  session.value = { roomId: 'r2', aiclawUid: 'agent', group: false }
  await commands.send()
  expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
})
it.each([false, true])('releases command intent in a new human room (submitted=%s)', async (submitted) => {
  const { editor, session, commands } = setup()
  editor.value.textContent = '/'
  await commands.input()
  commands.select(commands.capabilities.value[0])
  if (submitted) await commands.send()
  const count = api.postAgentCommand.mock.calls.length
  session.value = { roomId: 'human-room', aiclawUid: 'human', group: false }
  editor.value.textContent = 'normal message'
  await commands.input()
  expect(await commands.send()).toBe(false)
  expect(api.postAgentCommand).toHaveBeenCalledTimes(count)
})
it('releases a submitted draft only after actual content changes', async () => {
  const { editor, commands } = setup()
  editor.value.textContent = '/'
  await commands.input()
  commands.select(commands.capabilities.value[0])
  await commands.send()
  await commands.input() // redundant input event must not release duplicate-send protection
  expect(await commands.send()).toBe(true)
  expect(api.postAgentCommand.mock.calls.filter(([body]) => body.operation === 'invoke')).toHaveLength(1)
  editor.value.textContent = 'new ordinary message'
  await commands.input()
  expect(await commands.send()).toBe(false)
  expect(commands.status.value).toBe('')
})
it.each(['completed', 'accepted'] as const)(
  'keeps submitted intent across equal session replacement (%s)',
  async (status) => {
    vi.useFakeTimers()
    const { editor, session, commands } = setup()
    editor.value.textContent = '/'
    await commands.input()
    commands.select(commands.capabilities.value[0])
    api.postAgentCommand.mockImplementationOnce(async (body) => ({ ...body, status }))
    api.getAgentCommand.mockImplementation(async () => ({
      ...api.postAgentCommand.mock.calls[1][0],
      status: 'completed'
    }))
    const pending = commands.send()
    await Promise.resolve()
    await Promise.resolve()
    const previousStatus = commands.status.value
    const previousId = commands.requestId.value
    const previousSelected = commands.selected.value
    session.value = { ...session.value }
    expect(commands.status.value).toBe(previousStatus)
    expect(commands.requestId.value).toBe(previousId)
    expect(commands.selected.value).toBe(previousSelected)
    expect(commands.capabilities.value).toEqual([model])
    expect(await commands.send()).toBe(true)
    expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
    await vi.runAllTimersAsync()
    await pending
    expect(commands.status.value).toBe('completed')
    expect(await commands.send()).toBe(true)
    expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
  }
)
it('does not discover from quotes, attachments, multiple mentions, or IME composition', async () => {
  const { editor, commands } = setup()
  for (const html of [
    '<div id="replyDiv">quoted</div>/',
    '<img src="x">/',
    'hello /',
    '/<span id="aitSpan">@a</span>'
  ]) {
    editor.value.innerHTML = html
    await commands.input()
  }
  editor.value.textContent = '/'
  await commands.input(true)
  expect(api.postAgentCommand).not.toHaveBeenCalled()
})
it('discards an old discovery after the editor changes', async () => {
  const { editor, commands } = setup()
  let resolve!: (value: unknown) => void
  api.postAgentCommand.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r
      })
  )
  editor.value.textContent = '/'
  const loading = commands.input()
  const body = api.postAgentCommand.mock.calls[0][0]
  editor.value.textContent = 'changed'
  await commands.input()
  resolve({ ...body, status: 'completed', catalog })
  await loading
  expect(commands.capabilities.value).toEqual([])
})
it('keeps unknown invoke intent consumed rather than resending on Send', async () => {
  const { editor, commands } = setup()
  editor.value.textContent = '/'
  await commands.input()
  commands.select(commands.capabilities.value[0])
  api.postAgentCommand.mockRejectedValueOnce(new Error('lost response'))
  await commands.send()
  commands.select(commands.capabilities.value[0])
  await commands.send()
  expect(commands.status.value).toBe('unknown')
  expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
  expect(commands.requestId.value).toMatch(/^[\da-f-]{36}$/)
})
it('bounds accepted polling to the original ID and never repeats POST', async () => {
  vi.useFakeTimers()
  const { editor, commands } = setup()
  api.postAgentCommand.mockImplementationOnce(async (body) => ({ ...body, status: 'accepted' }))
  api.getAgentCommand.mockImplementation(async (requestId) => ({
    ...api.postAgentCommand.mock.calls[0][0],
    requestId,
    status: 'accepted'
  }))
  editor.value.textContent = '/'
  const pending = commands.input()
  await vi.runAllTimersAsync()
  await pending
  expect(api.postAgentCommand).toHaveBeenCalledTimes(1)
  expect(api.getAgentCommand).toHaveBeenCalledTimes(10)
  expect(api.getAgentCommand.mock.calls.every(([id]) => id === commands.requestId.value)).toBe(true)
  expect(commands.status.value).toBe('unknown')
})
it('rejects mismatched response correlation and foreign capabilities', async () => {
  const { editor, commands } = setup()
  api.postAgentCommand.mockImplementationOnce(async (body) => ({
    ...body,
    roomId: 'other',
    status: 'completed',
    catalog
  }))
  editor.value.textContent = '/'
  await commands.input()
  expect(commands.status.value).toBe('unknown')
  expect(commands.capabilities.value).toEqual([])
  await commands.input()
  commands.select({ ...model })
  expect(await commands.send()).toBe(false)
  expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
})
it('ignores invoke results after a silent editor mutation', async () => {
  const { editor, commands } = setup()
  editor.value.textContent = '/'
  await commands.input()
  commands.select(commands.capabilities.value[0])
  let resolve!: (value: unknown) => void
  api.postAgentCommand.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r
      })
  )
  const pending = commands.send()
  const body = api.postAgentCommand.mock.calls[1][0]
  editor.value.textContent = 'new draft'
  resolve({ ...body, status: 'completed' })
  await pending
  expect(commands.status.value).toBe('')
  expect(await commands.send()).toBe(false)
})
it('does not discover for human targets or ambiguous group mentions', async () => {
  const { editor, session, commands } = setup()
  session.value = { roomId: 'r1', aiclawUid: 'human', group: false }
  editor.value.textContent = '/'
  await commands.input()
  session.value = { roomId: 'r1', aiclawUid: '', group: true }
  editor.value.innerHTML = '<span id="aitSpan">@A</span><span id="aitSpan">@B</span> /'
  editor.value.querySelectorAll('span').forEach((node) => commands.registerMention(node, 'agent'))
  await commands.input()
  expect(api.postAgentCommand).not.toHaveBeenCalled()
})
it('discovers slash but invokes only after menu selection and ordinary Send', async () => {
  const { editor, commands } = setup()
  editor.value.textContent = '/'
  await commands.input()
  expect(commands.capabilities.value).toEqual([model])
  expect(await commands.send()).toBe(false)
  expect(api.postAgentCommand).toHaveBeenCalledTimes(1)
  commands.select(model)
  expect(api.postAgentCommand).toHaveBeenCalledTimes(1)
  expect(await commands.send()).toBe(true)
  expect(api.postAgentCommand.mock.calls[1][0]).toMatchObject({
    operation: 'invoke',
    capabilityId: 'model.list',
    roomId: 'r1',
    aiclawUid: 'agent',
    catalogVersion: 'v1',
    parameters: {}
  })
  await commands.send()
  expect(api.postAgentCommand).toHaveBeenCalledTimes(2)
})
// aichatoverview#504：权限标注与门控拒绝映射
it.each([
  { permission: 'open' as const, expected: false },
  { permission: 'approval_required' as const, expected: true },
  { permission: undefined, expected: false }
])('marks permission=$permission as needsApproval=$expected', async ({ permission, expected }) => {
  const { commands } = setup()
  expect(commands.needsApproval({ ...model, permission })).toBe(expected)
})
it.each([
  { gate: 'command_policy_denied_closed', expected: 'not_permitted' },
  { gate: 'command_policy_denied_approval', expected: 'needs_approval' }
])('maps server gate $gate to explicit status $expected instead of unknown', async ({ gate, expected }) => {
  const { editor, commands } = setup()
  editor.value.textContent = '/'
  await commands.input()
  commands.select(commands.capabilities.value[0])
  api.postAgentCommand.mockRejectedValueOnce(new Error(gate))
  expect(await commands.send()).toBe(true)
  expect(commands.status.value).toBe(expected)
  expect(api.postAgentCommand.mock.calls.filter(([body]) => body.operation === 'invoke')).toHaveLength(1)
})
// aichatoverview#505：pending 只锁发起人当前房间，且第二次 Send 不再发 POST。
it('locks the sending member on pending approval without a second submission', async () => {
  const { editor, commands } = setup()
  api.postAgentCommand.mockImplementation(async (body) => ({
    ...body,
    status: body.operation === 'discover' ? 'completed' : 'pending',
    catalog: body.operation === 'discover' ? catalog : undefined,
    ...(body.operation === 'invoke' ? { approvalStatus: 'pending', expiresAt: Date.now() + 60_000 } : undefined)
  }))
  editor.value.textContent = '/'
  await commands.input()
  commands.select(commands.capabilities.value[0])
  expect(await commands.send()).toBe(true)
  expect(commands.approvalLocked.value).toBe(true)
  expect(commands.status.value).toBe('pending')
  const posted = api.postAgentCommand.mock.calls.length
  expect(await commands.send()).toBe(true)
  expect(api.postAgentCommand.mock.calls.length).toBe(posted)
})
// aichatoverview#505：WS 丢失时，pending 仍以 GET 的服务端终态解锁。
it('unlocks through GET when the approval result WS event is lost', async () => {
  vi.useFakeTimers()
  const { editor, commands } = setup()
  let invoke: Record<string, unknown> | undefined
  api.postAgentCommand.mockImplementation(async (body) => {
    if (body.operation === 'discover') return { ...body, status: 'completed', catalog }
    invoke = body
    return { ...body, status: 'pending', approvalStatus: 'pending', expiresAt: Date.now() + 60_000 }
  })
  api.getAgentCommand.mockImplementation(async () => ({
    ...invoke,
    status: 'accepted',
    phase: 'dispatch',
    approvalStatus: 'approved'
  }))
  editor.value.textContent = '/'
  await commands.input()
  commands.select(commands.capabilities.value[0])
  await commands.send()
  expect(commands.approvalLocked.value).toBe(true)
  expect(commands.status.value).toBe('pending')
  await vi.advanceTimersByTimeAsync(2_000)
  expect(commands.approvalLocked.value).toBe(false)
  expect(commands.status.value).toBe('approved')
  expect(api.getAgentCommand).toHaveBeenCalledTimes(1)

  api.getAgentCommand.mockImplementation(async () => ({
    ...invoke,
    status: 'completed',
    phase: 'outcome',
    approvalStatus: 'approved',
    receiptRevision: 1
  }))
  await commands.reconcile()
  expect(commands.status.value).toBe('completed')
  expect(commands.receipt.value).toMatchObject({ status: 'completed', approvalStatus: 'approved' })
  expect(commands.approvalLocked.value).toBe(false)
  expect(api.getAgentCommand).toHaveBeenCalledTimes(2)
  expect(api.postAgentCommand.mock.calls.filter(([body]) => body.operation === 'invoke')).toHaveLength(1)
})

it.each(['accepted', 'completed', 'failed', 'noop', 'unknown'])(
  'preserves an approved execution %s through query recovery and late approval events',
  async (outcome) => {
    const phase = outcome === 'accepted' ? 'accepted' : 'outcome'
    vi.useFakeTimers()
    const { editor, commands } = setup()
    let invoke: Record<string, unknown> | undefined
    api.postAgentCommand.mockImplementation(async (body) => {
      if (body.operation === 'discover') return { ...body, status: 'completed', catalog }
      invoke = body
      return { ...body, status: 'pending', approvalStatus: 'pending', expiresAt: Date.now() + 60_000 }
    })
    api.getAgentCommand.mockImplementation(async () => ({
      ...invoke,
      status: outcome,
      phase,
      approvalStatus: 'approved',
      receiptRevision: 1
    }))
    editor.value.textContent = '/'
    await commands.input()
    commands.select(commands.capabilities.value[0])
    await commands.send()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(commands.status.value).toBe(outcome)
    expect(commands.approvalLocked.value).toBe(false)
    for (const approvalStatus of ['approved', 'expired']) {
      useMitt.emit(WsResponseMessageType.COMMAND_APPROVAL_RESULT, {
        ...invoke,
        callerUid: '11',
        approvalStatus
      })
      expect(commands.status.value).toBe(outcome)
      expect(commands.receipt.value).toMatchObject({ status: outcome, phase })
      expect(commands.approvalLocked.value).toBe(false)
    }
    expect(api.postAgentCommand.mock.calls.filter(([body]) => body.operation === 'invoke')).toHaveLength(1)
  }
)

it.each(['pending', 'dispatch', 'recovery-error'])(
  'preserves shared execution evidence across an overlapping %s GET',
  async (late) => {
    vi.useFakeTimers()
    const { editor, commands } = setup()
    let invoke: Record<string, unknown> | undefined
    api.postAgentCommand.mockImplementation(async (body) => {
      if (body.operation === 'discover') return { ...body, status: 'completed', catalog }
      invoke = body
      return { ...body, status: 'pending', approvalStatus: 'pending', expiresAt: Date.now() + 60_000 }
    })
    let resolvePoll!: (value: unknown) => void
    let resolveRecovery!: (value: unknown) => void
    let rejectRecovery!: (reason: Error) => void
    api.getAgentCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve
        })
    )
    api.getAgentCommand.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          resolveRecovery = resolve
          rejectRecovery = reject
        })
    )
    editor.value.textContent = '/'
    await commands.input()
    commands.select(commands.capabilities.value[0])
    await commands.send()
    vi.advanceTimersByTime(2_000)
    expect(api.getAgentCommand).toHaveBeenCalledTimes(1)
    useMitt.emit(WsResponseMessageType.COMMAND_APPROVAL_RESULT, {
      ...invoke,
      callerUid: '11',
      approvalStatus: 'approved'
    })
    expect(commands.approvalLocked.value).toBe(false)
    const recovering = commands.reconcile()
    expect(api.getAgentCommand).toHaveBeenCalledTimes(2)
    const completed = {
      ...invoke,
      status: 'completed',
      phase: 'outcome',
      approvalStatus: 'approved',
      receiptRevision: 1
    }
    if (late === 'recovery-error') {
      resolvePoll(completed)
      await vi.advanceTimersByTimeAsync(0)
      expect(commands.status.value).toBe('completed')
      rejectRecovery(new Error('lost recovery response'))
      await recovering
    } else {
      resolveRecovery(completed)
      await recovering
      resolvePoll({
        ...invoke,
        status: late === 'pending' ? 'pending' : 'accepted',
        phase: late === 'pending' ? 'approval' : 'dispatch',
        approvalStatus: late === 'pending' ? 'pending' : 'approved',
        expiresAt: Date.now() + 60_000
      })
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(commands.status.value).toBe('completed')
    expect(commands.receipt.value).toMatchObject(completed)
    expect(commands.approvalLocked.value).toBe(false)
    expect(api.getAgentCommand).toHaveBeenCalledTimes(2)
    expect(api.postAgentCommand.mock.calls.filter(([body]) => body.operation === 'invoke')).toHaveLength(1)
  }
)
