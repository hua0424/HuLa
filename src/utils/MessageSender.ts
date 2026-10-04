import { Channel } from '@tauri-apps/api/core'
import { watch } from 'vue'
import { ImUrlEnum, MsgEnum, TauriCommand } from '@/enums'
import { isWeb } from '@/utils/PlatformConstants'
import { imRequest } from '@/utils/ImRequestUtils'
import {
  captureSessionBinding,
  invokeScoped,
  isSessionCurrent,
  sessionBinding,
  SessionExpiredError,
  type SessionIdentity
} from '@/services/sessionBinding'

export type SendMessagePayload = {
  id: string
  clientMsgId?: string
  roomId: string
  msgType: MsgEnum
  body: unknown
}
export type SendMessageOptions = {
  data: SendMessagePayload
  binding?: SessionIdentity
  onSuccess?: (payload: any) => void
  onError?: (msgId?: string) => void
}

const sendMessageViaHttp = async ({ data, onSuccess, onError }: SendMessageOptions) => {
  try {
    const result = await imRequest<any>({ url: ImUrlEnum.SEND_MSG, body: data })
    onSuccess?.(result)
  } catch (error) {
    console.error('[MessageSender] HTTP 发送失败:', error)
    onError?.(data.id)
  }
}

const sendMessageViaTauri = async ({ data, binding: captured, onSuccess, onError }: SendMessageOptions) => {
  const binding = captured ?? (await captureSessionBinding())
  if (!isSessionCurrent(binding)) throw new SessionExpiredError()
  const successChannel = new Channel<any>()
  const errorChannel = new Channel<{ msgId?: string; error?: string }>()
  const noop = () => {}
  let stop = noop
  const receipt = new Promise<void>((resolve, reject) => {
    stop = watch(
      sessionBinding,
      () => {
        if (!isSessionCurrent(binding)) reject(new SessionExpiredError())
      },
      { flush: 'sync' }
    )
    successChannel.onmessage = (payload) => {
      if (!isSessionCurrent(binding)) {
        reject(new SessionExpiredError())
        return
      }
      onSuccess?.(payload)
      resolve()
    }
    errorChannel.onmessage = (payload) => {
      if (!isSessionCurrent(binding)) {
        reject(new SessionExpiredError())
        return
      }
      onError?.(payload?.msgId)
      reject(new Error(payload?.error ?? 'send_msg_failed'))
    }
  })
  try {
    // Consume both promises immediately, including cancellation before IPC returns.
    await Promise.all([invokeScoped(TauriCommand.SEND_MSG, { binding, data, successChannel, errorChannel }), receipt])
  } finally {
    stop()
    successChannel.onmessage = noop
    errorChannel.onmessage = noop
  }
}

export const sendMessageWithChannel = async (options: SendMessageOptions) => {
  if (isWeb()) await sendMessageViaHttp(options)
  else await sendMessageViaTauri(options)
}
