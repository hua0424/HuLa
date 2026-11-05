import { beforeEach, expect, it, vi } from 'vitest'
const request = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({ imRequest: request }))
import { postAgentCommand, getAgentCommand, type AgentCommandRequest } from '../agentCommands'

beforeEach(() => {
  request.mockReset()
})
it('posts a correlated command once through the authenticated platform wrapper', async () => {
  const body = {
    requestId: '9f56fcba-2f91-48bb-a21f-95c898ff983b',
    roomId: 'r',
    aiclawUid: 'a',
    operation: 'invoke' as const,
    capabilityId: 'model.list',
    parameters: {},
    catalogVersion: 'v1'
  }
  request.mockResolvedValue({ ...body, status: 'accepted' })
  await postAgentCommand(body)
  expect(request).toHaveBeenCalledExactlyOnceWith({ url: 'aiclawCommands', body }, { showError: false })
})
it.each<Pick<AgentCommandRequest, 'operation' | 'capabilityId' | 'parameters'>>([
  { operation: 'discover', capabilityId: 'model.set', parameters: { query: 'native', offset: 100 } },
  {
    operation: 'invoke',
    capabilityId: 'skill:fixture',
    parameters: { arguments: '  literal\nhttps://example.test/<x>' }
  },
  { operation: 'invoke', capabilityId: 'model.set', parameters: { providerId: 'p/a', modelId: 'm/b' } }
])('preserves native parameters and receipt evidence for $operation $capabilityId', async (operation) => {
  const body: AgentCommandRequest = { requestId: 'id', roomId: 'r', aiclawUid: 'a', catalogVersion: 'v1', ...operation }
  const receipt = {
    ...body,
    status: 'accepted',
    phase: 'accepted',
    receiptRevision: 2,
    generation: '7',
    nativeRef: { sessionId: 's', inputId: 'i', parentId: 'p' }
  }
  request.mockResolvedValue(receipt)
  expect(await postAgentCommand(body)).toEqual(receipt)
  expect(request).toHaveBeenCalledExactlyOnceWith({ url: 'aiclawCommands', body }, { showError: false })
})

it('queries the original request ID without resending POST', async () => {
  await getAgentCommand('9f56fcba-2f91-48bb-a21f-95c898ff983b')
  expect(request).toHaveBeenCalledExactlyOnceWith(
    { url: 'aiclawCommandResult', params: { requestId: '9f56fcba-2f91-48bb-a21f-95c898ff983b' } },
    { showError: false }
  )
})
it('propagates transport uncertainty without retrying', async () => {
  request.mockRejectedValue(new Error('timeout'))
  await expect(
    postAgentCommand({ requestId: 'id', roomId: 'r', aiclawUid: 'a', operation: 'discover' })
  ).rejects.toThrow('timeout')
  expect(request).toHaveBeenCalledTimes(1)
})
