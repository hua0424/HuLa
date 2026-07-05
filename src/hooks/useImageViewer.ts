import { convertFileSrc } from '@tauri-apps/api/core'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { MsgEnum } from '@/enums'
import { useWindow } from '@/hooks/useWindow'
import { useChatStore } from '@/stores/chat'
import { useFileDownloadStore } from '@/stores/fileDownload'
import { useImageViewer as useImageViewerStore } from '@/stores/imageViewer'
import type { FilesMeta } from '@/services/types'
import { extractFileName } from '@/utils/Formatting'
import { getFilesMeta } from '@/utils/PathUtil'
import { resolveSignedFileUrl } from '@/utils/fileSign'

type WorkerResponse = {
  success: boolean
  url: string
  buffer?: ArrayBuffer
  error?: string
}

type WorkerRequest = {
  resolve: (value: string | null) => void
  reject: (reason?: unknown) => void
  fileName: string
  msgId?: string
  objectKey?: string
}

const workerRequests = new Map<string, WorkerRequest>()
let imageDownloadWorker: Worker | null = null
const imageDownloaderWorkerUrl = new URL('../workers/imageDownloader.ts', import.meta.url)

const ensureWorker = () => {
  if (imageDownloadWorker || typeof window === 'undefined') return
  imageDownloadWorker = new Worker(imageDownloaderWorkerUrl, { type: 'module' })
  imageDownloadWorker.onmessage = async (event: MessageEvent<WorkerResponse>) => {
    const { success, url, buffer, error } = event.data
    const request = workerRequests.get(url)
    if (!request) {
      return
    }
    workerRequests.delete(url)

    if (!success || !buffer) {
      request.reject(new Error(error || '下载失败'))
      return
    }

    try {
      const fileDownloadStore = useFileDownloadStore()
      const absolutePath = await fileDownloadStore.saveFileFromBytes(
        url,
        request.fileName,
        new Uint8Array(buffer),
        request.objectKey,
        request.msgId
      )
      request.resolve(absolutePath)
    } catch (err) {
      request.reject(err)
    }
  }
}

const downloadImageWithWorker = async (url: string, fileName: string, msgId?: string, objectKey?: string) => {
  ensureWorker()
  if (!imageDownloadWorker) {
    return Promise.reject(new Error('Web Worker 不可用'))
  }

  const existing = workerRequests.get(url)
  if (existing) {
    return new Promise<string | null>((resolve, reject) => {
      const prevResolve = existing.resolve
      const prevReject = existing.reject
      existing.resolve = (value) => {
        prevResolve(value)
        resolve(value)
      }
      existing.reject = (reason) => {
        prevReject(reason)
        reject(reason)
      }
    })
  }

  // objectKey-only 消息把 objectKey 同时作为工作 key 和 objectKey 传给换签 helper
  const objectKeyForSign =
    objectKey || (url && !url.startsWith('http://') && !url.startsWith('https://') ? url : undefined)
  const fetchUrl = await resolveSignedFileUrl(url, msgId, objectKeyForSign)

  const promise = new Promise<string | null>((resolve, reject) => {
    workerRequests.set(url, { resolve, reject, fileName, msgId, objectKey })
    imageDownloadWorker!.postMessage({ url: fetchUrl, originalUrl: url })
  })

  return promise
}

const deduplicateList = (list: string[]) => {
  const uniqueList: string[] = []
  const seen = new Set<string>()
  list.forEach((url) => {
    if (url && !seen.has(url)) {
      seen.add(url)
      uniqueList.push(url)
    }
  })
  return uniqueList
}

const computeWorkKey = (msg: any): string => {
  const body = msg.message?.body || {}
  const msgId = msg.message?.id
  return body.url || body.objectKey || (msgId ? `msgId:${msgId}` : '')
}

const findMessageByWorkKey = (key: string, includeTypes: MsgEnum[]) => {
  const chatStore = useChatStore()
  const messages = Object.values(chatStore.currentMessageMap || {})
  return messages.find((msg: any) => {
    if (!includeTypes.includes(msg.message?.type)) return false
    return computeWorkKey(msg) === key
  })
}

const getBodyFileName = (body: any): string => {
  return body?.fileName || extractFileName(body?.url || body?.objectKey || '') || ''
}

/**
 * 图片查看器Hook，用于处理图片和表情包的查看功能
 */
