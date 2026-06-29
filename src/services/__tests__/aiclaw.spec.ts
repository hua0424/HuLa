import { describe, expect, it, vi } from 'vitest'
import { fetchAiclawCcLaunchCommand } from '@/services/aiclaw'
import { ImUrlEnum } from '@/enums'
import { imRequest } from '@/utils/ImRequestUtils'

vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: vi.fn()
}))

describe('#100 fetchAiclawCcLaunchCommand', () => {
  it('携带 roomId 与 uid 请求 /im/room/aiclaw/cc-launch', async () => {
    vi.mocked(imRequest).mockResolvedValue({
      launchCommand: 'claude --dir /w --room 1',
      workspaceDir: '/w'
    })

    const result = await fetchAiclawCcLaunchCommand('room-1', '1001')

    expect(imRequest).toHaveBeenCalledTimes(1)
    expect(imRequest).toHaveBeenCalledWith({
      url: ImUrlEnum.AICLAW_CC_LAUNCH,
      params: { roomId: 'room-1', uid: '1001' }
    })
    expect(result.launchCommand).toBe('claude --dir /w --room 1')
    expect(result.workspaceDir).toBe('/w')
  })

  it('单 CC 场景省略 uid 参数', async () => {
    vi.mocked(imRequest).mockResolvedValue({
      launchCommand: 'claude --room 2',
      workspaceDir: '/w2'
    })

    await fetchAiclawCcLaunchCommand('room-2')

    expect(imRequest).toHaveBeenCalledWith({
      url: ImUrlEnum.AICLAW_CC_LAUNCH,
      params: { roomId: 'room-2' }
    })
  })
})
