import { Channel, invoke } from '@tauri-apps/api/core'
import { ImUrlEnum, MsgEnum, TauriCommand } from '@/enums'
import { isWeb } from '@/utils/PlatformConstants'
import { imRequest } from '@/utils/ImRequestUtils'

export type SendMessagePayload = {
  id: string
  roomId: string
  msgType: MsgEnum
  body: unknown
}

export type SendMessageOptions = {
  data: SendMessagePayload
  onSuccess?: (payload: any) => void
  onError?: (msgId: string) => void
}

/**
 * Web 模式下通过 HTTP API 发送消息
 */
const sendMessageViaHttp = async (options: SendMessageOptions) => {
  const { data, onSuccess, onError } = options
  try {
    const result = await imRequest<any>({
      url: ImUrlEnum.SEND_MSG,
      body: data
    })
    onSuccess?.(result)
  } catch (error) {
    console.error('[MessageSender] HTTP 发送失败:', error)
    onError?.(data.id)
  }
}

/**
 * Tauri 模式下通过 channel 调用发送消息
 */
const sendMessageViaTauri = async (options: SendMessageOptions) => {
  const { data, onSuccess, onError } = options
  const successChannel = new Channel<any>()
  const errorChannel = new Channel<string>()
  const noop = () => {}

  const sendPromise = new Promise<void>((resolve, reject) => {
    successChannel.onmessage = (payload) => {
      successChannel.onmessage = noop
      errorChannel.onmessage = noop
      onSuccess?.(payload)
      resolve()
    }
    errorChannel.onmessage = (msgId) => {
      successChannel.onmessage = noop
      errorChannel.onmessage = noop
      onError?.(msgId)
      reject(new Error(msgId || 'send_msg_failed'))
    }
  })

  await invoke(TauriCommand.SEND_MSG, {
    data,
    successChannel,
    errorChannel
  })

  await sendPromise
}

/**
 * 统一封装消息发送，自动选择 Tauri channel 或 HTTP API
 */
export const sendMessageWithChannel = async (options: SendMessageOptions) => {
  if (isWeb()) {
    await sendMessageViaHttp(options)
  } else {
    await sendMessageViaTauri(options)
  }
}