export const useImageViewer = () => {
  const chatStore = useChatStore()
  const { createWebviewWindow } = useWindow()
  const imageViewerStore = useImageViewerStore()
  const fileDownloadStore = useFileDownloadStore()

  const ensureLocalFileExists = async (key: string, includeTypes: MsgEnum[]) => {
    if (!key) return null
    const msg = findMessageByWorkKey(key, includeTypes)
    const body = msg?.message?.body || {}
    const fileUrl = body.url || ''
    const objectKey = body.objectKey
    const msgId = msg?.message?.id

    const validatePath = async (absolutePath: string | undefined | null) => {
      if (!absolutePath) {
        return null
      }
      try {
        const [meta] = await getFilesMeta<FilesMeta>([absolutePath])
        if (meta?.exists) {
          return absolutePath
        }
        return null
      } catch (error) {
        console.error('检查本地图片失败:', error)
        return null
      }
    }

    const status = fileDownloadStore.getFileStatus(fileUrl, objectKey, msgId)

    if (status?.isDownloaded) {
      const validPath = await validatePath(status.absolutePath)
      if (validPath) {
        return validPath
      }

      fileDownloadStore.updateFileStatus(
        fileUrl,
        {
          isDownloaded: false,
          absolutePath: '',
          localPath: '',
          nativePath: '',
          displayPath: '',
          status: 'pending',
          progress: 0
        },
        objectKey,
        msgId
      )
    }

    const fileName = getBodyFileName(body)
    if (!fileName) {
      return null
    }

    try {
      const exists = await fileDownloadStore.checkFileExists(fileUrl || objectKey || '', fileName, objectKey, msgId)
      if (!exists) {
        return null
      }

      const refreshedStatus = fileDownloadStore.getFileStatus(fileUrl, objectKey, msgId)
      return await validatePath(refreshedStatus.absolutePath)
    } catch (error) {
      console.error('重新检查本地图片失败:', error)
      return null
    }
  }

  const getDisplayUrl = async (key: string, includeTypes: MsgEnum[]) => {
    const localPath = await ensureLocalFileExists(key, includeTypes)
    if (localPath) {
      try {
        return convertFileSrc(localPath)
      } catch (error) {
        console.error('转换本地图片路径失败:', error)
      }
    }

    const msg = findMessageByWorkKey(key, includeTypes)
    const body = msg?.message?.body || {}
    if (body.url) {
      return body.url
    }
    if (body.objectKey && msg?.message?.id) {
      return await resolveSignedFileUrl('', msg.message.id, body.objectKey)
    }
    return key
  }

  const getLocalMediaPathFromChat = (key: string, includeTypes: MsgEnum[]) => {
    const msg = findMessageByWorkKey(key, includeTypes)
    return msg?.message?.body?.localPath || null
  }

  const resolveDisplayUrl = async (key: string, includeTypes: MsgEnum[]) => {
    const localPath = getLocalMediaPathFromChat(key, includeTypes)
    if (localPath) {
      try {
        return convertFileSrc(localPath)
      } catch (error) {
        console.error('转换本地媒体路径失败:', error)
      }
    }
    return await getDisplayUrl(key, includeTypes)
  }

  const replaceImageWithLocalPath = (originalKey: string, absolutePath: string) => {
    const index = imageViewerStore.originalImageList.indexOf(originalKey)
    if (index === -1) {
      return
    }
    try {
      const displayUrl = convertFileSrc(absolutePath)
      imageViewerStore.updateImageAt(index, displayUrl)
      imageViewerStore.updateSingleImageSource(displayUrl)
    } catch (error) {
      console.error('替换本地图片路径失败:', error)
    }
  }

  const scheduleDownload = (originalKey: string, msgId?: string) => {
    const msg = findMessageByWorkKey(originalKey, [MsgEnum.IMAGE, MsgEnum.EMOJI])
    const body = msg?.message?.body || {}
    const objectKey = body.objectKey
    const finalMsgId = msgId || msg?.message?.id
    const fileName = getBodyFileName(body) || `image-${Date.now()}.png`
    downloadImageWithWorker(originalKey, fileName, finalMsgId, objectKey)
      .then((absolutePath) => {
        if (absolutePath) {
          replaceImageWithLocalPath(originalKey, absolutePath)
        }
      })
      .catch((error) => {
        console.error('图片下载失败:', error)
      })
  }

  const downloadOriginalByIndex = (index: number) => {
    if (index < 0) {
      return
    }
    const originalKey = imageViewerStore.originalImageList[index]
    if (!originalKey) {
      return
    }
    const displayUrl = imageViewerStore.imageList[index]
    if (!displayUrl || displayUrl !== originalKey) {
      return
    }
    const msgId = imageViewerStore.getMsgIdByUrl(originalKey)
    scheduleDownload(originalKey, msgId)
  }

  /**
   * 获取当前聊天中的所有图片和表情包URL（以稳定 workKey 返回）
   * @param currentKey 当前查看的 workKey（url / objectKey / msgId:xxx）
   * @param includeTypes 要包含的消息类型数组
   */
  const getAllMediaFromChat = (currentKey: string, includeTypes: MsgEnum[] = [MsgEnum.IMAGE, MsgEnum.EMOJI]) => {
    const messages = [...Object.values(chatStore.currentMessageMap || {})]
    const mediaKeys: string[] = []
    const msgIdMap: Record<string, string> = {}
    let currentIndex = 0

    messages.forEach((msg: any) => {
      if (includeTypes.includes(msg.message?.type)) {
        const key = computeWorkKey(msg)
        if (!key) return
        mediaKeys.push(key)
        if (msg.message?.id) {
          msgIdMap[key] = msg.message.id
        }
        if (key === currentKey) {
          currentIndex = mediaKeys.length - 1
        }
      }
    })

    return {
      list: mediaKeys,
      index: currentIndex,
      msgIdMap
    }
  }

  /**
   * 打开图片查看器
   * @param key 要查看的 workKey（url / objectKey / msgId:xxx）
   * @param includeTypes 要包含在查看器中的消息类型
   * @param customImageList 自定义图片列表（元素为 workKey），用于聊天历史等场景
   * @param msgIdMap 自定义 workKey -> 消息 ID 映射（用于无法从 current chat 推导的场景）
   */
  const openImageViewer = async (
    key: string,
    includeTypes: MsgEnum[] = [MsgEnum.IMAGE, MsgEnum.EMOJI],
    customImageList?: string[],
    msgIdMap?: Record<string, string>
  ) => {
    if (!key) return

    try {
      let list: string[]
      let index: number
      let mergedMsgIdMap: Record<string, string> = msgIdMap ? { ...msgIdMap } : {}

      if (customImageList && customImageList.length > 0) {
        // 使用自定义图片列表
        list = customImageList
        index = customImageList.indexOf(key)
        if (index === -1) {
          // 如果当前图片不在列表中，将其添加到列表开头
          list = [key, ...customImageList]
          index = 0
        }
      } else {
        // 使用默认逻辑从聊天中获取
        const result = getAllMediaFromChat(key, includeTypes)
        list = result.list
        index = result.index
        mergedMsgIdMap = { ...mergedMsgIdMap, ...result.msgIdMap }
      }

      const dedupedList = deduplicateList(list)
      const resolvedIndex = dedupedList.indexOf(key) !== -1 ? dedupedList.indexOf(key) : Math.max(index, 0)
      const resolvedList = await Promise.all(dedupedList.map((item) => resolveDisplayUrl(item, includeTypes)))

      imageViewerStore.resetImageList(resolvedList, resolvedIndex, dedupedList, mergedMsgIdMap)

      // 检查图片查看器窗口是否已存在
      const existingWindow = await WebviewWindow.getByLabel('imageViewer')

      if (existingWindow) {
        // 如果窗口已存在，更新图片内容并显示窗口
        await existingWindow.emit('update-image', { list: resolvedList, index: resolvedIndex })
        await existingWindow.show()
        await existingWindow.setFocus()
        return
      }

      const img = new Image()
      img.src = resolvedList[resolvedIndex] || key

      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
      })

      // 默认窗口尺寸（最小尺寸）
      const MIN_WINDOW_WIDTH = 630
      const MIN_WINDOW_HEIGHT = 660
      // 计算实际窗口尺寸（保留一定边距）
      const MARGIN = 100 // 窗口边距
      let windowWidth = MIN_WINDOW_WIDTH
      let windowHeight = MIN_WINDOW_HEIGHT

      // 获取屏幕尺寸
      const { width: screenWidth, height: screenHeight } = window.screen

      // 计算最大可用尺寸（考虑边距）
      const maxWidth = screenWidth - MARGIN * 2
      const maxHeight = screenHeight - MARGIN * 2

      // 保持图片比例计算窗口尺寸
      const imageRatio = img.width / img.height

      // 计算实际窗口尺寸
      if (img.width > MIN_WINDOW_WIDTH || img.height > MIN_WINDOW_HEIGHT) {
        if (imageRatio > maxWidth / maxHeight) {
          // 以宽度为基准
          windowWidth = Math.min(img.width + MARGIN, maxWidth)
          windowHeight = Math.max(windowWidth / imageRatio + MARGIN, MIN_WINDOW_HEIGHT)
        } else {
          // 以高度为基准
          windowHeight = Math.min(img.height + MARGIN, maxHeight)
          windowWidth = Math.max(windowHeight * imageRatio + MARGIN, MIN_WINDOW_WIDTH)
        }
      }

      // 创建窗口，使用计算后的尺寸
      await createWebviewWindow(
        '图片查看',
        'imageViewer',
        Math.round(windowWidth),
        Math.round(windowHeight),
        '',
        true,
        Math.round(windowWidth),
        Math.round(windowHeight)
      )
    } catch (error) {
      console.error('打开图片查看器失败:', error)
    }
  }

  return {
    getAllMediaFromChat,
    openImageViewer,
    downloadOriginalByIndex
  }
}
