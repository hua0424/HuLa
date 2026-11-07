import { reactive } from 'vue'

/**
 * aichatoverview#505：按真实用户 + 房间保存“等待主人审批”的输入框锁。
 *
 * 服务端才是审批状态的权威；这里只负责让当前发起人的当前房间立即表现为等待，
 * 并在审批终态（批准/拒绝/过期/失效）后立即解锁。锁不按全局或仅按房间保存，
 * 因此换账号、切房间或收到旧 WS 事件都不会锁住别处。
 */
export type CommandApprovalLock = {
  requestId: string
  userId: string
  roomId: string
  expiresAt: number
}

const locks = reactive(new Map<string, CommandApprovalLock>())
const timers = new Map<string, ReturnType<typeof setTimeout>>()

const lockKey = (userId: string, roomId: string) => `${userId}:${roomId}`

function release(key: string, requestId?: string) {
  const existing = locks.get(key)
  if (!existing || (requestId && existing.requestId !== requestId)) return
  locks.delete(key)
  const timer = timers.get(key)
  if (timer) clearTimeout(timer)
  timers.delete(key)
}

/** 当前用户在当前房间的待审批锁；到点即失效，避免依赖客户端时钟以外的推断。 */
export function commandApprovalLock(userId: string, roomId: string): CommandApprovalLock | undefined {
  const key = lockKey(userId, roomId)
  const lock = locks.get(key)
  if (!lock) return undefined
  if (lock.expiresAt <= Date.now()) {
    release(key, lock.requestId)
    return undefined
  }
  return lock
}

/**
 * 60s 审批 window 从服务端受理起算。锁按服务端给出的 expiresAt 到期，
 * 重复收到同一 pending 的 GET/WS 只刷新剩余时间，不能延长审批期限。
 */
export function lockCommandApproval(userId: string, roomId: string, requestId: string, expiresAt: number) {
  if (!userId || !roomId || !requestId) return
  const key = lockKey(userId, roomId)
  const previous = timers.get(key)
  if (previous) clearTimeout(previous)
  const delay = expiresAt - Date.now()
  if (delay <= 0) {
    release(key, requestId)
    return
  }
  locks.set(key, { requestId, userId, roomId, expiresAt })
  timers.set(
    key,
    setTimeout(() => release(key, requestId), delay)
  )
}

export function unlockCommandApproval(userId: string, roomId: string, requestId?: string) {
  release(lockKey(userId, roomId), requestId)
}

/** 单测隔离用；生产不调用。 */
export function clearCommandApprovalLocks() {
  for (const key of [...locks.keys()]) release(key)
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
}
