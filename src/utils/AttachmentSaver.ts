import { save } from '@tauri-apps/plugin-dialog'
import type { useDownload } from '@/hooks/useDownload'
import { extractFileName } from './Formatting'

const VIDEO_FILE_EXTENSIONS = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm'] as const

type DownloadFileFn = ReturnType<typeof useDownload>['downloadFile']

type SaveAttachmentOptions = {
  url?: string
  objectKey?: string
  downloadFile: DownloadFileFn
  defaultFileName?: string
  /** 消息 ID（可选），用于换取签名下载 URL */
  msgId?: string
  filters?: Array<{ name: string; extensions: string[] }>
  successMessage?: string
  errorMessage?: string
}

const normalizeSavePath = (path: string) => path.replace(/\\/g, '/')

const saveAttachmentAs = async ({
  url,
  objectKey,
  downloadFile,
  defaultFileName,
  msgId,
  filters,
  successMessage,
  errorMessage
}: SaveAttachmentOptions) => {
  const workUrl = url || objectKey
  if (!workUrl) {
    window.$message.error('未找到下载链接')
    return
  }

  const filename = defaultFileName || extractFileName(workUrl)

  try {
    const savePath = await save({
      defaultPath: filename,
      filters
    })

    if (!savePath) return

    const normalizedPath = normalizeSavePath(savePath)
    await downloadFile(workUrl, normalizedPath, undefined, msgId, objectKey)

    if (successMessage) {
      window.$message.success(successMessage)
    }
  } catch (error) {
    console.error(errorMessage || '保存文件失败:', error)
    if (errorMessage) {
      window.$message.error(errorMessage)
    }
  }
}

export const saveVideoAttachmentAs = async (options: SaveAttachmentOptions) => {
  await saveAttachmentAs({
    filters: options.filters || [
      {
        name: 'Video',
        extensions: [...VIDEO_FILE_EXTENSIONS]
      }
    ],
    successMessage: options.successMessage || '视频保存成功',
    errorMessage: options.errorMessage || '保存视频失败',
    ...options
  })
}

export const saveFileAttachmentAs = async (options: SaveAttachmentOptions) => {
  await saveAttachmentAs({
    successMessage: options.successMessage || '文件下载成功',
    errorMessage: options.errorMessage || '保存文件失败',
    ...options
  })
}
