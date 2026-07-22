import { beforeEach, describe, expect, it, vi } from 'vitest'

const imRequestSilentMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  imRequestSilent: (...args: unknown[]) => imRequestSilentMock(...args)
}))

import { ImUrlEnum } from '@/enums'
import { loadThinkingByTrigger } from '@/services/thinkingService'

describe('thinkingService.loadThinkingByTrigger (REQ-014)', () => {
  beforeEach(() => {
    imRequestSilentMock.mockReset()
  })

  it('空参数时不发起请求并返回空数组', async () => {
    expect(await loadThinkingByTrigger({ roomId: '', triggerMsgIds: [] })).toEqual([])
    expect(await loadThinkingByTrigger({ roomId: '1001', triggerMsgIds: [] })).toEqual([])
    expect(imRequestSilentMock).not.toHaveBeenCalled()
  })

  it('按契约调用 POST /im/aiclaw/thinking/by-trigger', async () => {
    imRequestSilentMock.mockResolvedValueOnce([
      {
        id: 1,
        aiclawUid: 2001,
        triggerMsgId: 'msg-1',
        status: 1,
        durationMs: 1200,
        createTime: '2026-07-20T10:00:00.000Z'
      }
    ])

    const result = await loadThinkingByTrigger({
      roomId: '1001',
      triggerMsgIds: ['msg-1', 'msg-2']
    })

    expect(imRequestSilentMock).toHaveBeenCalledTimes(1)
    expect(imRequestSilentMock).toHaveBeenCalledWith({
      url: ImUrlEnum.AICLAW_THINKING_BY_TRIGGER,
      body: {
        roomId: 1001,
        triggerMsgIds: ['msg-1', 'msg-2']
      }
    })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
  })

  it('请求失败时静默返回空数组', async () => {
    imRequestSilentMock.mockRejectedValueOnce(new Error('network'))

    const result = await loadThinkingByTrigger({
      roomId: '1001',
      triggerMsgIds: ['msg-1']
    })

    expect(result).toEqual([])
  })

  it('服务端返回 null 时返回空数组', async () => {
    imRequestSilentMock.mockResolvedValueOnce(null)

    const result = await loadThinkingByTrigger({
      roomId: '1001',
      triggerMsgIds: ['msg-1']
    })

    expect(result).toEqual([])
  })
})
