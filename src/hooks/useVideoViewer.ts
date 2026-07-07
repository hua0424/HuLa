import { appDataDir, isAbsolute, join, resourceDir } from '@tauri-apps/api/path'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { BaseDirectory, exists } from '@tauri-apps/plugin-fs'
import { MsgEnum } from '@/enums'
import { useWindow } from '@/hooks/useWindow'
import { useChatStore } from '@/stores/chat'
import { useUserStore } from '@/stores/user'
import { useVideoViewer as useVideoViewerStore } from '@/stores/videoViewer'
import { isMobile } from '@/utils/PlatformConstants'
import { resolveSignedFileUrl } from '@/utils/fileSign'

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

/** 视频处理 */
export const useVideoViewer = () => {
  const { createWebviewWindow } = useWindow()
  const VideoViewerStore = useVideoViewerStore()
  const userStore = useUserStore()

  // 获取视频文件名
  const getVideoFilename = (url: string, filename?: string) => {
    if (filename) return filename
    if (!url) return 'video.mp4'
    // 从URL中提取文件名
    const urlParts = url.split('/')
    const extractedFilename = urlParts[urlParts.length - 1]
    if (extractedFilename && extractedFilename.includes('.')) {
      return extractedFilename
    }
    return 'video.mp4'
  }

  // 获取本地视频路径
  const getLocalVideoPath = async (url: string, filename?: string) => {
    if (!url && !filename) return ''
    const name = getVideoFilename(url, filename)
    const videosDir = await userStore.getUserRoomDir()
    return await join(videosDir, name)
  }

  // 检查视频是否已下载到本地
  const checkVideoDownloaded = async (url: string, filename?: string) => {
    if (!url && !filename) return false
    try {
      const localPath = await getLocalVideoPath(url, filename)
      if (localPath) {
        const baseDir = isMobile() ? BaseDirectory.AppData : BaseDirectory.Resource
        return await exists(localPath, { baseDir })
      }
    } catch (error) {
      console.error('检查视频下载状态失败:', error)
    }
    return false
  }

  // 获取视频的实际播放路径（本地路径优先；objectKey-only 时换签）
  const getVideoPlayPath = async (key: string, filename?: string, msgId?: string, objectKey?: string) => {
    const isDownloaded = await checkVideoDownloaded(key, filename)
    if (isDownloaded) {
      const localPath = await getLocalVideoPath(key, filename)
      // 使用与下载时一致的基础目录
      const baseDirPath = isMobile() ? await appDataDir() : await resourceDir()
      return await join(baseDirPath, localPath)
    }
    if (objectKey && msgId) {
      return await resolveSignedFileUrl('', msgId, objectKey, 'file')
    }
    return key
  }

  // 媒体获取（支持类型过滤和索引定位，以稳定 workKey 返回）
  const getAllMediaFromChat = (currentKey: string, includeTypes: MsgEnum[] = [MsgEnum.VIDEO]) => {
    const chatStore = useChatStore()
    const messages = [...Object.values(chatStore.currentMessageMap || {})]
    const mediaKeys: string[] = []
    let currentIndex = -1
    messages.forEach((msg: any) => {
      if (includeTypes.includes(msg.message?.type)) {
        const key = computeWorkKey(msg)
        if (!key) return
        mediaKeys.push(key)
        // 在添加元素后判断是否目标URL
        if (key === currentKey) {
          currentIndex = mediaKeys.length - 1 // 使用数组最后一位索引
        }
      }
    })
    return {
      list: mediaKeys,
      index: Math.max(currentIndex, 0)
    }
  }

  const resolveDisplayPath = async (key: string) => {
    const msg = findMessageByWorkKey(key, [MsgEnum.VIDEO])
    const body = msg?.message?.body || {}
    const filename = body.filename
    const msgId = msg?.message?.id
    const objectKey = body.objectKey
    if (body.localPath) {
      // 本地路径可能是绝对路径（下载后完整保存）或相对路径（旧数据），避免重复拼接 baseDir
      if (await isAbsolute(body.localPath)) {
        return body.localPath
      }
      const baseDirPath = isMobile() ? await appDataDir() : await resourceDir()
      return await join(baseDirPath, body.localPath)
    }
    return await getVideoPlayPath(key, filename, msgId, objectKey)
  }

  /**
   * 视频加载处理
   * @param key 视频 workKey（url / objectKey / msgId:xxx）
   * @param includeTypes 支持类型
   * @param customVideoList 自定义视频列表（元素为 workKey），用于聊天历史等场景
   */
  const openVideoViewer = async (
    key: string,
    includeTypes: MsgEnum[] = [MsgEnum.VIDEO],
    customVideoList?: string[]
  ) => {
    if (isMobile()) return
    if (!key) return

    let list: string[]
    let index: number

    if (customVideoList && customVideoList.length > 0) {
      // 使用自定义视频列表
      list = customVideoList
      index = customVideoList.indexOf(key)
      if (index === -1) {
        // 如果当前视频不在列表中，将其添加到列表开头
        list = [key, ...customVideoList]
        index = 0
      }
    } else {
      // 使用默认逻辑从聊天中获取
      const result = getAllMediaFromChat(key, includeTypes)
      list = result.list
      index = result.index
    }

    // 为每个视频 workKey 检查本地下载状态或换签，优先使用本地路径
    const processedList = await Promise.all(list.map((videoKey) => resolveDisplayPath(videoKey)))

    // 找到当前视频在处理后列表中的索引
    const currentVideoPath = await resolveDisplayPath(key)
    const processedIndex = processedList.findIndex((path) => path === currentVideoPath || path === key)
    const finalIndex = processedIndex !== -1 ? processedIndex : index

    // 统一使用列表模式，不再区分单视频模式
    VideoViewerStore.resetVideoListOptimized(processedList, finalIndex)
    VideoViewerStore.$patch({
      videoList: [...processedList],
      currentVideoIndex: finalIndex
    })

    // 检查现有窗口
    const existingWindow = await WebviewWindow.getByLabel('videoViewer')
    if (existingWindow) {
      await existingWindow.emit('video-updated', {
        list: processedList,
        index: finalIndex,
        currentVideoPath
      })
      await existingWindow.show()
      await existingWindow.setFocus()
      return
    }

    await createWebviewWindow('视频查看器', 'videoViewer', 800, 600, '', true, 800, 600)
  }

  return {
    openVideoViewer,
    getLocalVideoPath,
    checkVideoDownloaded,
    getVideoFilename,
    resolveDisplayPath
  }
}
