import { invoke as rawInvoke, type InvokeArgs, type InvokeOptions } from '@tauri-apps/api/core'
import { listen, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event'
import { shallowRef } from 'vue'

export type SessionIdentity = Readonly<{ backendKey: string; uid: string; sessionEpoch: number }>
type SessionChange = { sessionEpoch: number; binding: SessionIdentity | null }
type BoundEvent<T> = { binding: SessionIdentity; payload: T }

export class SessionExpiredError extends Error {
  constructor() {
    super('账号或后端代次已失效')
    this.name = 'SessionExpiredError'
  }
}

export const sessionBinding = shallowRef<SessionIdentity | null>(null)
let observedEpoch = 0
let changingScope = false
export const canWriteScopedSnapshot = () => !changingScope
let listener: Promise<UnlistenFn> | undefined
const bootKey = 'aichat-native-session-binding'

export const readBootBinding = (): SessionIdentity | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem(bootKey) ?? 'null')
    return parsed?.backendKey && parsed?.uid && Number.isSafeInteger(parsed.sessionEpoch) ? parsed : null
  } catch {
    return null
  }
}

export const sameSession = (left: SessionIdentity | null, right: SessionIdentity | null) =>
  left === right ||
  (!!left &&
    !!right &&
    left.sessionEpoch === right.sessionEpoch &&
    left.uid === right.uid &&
    left.backendKey === right.backendKey)

export const isSessionCurrent = (binding: SessionIdentity | null) => sameSession(sessionBinding.value, binding)

const acceptChange = (change: SessionChange) => {
  if (
    change.sessionEpoch < observedEpoch ||
    (change.sessionEpoch === observedEpoch && !change.binding && sessionBinding.value)
  )
    return
  observedEpoch = change.sessionEpoch
  changingScope = true
  try {
    if (typeof localStorage !== 'undefined') {
      if (change.binding) localStorage.setItem(bootKey, JSON.stringify(change.binding))
      else localStorage.removeItem(bootKey)
    }
    if (!sameSession(sessionBinding.value, change.binding)) sessionBinding.value = change.binding
  } finally {
    changingScope = false
  }
}

export const ensureSessionListener = () => {
  if (!listener && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    listener = listen<SessionChange>('session-binding-changed', ({ payload }) => acceptChange(payload))
    // Keep the error observable by captureSessionBinding; do not silently continue with stale identity.
  }
  return listener
}

export const initializeSessionBinding = async () => {
  await ensureSessionListener()
  const change = await rawInvoke<SessionChange>('get_session_binding')
  if (
    !Number.isSafeInteger(change?.sessionEpoch) ||
    change.sessionEpoch < 0 ||
    (change.binding &&
      (!change.binding.backendKey || !change.binding.uid || change.binding.sessionEpoch !== change.sessionEpoch))
  )
    throw new Error('账号绑定响应无效')
  acceptChange(change)
  return change.binding
}

export const captureSessionBinding = async (): Promise<SessionIdentity> => {
  const binding = await initializeSessionBinding()
  if (!binding) throw new SessionExpiredError()
  if (!isSessionCurrent(binding)) throw new SessionExpiredError()
  return Object.freeze({ ...binding })
}

export const assertSessionCurrent = async (binding: SessionIdentity) => {
  const current = await captureSessionBinding()
  if (!sameSession(current, binding)) throw new SessionExpiredError()
}

const scopedCommands = new Set([
  'page_msg',
  'send_msg',
  'save_msg',
  'sync_messages',
  'update_message_recall_status',
  'delete_message',
  'delete_room_messages',
  'save_message_mark',
  'list_contacts_command',
  'hide_contact_command',
  'update_my_room_info',
  'get_room_members',
  'cursor_page_room_members',
  'page_room',
  'save_user_info',
  'update_user_last_opt_time',
  'get_user_tokens',
  'remove_tokens',
  'switch_user_database',
  'query_chat_history',
  'query_files',
  'debug_message_stats',
  'read_thinking_cache',
  'cache_thinking_metadata',
  'cache_thinking_body',
  'read_local_snapshot',
  'cache_local_snapshot',
  'ws_init_connection',
  'ws_disconnect',
  'ws_send_message',
  'ws_force_reconnect'
])
const publicRoutes = new Set([
  'login',
  'register',
  'forgetPassword',
  'sendCaptcha',
  'getCaptcha',
  'checkEmail',
  'generateQRCode',
  'checkQRStatus',
  'initConfig'
])

export const prepareScopedArgs = async (command: string, args?: InvokeArgs): Promise<InvokeArgs | undefined> => {
  const record = args as Record<string, any> | undefined
  const protectedCommand =
    scopedCommands.has(command) || (command === 'im_request_command' && !publicRoutes.has(record?.url))
  if (!protectedCommand) return args
  const supplied: SessionIdentity | undefined = record?.binding ?? record?.data?._sessionBinding
  const binding = supplied ?? (await captureSessionBinding())
  if (supplied) await assertSessionCurrent(supplied)
  if (!isSessionCurrent(binding)) throw new SessionExpiredError()
  return { ...record, binding }
}

export const eventSession = (payload: unknown): SessionIdentity | undefined =>
  payload && typeof payload === 'object'
    ? (payload as { _sessionBinding?: SessionIdentity })._sessionBinding
    : undefined

/** Capture before IPC/HTTP, never pick a new identity for a retry or a delayed WS commit. */
export const invokeScoped = async <T>(command: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> => {
  const authenticating = command === 'login_command' || command === 'update_token'
  if (authenticating) {
    await ensureSessionListener()
    acceptChange({ sessionEpoch: observedEpoch, binding: null })
  }
  const prepared = await prepareScopedArgs(command, args)
  const binding = (prepared as { binding?: SessionIdentity } | undefined)?.binding
  let result: T
  try {
    result = await rawInvoke<T>(command, prepared, options)
  } catch (error) {
    if (binding) await assertSessionCurrent(binding)
    throw error
  }
  if (authenticating) await captureSessionBinding()
  if (!binding) return result
  // Logout deliberately invalidates the supplied binding; no read response can use this exception.
  if (command !== 'remove_tokens' && command !== 'ws_disconnect') await assertSessionCurrent(binding)
  return result
}

/** All WS subscribers share one origin check; payloads retain origin for later asynchronous work. */
export const listenBound = <T>(event: string, callback: EventCallback<T>): Promise<UnlistenFn> =>
  listen<BoundEvent<T>>(event, async (received) => {
    const envelope = received.payload
    if (!envelope?.binding) return
    try {
      await assertSessionCurrent(envelope.binding)
      const payload = envelope.payload
      if (payload && typeof payload === 'object') {
        Object.assign(payload, { _sessionBinding: envelope.binding })
        const marks = (payload as { markList?: unknown[] }).markList
        for (const mark of marks ?? [])
          if (mark && typeof mark === 'object') Object.assign(mark, { _sessionBinding: envelope.binding })
      }
      await callback({ ...received, payload })
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) console.warn('[session] WS origin check failed')
    }
  })
