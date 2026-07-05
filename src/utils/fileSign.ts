import { ImUrlEnum } from '@/enums'
import type { SignDownloadUrlResp } from '@/services/types'
import { imRequest } from '@/utils/ImRequestUtils'

/**
 * 快捷方法：为文件消息换取带签名的临时下载 URL（BL-003 sign-on-access）
 *
 * @param msgId 消息 ID，服务端反查 roomId + objectKey
 * @returns 签名后的临时 URL，失败时返回 null
 */
export async function signFileDownloadUrl(msgId: string): Promise<string | null> {
  try {
    const resp = await imRequest<SignDownloadUrlResp>({
      url: ImUrlEnum.FILE_SIGN_DOWNLOAD,
      body: { msgId }
    })
    return resp?.url || null
  } catch (error) {
    console.warn('[signFileDownloadUrl] 换取签名 URL 失败:', error)
    return null
  }
}

/**
 * 解析最终用于 fetch 的文件 URL。
 *
 * 有 msgId 且原 URL 为 http(s)，或提供了 objectKey 时，先调用 /im/file/sign-download 换取签名 URL；
 * 无 msgId、本地 URL 且无 objectKey、或签名失败时，原样返回原始 URL 作为兼容兜底。
 */
export async function resolveSignedFileUrl(url: string, msgId?: string, objectKey?: string): Promise<string> {
  if (!msgId) return url
  if (!url && !objectKey) return url
  if (url && !(url.startsWith('http://') || url.startsWith('https://')) && !objectKey) return url

  const signedUrl = await signFileDownloadUrl(msgId)
  return signedUrl || url
}
