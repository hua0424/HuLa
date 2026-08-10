import { defineStore } from 'pinia'
import { homeWindowOnlyStorage } from '@/stores/persistHomeWindowOnly'
import { convertFileSrc } from '@tauri-apps/api/core'
import { appDataDir, join, resourceDir } from '@tauri-apps/api/path'
import { readDir } from '@tauri-apps/plugin-fs'
import { StoresEnum } from '@/enums'
import { isMobile } from '@/utils/PlatformConstants'
import { useUserStore } from './user'

/**
 * 文件信息接口
 */
export interface FileInfo {
  /** 文件ID（消息ID） */
  id: string
  /** 房间ID */
  roomId: string
  /** 文件名 */
  fileName: string
  /** 文件类型 */
  type: 'file' | 'image' | 'video' | 'voice'
  /** 文件URL */
  url: string
  /** 文件后缀 */
  suffix?: string
  /** MIME类型 */
  mimeType?: string
}

export const useFileStore = defineStore(
  StoresEnum.FILE,
  () => {
    // ==================== 状态定义 ====================

    /** 所有房间的文件数据 Map<roomId, Map<fileId, FileInfo>> */
    // #239 PR2：A 类键 reactive→ref——收包整键替换写穿 ref.value，跨窗活同步落地（#237 终裁第 1 条）
    const roomFilesMap = ref<Record<string, Record<string, FileInfo>>>({})

    // ==================== 计算属性 ====================

    /** 获取指定房间的所有文件 */
    const getRoomFiles = computed(() => (roomId: string) => {
      return roomFilesMap.value[roomId] ? Object.values(roomFilesMap.value[roomId]) : []
    })

    /** 获取指定房间的所有文件，转换为 img 标签可用的格式 */
    const getRoomFilesForDisplay = async (roomId: string) => {
      const files = roomFilesMap.value[roomId] ? Object.values(roomFilesMap.value[roomId]) : []

      if (files.length === 0) {
        return []
      }

      const processedFiles = await Promise.all(
        files.map(async (file) => {
          let displayUrl: string

          if (file.url.startsWith('http')) {
            // HTTP URL 直接使用
            displayUrl = file.url
          } else {
            // 相对路径需要拼接基础目录的绝对路径
            // 移动端使用 AppData，PC 端使用 Resource
            const baseDirPath = isMobile() ? await appDataDir() : await resourceDir()
            const absolutePath = await join(baseDirPath, file.url)
            displayUrl = convertFileSrc(absolutePath)
          }

          return {
            ...file,
            // 将 URL 转换为可用于前端显示的格式
            displayUrl,
            // 保留原始 URL
            originalUrl: file.url
          }
        })
      )

      return processedFiles
    }

    /** 获取指定房间的文件总数 */
    const getRoomFileCount = computed(() => (roomId: string) => {
      return roomFilesMap.value[roomId] ? Object.keys(roomFilesMap.value[roomId]).length : 0
    })

    // ==================== 操作方法 ====================

    /**
     * 添加文件到指定房间
     */
    const addFile = (fileInfo: FileInfo) => {
      const { roomId, id } = fileInfo

      if (!roomFilesMap.value[roomId]) {
        roomFilesMap.value[roomId] = {}
      }

      roomFilesMap.value[roomId][id] = fileInfo
    }

    /**
     * 移除指定房间的文件
     */
    const removeFile = (roomId: string, fileId: string) => {
      if (roomFilesMap.value[roomId] && roomFilesMap.value[roomId][fileId]) {
        delete roomFilesMap.value[roomId][fileId]
      }
    }

    /**
     * 清空指定房间的所有文件
     */
    const clearRoomFiles = (roomId: string) => {
      if (roomFilesMap.value[roomId]) {
        roomFilesMap.value[roomId] = {}
      }
    }

    /**
     * 获取指定文件信息
     */
    const getFile = (roomId: string, fileId: string): FileInfo | undefined => {
      return roomFilesMap.value[roomId]?.[fileId]
    }

    /**
     * 扫描本地目录并填充 file store
     * 用于初始化时加载已存在的文件
     * 注意：此功能仅在移动端可用
     */
    const scanLocalFiles = async (roomId: string) => {
      // 仅移动端支持扫描本地文件
      if (!isMobile()) {
        console.warn('scanLocalFiles 仅在移动端可用')
        return 0
      }

      try {
        const userStore = useUserStore()

        // 获取用户数据目录
        const userRoomDir = await userStore.getUserRoomDir()

        // 获取绝对路径（移动端使用 AppData）
        const baseDirPath = await appDataDir()
        const absolutePath = await join(baseDirPath, userRoomDir)

        // 读取目录内容
        const entries = await readDir(absolutePath)

        // 图片和视频扩展名
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
        const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm']

        let addedCount = 0

        for (const entry of entries) {
          if (!entry.isFile) continue

          const fileName = entry.name
          const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'))

          let fileType: 'image' | 'video' | null = null
          let mimeType = ''

          if (imageExtensions.includes(ext)) {
            fileType = 'image'
            mimeType = `image/${ext === '.jpg' ? 'jpeg' : ext.substring(1)}`
          } else if (videoExtensions.includes(ext)) {
            fileType = 'video'
            mimeType = `video/${ext.substring(1)}`
          }

          if (fileType) {
            // 使用文件名作为 ID（因为我们不知道原始消息 ID）
            const fileId = fileName.substring(0, fileName.lastIndexOf('.'))

            // 构建文件 URL（使用相对路径，与 getUserRoomDir 返回的格式一致）
            const fileUrl = await join(userRoomDir, fileName)

            addFile({
              id: fileId,
              roomId,
              fileName,
              type: fileType,
              url: fileUrl,
              suffix: ext.substring(1),
              mimeType
            })

            addedCount++
          }
        }

        return addedCount
      } catch (error) {
        console.error('扫描本地文件失败:', error)
        return 0
      }
    }

    return {
      // 状态
      // #239 PR2：去掉 readonly 包装——readonly(ref) 会阻断 pinia-shared-state 收包
      // 整键替换的 ref.value 写穿（readonly ref 的 set 被拦），必须暴露裸 ref
      roomFilesMap,

      // 计算属性
      getRoomFiles,
      getRoomFileCount,

      // 方法
      addFile,
      removeFile,
      clearRoomFiles,
      getFile,
      getRoomFilesForDisplay,
      scanLocalFiles
    }
  },
  {
    share: {
      enable: true,
      initialize: true
    },
    // #239：只主窗持久化，辅窗 noop——防多窗 last-writer-wins 快照倒退（#237 终裁第 4 条）
    persist: { storage: homeWindowOnlyStorage() }
  }
)
