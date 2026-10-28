/**
 * aichatoverview#484 (T3)：群成员/权限「当前事实」的窄读结果。
 *
 * 服务端 `GET /im/room/group/use-state` 绕开 RoomCache / RoomGroupCache / GroupMemberCache，
 * 用一次一致读返回本次请求范围内的事实。要点：
 *
 * - `outcome=NOT_ACCESSIBLE` 与「群不存在 / 已删除 / 调用者不在群」同形，调用者不得据此推断
 *   具体原因，只能精准退场该房间（不删本地合法聊天历史）。
 * - `requestedMembers` 只覆盖本次请求的 UID；缺失 = unknown，不是「不存在」。
 * - `exists` 只来自成员事实表；`name`/`account` 缺失（摘要未同步）不改写 `exists`。
 * - 本快照只证明这一次读取，不是执行授权凭据；业务操作仍由 server 各自准入。
 *
 * 格式不符一律返回 null（本次结果不可信，保留上次可用值并标记未校准），
 * 不能把畸形载荷折成空集合或「不在群」。
 */

export type GroupUseOutcome = 'MEMBER' | 'NOT_ACCESSIBLE'

export interface GroupUseMemberProjection {
  uid: string
  exists: boolean
  roleId?: number
  name?: string
  account?: string
}

export interface GroupUseCoverage {
  requested: number
  covered: number
  limit: number
  truncated: boolean
}

export interface GroupUseState {
  outcome: GroupUseOutcome
  roomId: string
  selfUid?: string
  selfRoleId?: number
  memberCount?: number
  groupName?: string
  account?: string
  remark?: string
  myName?: string
  allowScanEnter?: boolean
  requestedMembers: GroupUseMemberProjection[]
  coverage?: GroupUseCoverage
}

/** 单次请求 UID 硬上限，与 server `GroupUseStateReq.MAX_MEMBER_UIDS` 对齐。 */
export const GROUP_USE_MAX_MEMBER_UIDS = 100

const asDecimal = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value))
  if (typeof value === 'string' && /^\d+$/.test(value)) return value
  return undefined
}

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

const asBoolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined)

const parseProjection = (raw: unknown): GroupUseMemberProjection | null => {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const uid = asDecimal(row.uid)
  if (!uid || typeof row.exists !== 'boolean') return null
  return {
    uid,
    exists: row.exists,
    roleId: asNumber(row.roleId),
    name: asString(row.name),
    account: asString(row.account)
  }
}

export const parseGroupUseState = (raw: unknown): GroupUseState | null => {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const outcome = row.outcome
  if (outcome !== 'MEMBER' && outcome !== 'NOT_ACCESSIBLE') return null
  const roomId = asDecimal(row.roomId)
  if (!roomId) return null

  const requestedMembers: GroupUseMemberProjection[] = []
  if (row.requestedMembers != null) {
    if (!Array.isArray(row.requestedMembers)) return null
    for (const item of row.requestedMembers) {
      const projection = parseProjection(item)
      if (!projection) return null
      requestedMembers.push(projection)
    }
  }

  let coverage: GroupUseCoverage | undefined
  if (row.coverage != null) {
    if (typeof row.coverage !== 'object') return null
    const c = row.coverage as Record<string, unknown>
    coverage = {
      requested: asNumber(c.requested) ?? requestedMembers.length,
      covered: asNumber(c.covered) ?? requestedMembers.length,
      limit: asNumber(c.limit) ?? GROUP_USE_MAX_MEMBER_UIDS,
      truncated: c.truncated === true
    }
  }

  if (outcome === 'NOT_ACCESSIBLE') {
    return { outcome, roomId, requestedMembers, coverage }
  }

  return {
    outcome,
    roomId,
    selfUid: asDecimal(row.selfUid),
    selfRoleId: asNumber(row.selfRoleId),
    memberCount: asNumber(row.memberCount),
    groupName: asString(row.groupName),
    account: asString(row.account),
    remark: asString(row.remark),
    myName: asString(row.myName),
    allowScanEnter: asBoolean(row.allowScanEnter),
    requestedMembers,
    coverage
  }
}

/** 把请求 UID 去重并按硬上限截断；截断与否由调用方在 coverage.truncated 体现。 */
export const normalizeRequestedUids = (uids: Array<string | number | undefined | null>): string[] => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const uid of uids) {
    const value = asDecimal(uid)
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}
