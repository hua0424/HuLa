import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentCommandRequest } from '@/services/agentCommands'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows', version: () => '10.0.22631' }))
// These stores are only used by the request wrapper's unrelated notification-sync path.
vi.mock('@/stores/chat', () => ({ useChatStore: vi.fn() }))
vi.mock('@/stores/group', () => ({ useGroupStore: vi.fn() }))

const original = { backendKey: 'test-a', uid: '11', sessionEpoch: 7 }
const replacement = { backendKey: 'test-b', uid: '12', sessionEpoch: 8 }

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('__TAURI_INTERNALS__', {})
  invoke.mockReset()
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

it.each(['invoke', 'reconcile', 'unbound discovery'] as const)(
  'never dispatches an old %s under a newly installed native identity',
  async (action) => {
    let installed = original
    let submitted: AgentCommandRequest | undefined
    invoke.mockImplementation(async (command, args) => {
      if (command === 'get_session_binding') return { sessionEpoch: installed.sessionEpoch, binding: installed }
      if (command !== 'im_request_command') throw new Error(`Unexpected IPC ${command}`)
      if (args.url === 'aiclawCommandResult') return { ...submitted, status: 'unknown' }
      const body: AgentCommandRequest = args.body
      if (body.operation === 'discover')
        return {
          ...body,
          status: 'completed',
          catalog: {
            version: 'test-menu',
            capabilities: [
              { id: 'session.compact', kind: 'command', defaultVisibility: 'public', supported: true, executable: true }
            ]
          }
        }
      submitted = body
      return { ...body, status: 'unknown' }
    })

    const { captureSessionBinding, sessionBinding } = await import('@/services/sessionBinding')
    const { useAgentCommands } = await import('../useAgentCommands')
    await captureSessionBinding()
    const owner = effectScope()
    try {
      const editor = ref(document.createElement('div'))
      editor.value.textContent = '/'
      const commands = owner.run(() =>
        useAgentCommands(
          editor,
          () => ({ roomId: 'room-a', aiclawUid: 'agent-a', group: false }),
          () => true,
          () => original.uid
        )
      )!
      if (action === 'unbound discovery') {
        sessionBinding.value = null
        invoke.mockClear()
        await commands.input()
        expect(invoke).not.toHaveBeenCalled()
        return
      }
      await commands.input()
      expect(commands.capabilities.value).toHaveLength(1)
      expect(invoke).toHaveBeenCalledWith(
        'im_request_command',
        expect.objectContaining({ binding: original }),
        undefined
      )
      commands.select(commands.capabilities.value[0])
      if (action === 'reconcile') {
        await commands.send()
        expect(submitted?.requestId).toBe(commands.requestId.value)
      }
      invoke.mockClear()
      // Rust installs the new identity before its session-change event reaches this composer.
      installed = replacement
      expect(sessionBinding.value).toEqual(original)
      if (action === 'invoke') await commands.send()
      else await commands.reconcile()
      expect(invoke.mock.calls.some(([command]) => command === 'get_session_binding')).toBe(true)
      expect(invoke.mock.calls.filter(([command]) => command === 'im_request_command')).toHaveLength(0)
    } finally {
      owner.stop()
    }
  }
)
