import { reactive } from 'vue'
import type { AgentCommandRequest, AgentCommandResult } from '@/services/agentCommands'
import { canWriteScopedSnapshot, sameSession, sessionBinding, type SessionIdentity } from '@/services/sessionBinding'
import { homeWindowOnlyStorage } from '@/stores/persistHomeWindowOnly'

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

const lockKey = (userId: string, roomId: string) => {
  const binding = sessionBinding.value
  return JSON.stringify([binding?.backendKey, binding?.uid, binding?.sessionEpoch, userId, roomId])
}

/** One latest submitted invocation per identity/room, not an execution queue. No payload or grant is stored. */
export type CommandRecovery = {
  binding: SessionIdentity
  group: boolean
  observed: boolean
  receipt: Pick<
    AgentCommandResult,
    | 'requestId'
    | 'roomId'
    | 'aiclawUid'
    | 'operation'
    | 'status'
    | 'approvalStatus'
    | 'expiresAt'
    | 'phase'
    | 'generation'
    | 'nativeRef'
    | 'receiptRevision'
  >
}
const recoveryKey = (binding: SessionIdentity, roomId: string) =>
  `agent-command-recovery:${JSON.stringify([binding.backendKey, binding.uid, binding.sessionEpoch, roomId])}`

/** Public Long timestamps can be decimal strings; keep the original absolute deadline, never renew it. */
export function normalizeCommandReceipt(result: AgentCommandResult): AgentCommandResult | undefined {
  const raw: unknown = result.expiresAt
  if (raw === undefined) return result
  const expiresAt = typeof raw === 'number' ? raw : typeof raw === 'string' && /^[0-9]+$/.test(raw) ? Number(raw) : NaN
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) return
  return { ...result, expiresAt }
}

function recoveryReceipt(raw: AgentCommandResult): CommandRecovery['receipt'] | undefined {
  const result = normalizeCommandReceipt(raw)
  if (!result) return
  const nativeRef: AgentCommandResult['nativeRef'] =
    typeof result.nativeRef?.sessionId === 'string' ? { sessionId: result.nativeRef.sessionId } : undefined
  for (const key of ['inputId', 'messageId', 'parentId', 'turnId'] as const) {
    if (nativeRef && typeof result.nativeRef?.[key] === 'string') nativeRef[key] = result.nativeRef[key]
  }
  return {
    requestId: result.requestId,
    roomId: result.roomId,
    aiclawUid: result.aiclawUid,
    operation: result.operation,
    status: result.status,
    approvalStatus: result.approvalStatus,
    expiresAt: result.expiresAt,
    phase: result.phase,
    generation: result.generation,
    nativeRef,
    receiptRevision: result.receiptRevision
  }
}

export function saveCommandRecovery(
  binding: SessionIdentity | null,
  userId: string,
  group: boolean,
  body: AgentCommandRequest,
  result?: AgentCommandResult
) {
  if (
    !binding ||
    binding.uid !== userId ||
    !sameSession(binding, sessionBinding.value) ||
    !canWriteScopedSnapshot() ||
    body.operation !== 'invoke'
  )
    return
  const receipt = recoveryReceipt(result ?? { ...body, status: 'unknown' })
  if (!receipt) return
  try {
    homeWindowOnlyStorage().setItem(
      recoveryKey(binding, body.roomId),
      JSON.stringify({ binding, group, observed: !!result, receipt })
    )
  } catch {
    // Storage can be disabled/full; mounted GET recovery and server execution remain independent.
  }
}

export function commandRecovery(userId: string, roomId: string): CommandRecovery | undefined {
  const binding = sessionBinding.value
  if (!binding || binding.uid !== userId || !roomId) return
  try {
    const saved: Partial<CommandRecovery> | null = JSON.parse(
      homeWindowOnlyStorage().getItem(recoveryKey(binding, roomId)) ?? 'null'
    )
    const result = saved?.receipt
    if (
      !saved?.binding ||
      !sameSession(saved.binding, binding) ||
      typeof saved.group !== 'boolean' ||
      typeof saved.observed !== 'boolean' ||
      !result ||
      typeof result.requestId !== 'string' ||
      !result.requestId ||
      result.roomId !== roomId ||
      typeof result.aiclawUid !== 'string' ||
      !result.aiclawUid ||
      result.operation !== 'invoke' ||
      !['pending', 'accepted', 'completed', 'failed', 'noop', 'unsupported', 'unknown', 'offline'].includes(
        result.status
      ) ||
      (result.approvalStatus !== undefined &&
        !['pending', 'approved', 'rejected', 'expired', 'invalidated'].includes(result.approvalStatus)) ||
      (result.phase !== undefined && !['dispatch', 'accepted', 'outcome', 'approval'].includes(result.phase)) ||
      (result.generation !== undefined && typeof result.generation !== 'string') ||
      (result.receiptRevision !== undefined && !Number.isSafeInteger(result.receiptRevision))
    )
      return
    const receipt = recoveryReceipt(result)
    if (!receipt) return
    return { binding, group: saved.group, observed: saved.observed, receipt }
  } catch {
    return undefined
  }
}

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

/** 服务端原始绝对期限；恢复不续期。仅解锁输入，不推断请求未执行或停止已批准的工作。 */
export function lockCommandApproval(userId: string, roomId: string, requestId: string, expiresAt: number) {
  if (!userId || !roomId || !requestId) return
  const key = lockKey(userId, roomId)
  const existing = locks.get(key)
  if (existing?.requestId === requestId) return
  const previous = timers.get(key)
  if (previous) clearTimeout(previous)
  locks.set(key, { requestId, userId, roomId, expiresAt })
  timers.set(
    key,
    setTimeout(() => release(key, requestId), Math.max(0, expiresAt - Date.now()))
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
