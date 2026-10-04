// aichatoverview#349：认证后分区就绪 + 独立发送的 boot 全链路记录。
// 同一个 bootAttempt 串起认证、库绑定、本地可读、sendReady/pending、锁排队与补齐阶段；
// 每个阶段带独立 requestId；服务端认证结果与锁/互斥限制分不同 phase 上报，便于对照排查。
let bootSeq = 0
let currentBootAttempt = ''

const isTauriContext = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** 新开一次 boot 尝试并记为当前（登录/home 初始化入口调用一次）。 */
export const createBootAttempt = (): string => {
  bootSeq += 1
  currentBootAttempt = `boot-${Date.now().toString(36)}-${bootSeq}`
  return currentBootAttempt
}

/** 当前 bootAttempt（发送路径等非 boot 入口引用；boot 前为空串）。 */
export const getCurrentBootAttempt = (): string => currentBootAttempt

/** 阶段级 requestId：`{bootAttempt}/{phase}-{ts36}`，同 boot 内按 phase 可分组。 */
export const createRequestId = (bootAttempt: string, phase: string): string =>
  `${bootAttempt}/${phase}-${Date.now().toString(36)}`

/** 单行结构化 boot 日志：Tauri 走 plugin-log，Web/单测走 console。 */
export const logBoot = (bootAttempt: string, requestId: string, phase: string, detail = ''): void => {
  const line = `[349boot] attempt=${bootAttempt} request=${requestId} phase=${phase}${detail ? ` ${detail}` : ''}`
  if (isTauriContext()) {
    import('@tauri-apps/plugin-log').then(({ info }) => void info(line)).catch(() => console.log(line))
  } else {
    console.log(line)
  }
}

/** 低优先级补齐调度：requestIdleCallback（3s 超时兜底），不支持则 setTimeout(0)。 */
export const scheduleIdle = (task: () => void | Promise<unknown>): void => {
  const run = () => {
    void task()
  }
  const ric = (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback
  if (typeof ric === 'function') {
    ;(ric as (cb: () => void, opts?: { timeout: number }) => void)(run, { timeout: 3000 })
  } else {
    setTimeout(run, 0)
  }
}
