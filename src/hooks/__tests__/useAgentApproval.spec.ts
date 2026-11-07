import { afterEach, expect, it, vi } from 'vitest'
import {
  clearCommandApprovalLocks,
  commandApprovalLock,
  lockCommandApproval,
  unlockCommandApproval
} from '../useAgentApproval'

afterEach(() => {
  clearCommandApprovalLocks()
  vi.useRealTimers()
})

it('locks only the real user/room that submitted the pending request', () => {
  const expiresAt = Date.now() + 60_000
  lockCommandApproval('11', 'room-a', 'request-1', expiresAt)
  expect(commandApprovalLock('11', 'room-a')).toMatchObject({ requestId: 'request-1', expiresAt })
  expect(commandApprovalLock('99', 'room-a')).toBeUndefined()
  expect(commandApprovalLock('11', 'room-b')).toBeUndefined()
})

it('unlocks only the matching request and releases on deadline', () => {
  vi.useFakeTimers()
  lockCommandApproval('11', 'room-a', 'request-1', Date.now() + 60_000)
  unlockCommandApproval('11', 'room-a', 'other')
  expect(commandApprovalLock('11', 'room-a')?.requestId).toBe('request-1')
  unlockCommandApproval('11', 'room-a', 'request-1')
  expect(commandApprovalLock('11', 'room-a')).toBeUndefined()

  lockCommandApproval('11', 'room-a', 'request-2', Date.now() + 60_000)
  vi.advanceTimersByTime(60_000)
  expect(commandApprovalLock('11', 'room-a')).toBeUndefined()
})
