import { afterEach, expect, it, vi } from 'vitest'
import { ImUrlEnum } from '@/enums'
import { webImRequest } from '@/utils/webImRequest'

vi.mock('@/stores/user', () => ({ useUserStore: () => ({ userInfo: {} }) }))
vi.mock('@/hooks/useMitt', () => ({ useMitt: { emit: vi.fn() } }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('maps command POST and expands result UUID in the real Web adapter', async () => {
  vi.stubEnv('VITE_WEB_API_URL', 'https://example.test/api')
  const requestId = '12345678-1234-4234-8234-123456789abc'
  const body = { requestId, roomId: 'r1', aiclawUid: 'agent', operation: 'discover' }
  const result = { ...body, status: 'accepted' }
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 200, data: result }) })
  vi.stubGlobal('fetch', fetchMock)

  expect(await webImRequest(ImUrlEnum.AICLAW_COMMANDS, body)).toEqual(result)
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    'https://example.test/api/im/aiclaw/commands',
    expect.objectContaining({ method: 'POST', body: JSON.stringify(body) })
  )
  expect(await webImRequest(ImUrlEnum.AICLAW_COMMAND_RESULT, undefined, { requestId })).toEqual(result)
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    `https://example.test/api/im/aiclaw/commands/${requestId}`,
    expect.objectContaining({ method: 'GET' })
  )
  expect(fetchMock.mock.calls[1][1]).not.toHaveProperty('body')
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
