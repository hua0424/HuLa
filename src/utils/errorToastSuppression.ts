/**
 * #179 TC-03：按 roomId 的 IM 错误 toast 抑制注册表（模块级，无依赖，避免循环引用）。
 *
 * 场景：点开疑似幽灵会话时，选中动作会扇出多个带 roomId 的请求
 * （群成员 listMember、消息分页 getPageMsg、会话详情等），幽灵房间会让它们全部
 * 以业务错误失败并各自弹网络错误 toast。清理兜底（useMessage.handleMsgClick）
 * 在选中窗口内把该 roomId 注册进来，invokeWithErrorHandler 统一压制这些请求的
 * 错误弹窗；兜底确认后再由调用方给出「该群聊已解散」优雅提示或补回一次错误提示。
 *
 * 释放是 5s 延迟生效：点击后组件挂载（switchSession / 侧栏 / 消息区分页）的
 * 迟到请求仍落在抑制窗口内（首轮实现即时释放曾漏弹一次「房间号有误」）。
 */

const suppressedRoomIds = new Set<string>()
const releaseTimers = new Map<string, ReturnType<typeof setTimeout>>()

// ── 启动权威同步窗口（#179 Q2）─────────────────────────────────────────────
// 登录/启动后到首次 CONTACTS_SYNCED 落地前，本地联系人快照按定义是陈旧的，
// 任何 roomId 作用域的失败（成员/群详情等拉取）都无法区分"幽灵"与"瞬时"，
// 此窗口内统一压制 roomId 级错误 toast；窗口外一切照旧。
let bootSuppressionActive = false
let bootGraceTimer: ReturnType<typeof setTimeout> | null = null
let bootHardTimer: ReturnType<typeof setTimeout> | null = null

/** 首次同步落地后的在途请求宽限（ms）：同步落地瞬间在飞的拉取随后才失败，需要覆盖 */
export const BOOT_SUPPRESSION_GRACE_MS = 5000
/** 硬超时（ms，自开窗起算的绝对上限）：同步永不到达时窗口也必须确定性关闭 */
export const BOOT_SUPPRESSION_TIMEOUT_MS = 20000

/** 开窗（主窗口挂载 / 登录完成后调用；重复调用重置硬超时） */
export const armBootSuppression = () => {
  bootSuppressionActive = true
  if (bootGraceTimer) {
    clearTimeout(bootGraceTimer)
    bootGraceTimer = null
  }
  if (bootHardTimer) clearTimeout(bootHardTimer)
  bootHardTimer = setTimeout(() => {
    bootSuppressionActive = false
    bootHardTimer = null
  }, BOOT_SUPPRESSION_TIMEOUT_MS)
}

/**
 * 首次权威同步（CONTACTS_SYNCED）落地后调用：给在途请求宽限期后关窗。
 * 硬超时独立生效，保证窗口绝对寿命不超过 BOOT_SUPPRESSION_TIMEOUT_MS。
 */
export const releaseBootSuppressionAfterSync = (graceMs = BOOT_SUPPRESSION_GRACE_MS) => {
  if (!bootSuppressionActive) return
  if (bootGraceTimer) clearTimeout(bootGraceTimer)
  bootGraceTimer = setTimeout(() => {
    bootSuppressionActive = false
    bootGraceTimer = null
    if (bootHardTimer) {
      clearTimeout(bootHardTimer)
      bootHardTimer = null
    }
  }, graceMs)
}

export const isBootSuppressionActive = (): boolean => bootSuppressionActive

/** 开始抑制某 roomId 相关请求的错误 toast；重复调用会取消待生效的释放 */
export const suppressErrorToastsForRoom = (roomId: string | number) => {
  const key = String(roomId ?? '')
  if (!key) return
  suppressedRoomIds.add(key)
  const pending = releaseTimers.get(key)
  if (pending) {
    clearTimeout(pending)
    releaseTimers.delete(key)
  }
}

/** 延迟释放（默认 5s），覆盖点击后组件挂载的迟到请求 */
export const releaseErrorToastsForRoom = (roomId: string | number, delayMs = 5000) => {
  const key = String(roomId ?? '')
  if (!key) return
  const pending = releaseTimers.get(key)
  if (pending) clearTimeout(pending)
  releaseTimers.set(
    key,
    setTimeout(() => {
      suppressedRoomIds.delete(key)
      releaseTimers.delete(key)
    }, delayMs)
  )
}

/** 直接按 roomId 查询（供 store 决定底层请求是否带 showError） */
export const isRoomErrorToastSuppressed = (roomId: string | number): boolean => {
  return suppressedRoomIds.has(String(roomId ?? ''))
}

/** 从 invoke 参数中提取 roomId（覆盖 args / body / params 三种携带形态） */
const extractRoomId = (args?: Record<string, any>): string | undefined => {
  if (!args) return undefined
  const raw =
    args.roomId ??
    args.room_id ??
    args.body?.roomId ??
    args.body?.room_id ??
    args.params?.roomId ??
    args.params?.room_id
  return raw === undefined || raw === null ? undefined : String(raw)
}

/** invokeWithErrorHandler 用：该次调用的错误 toast 是否被抑制 */
export const isErrorToastSuppressed = (args?: Record<string, any>): boolean => {
  const roomId = extractRoomId(args)
  if (!roomId) return false
  // 启动权威同步窗口内：一切 roomId 级错误 toast 压制（窗口外仅压已注册 roomId）
  return bootSuppressionActive || suppressedRoomIds.has(roomId)
}
