import { effectScope, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ postAgentCommand: vi.fn(), getAgentCommand: vi.fn() }))
vi.mock('@/services/agentCommands', () => api)
import { useAgentCommands } from '../useAgentCommands'

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
const catalog = { version: 'v1', framework: 'opencode', runtimeVersion: '1', capabilities: [model] }
const scopes: ReturnType<typeof effectScope>[] = []
function setup(group = false) {
  const editor = ref(document.createElement('div'))
  const session = ref({ roomId: 'r1', aiclawUid: group ? '' : 'agent', group })
  const scope = effectScope()
  scopes.push(scope)
  const commands = scope.run(() =>
    useAgentCommands(
      editor,
      () => session.value,
      (uid) => uid === 'agent'
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
  vi.clearAllMocks()
  vi.useRealTimers()
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
