import { appDataDir, join, resourceDir } from '@tauri-apps/api/path'
import { BaseDirectory, exists, writeFile } from '@tauri-apps/plugin-fs'
import { sumBy } from 'es-toolkit'
import { defineStore } from 'pinia'
import { StoresEnum } from '@/enums'
import type { FilesMeta } from '@/services/types'
import { useUserStore } from '@/stores/user'
import { getFilesMeta } from '@/utils/PathUtil'
import { resolveSignedFileUrl } from '@/utils/fileSign'
import { isMobile } from '../utils/PlatformConstants'

export interface FileDownloadStatus {
  /** 文件是否已下载 */
  isDownloaded: boolean
  /** 本地文件相对路径 (相对于 Resource 目录) */
  localPath?: string
  /** 本地文件绝对路径 */
  absolutePath?: string
  /** 原生路径格式 (用于文件操作) */
  nativePath?: string
  /** 显示路径格式 (规范化后) */
  displayPath?: string
  /** 下载状态 */
  status: 'pending' | 'downloading' | 'completed' | 'failed'
  /** 下载进度 */
  progress?: number
  /** 错误信息 */
  error?: string
}

export const useFileDownloadStore = defineStore(
  StoresEnum.FILE_DOWNLOAD,
  () => {
    const userStore = useUserStore()

    // 存储文件下载状态的Map，key为文件URL/objectKey/msgId，value为下载状态
    const downloadStatusMap = ref<Record<string, FileDownloadStatus>>({})

    /**
     * 计算稳定的状态 key。signed URL 会过期，不能作为 key；优先用原始 url/objectKey，
     * 都没有时才用 msgId 兜底。
     */
    const getStatusKey = (fileUrl: string, objectKey?: string, msgId?: string): string => {
      return fileUrl || objectKey || (msgId ? `msgId:${msgId}` : '')
    }

    /**
     * 获取文件下载状态
     * @param fileUrl 文件URL
     * @param objectKey 服务端 objectKey（objectKey-only 消息时使用）
     * @param msgId 消息ID（objectKey 为空时的兜底 key）
     */
    const getFileStatus = (fileUrl: string, objectKey?: string, msgId?: string): FileDownloadStatus => {
      const key = getStatusKey(fileUrl, objectKey, msgId)
      return (
        downloadStatusMap.value[key] || {
          isDownloaded: false,
          status: 'pending'
        }
      )
    }

    /**
     * 更新文件下载状态
     * @param fileUrl 文件URL
     * @param status 状态更新
     * @param objectKey 服务端 objectKey
     * @param msgId 消息ID
     */
    const updateFileStatus = (
      fileUrl: string,
      status: Partial<FileDownloadStatus>,
      objectKey?: string,
      msgId?: string
    ) => {
      const key = getStatusKey(fileUrl, objectKey, msgId)
      const currentStatus = getFileStatus(fileUrl, objectKey, msgId)
      const newStatus = { ...currentStatus, ...status }
      downloadStatusMap.value[key] = newStatus
    }

    /**
     * 刷新文件消息的下载状态
     */
    const refreshFileDownloadStatus = async (options: {
      fileUrl: string
      userId: string
      roomId: string
      fileName: string
      exists?: boolean
      objectKey?: string
      msgId?: string
    }) => {
      console.log('触发状态刷新：', options)
      const key = getStatusKey(options.fileUrl, options.objectKey, options.msgId)
      const fileStatus = downloadStatusMap.value[key]

      const resetStatus = () => {
        if (fileStatus) {
          fileStatus.isDownloaded = false
          fileStatus.absolutePath = ''
          fileStatus.displayPath = ''
          fileStatus.localPath = ''
          fileStatus.nativePath = ''
          fileStatus.progress = 0
          fileStatus.status = 'pending'
        }
      }

      const updateSuccess = (absolutePath: string) => {
        if (fileStatus) {
          const normalizedPath = absolutePath.replace(/\\/g, '/')
          fileStatus.isDownloaded = true
          fileStatus.nativePath = absolutePath
          fileStatus.absolutePath = absolutePath
          fileStatus.displayPath = normalizedPath
        }
      }

      const resourceDirPath = await userStore.getUserRoomAbsoluteDir()
      const absolutePath = await join(resourceDirPath, options.fileName)

      // 如果直接知道文件不存在，那就直接刷新，如果不知道则再做处理
      if (Object.hasOwn(options, 'exists')) {
        if (options.exists && fileStatus?.isDownloaded) {
          console.log('匹配1')
          return
        }

        if (options.exists) {
          console.log('匹配2')
          updateSuccess(absolutePath)
          return
        }

        if (options.exists && !fileStatus?.isDownloaded) {
          console.log('匹配3')
          updateSuccess(absolutePath)
          return
        }

        if (!options.exists && fileStatus?.isDownloaded) {
          console.log('匹配4')
          resetStatus()
          return
        }

        if (!options.exists && fileStatus?.isDownloaded) {
          console.log('匹配5')
          resetStatus()
          return
        }
        console.log('匹配6')

        resetStatus()
        return
      }

      // 这是匹配未查找到exists字段的逻辑
      const result = await getFilesMeta<FilesMeta>([absolutePath || options.fileUrl])
      const fileMeta = result[0]

      if (fileMeta.exists) {
        // 把状态更新为完成
        updateSuccess(absolutePath)
        console.log('匹配7')
      } else {
        // 把状态更新为未完成
        resetStatus()
        console.log('匹配8')
      }
    }

    /**
     * 检查文件是否已下载
     * @param fileUrl 文件URL
     * @param fileName 文件名
     */
    const checkFileExists = async (
      fileUrl: string,
      fileName: string,
      objectKey?: string,
      msgId?: string
    ): Promise<boolean> => {
      try {
        const downloadsDir = await userStore.getUserRoomDir()
        const filePath = await join(downloadsDir, fileName)

        const baseDir = isMobile() ? BaseDirectory.AppData : BaseDirectory.Resource
        const fileExists = await exists(filePath, { baseDir })

        if (fileExists) {
          // 文件存在，构建绝对路径并更新状态
          const baseDirPath = isMobile() ? await appDataDir() : await resourceDir()
          const absolutePath = await join(baseDirPath, filePath)

          // 保持原生路径格式用于文件操作，规范化路径用于显示
          const normalizedPath = absolutePath.replace(/\\/g, '/')

          updateFileStatus(
            fileUrl,
            {
              isDownloaded: true,
              localPath: filePath,
              absolutePath: absolutePath, // 使用原生路径格式
              nativePath: absolutePath, // 保存原生路径
              displayPath: normalizedPath, // 保存显示路径
              status: 'completed'
            },
            objectKey,
            msgId
          )
        }

        return fileExists
      } catch (error) {
        console.error('检查文件是否存在失败:', error)
        return false
      }
    }

    const finalizeSuccessfulWrite = (
      fileUrl: string,
      _fileName: string,
      absolutePath: string,
      localPath: string,
      objectKey?: string,
      msgId?: string
    ) => {
      const normalizedPath = absolutePath.replace(/\\/g, '/')
      updateFileStatus(
        fileUrl,
        {
          isDownloaded: true,
          localPath,
          absolutePath,
          nativePath: absolutePath,
          displayPath: normalizedPath,
          status: 'completed',
          progress: 100
        },
        objectKey,
        msgId
      )
    }

    /**
     * 下载文件
     * @param fileUrl 文件URL
     * @param fileName 文件名
     * @param msgId 消息ID（可选），用于换取签名下载 URL
     */
    const downloadFile = async (
      fileUrl: string,
      fileName: string,
      msgId?: string,
      objectKey?: string
    ): Promise<string | null> => {
      try {
        // 检查文件是否已存在
        const isExists = await checkFileExists(fileUrl, fileName, objectKey, msgId)
        if (isExists) {
          const existingStatus = getFileStatus(fileUrl, objectKey, msgId)
          return existingStatus.localPath || null
        }

        // 更新状态为下载中
        updateFileStatus(fileUrl, { status: 'downloading', progress: 0 }, objectKey, msgId)

        // 获取下载目录
        const downloadsDir = await userStore.getUserRoomDir()
        const filePath = await join(downloadsDir, fileName)

        // 有 msgId 时先换取签名 URL（无 msgId 或失败时返回原 URL）
        const fetchUrl = await resolveSignedFileUrl(fileUrl, msgId, objectKey)

        // 下载文件
        const response = await fetch(fetchUrl)
        if (!response.ok) {
          throw new Error(`下载失败: ${response.status} ${response.statusText}`)
        }

        const contentLength = response.headers.get('content-length')
        const total = contentLength ? parseInt(contentLength, 10) : 0
        let downloaded = 0

        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error('无法读取响应流')
        }

        const chunks: Uint8Array[] = []

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          downloaded += value.length

          // 更新下载进度
          if (total > 0) {
            const progress = Math.round((downloaded / total) * 100)
            updateFileStatus(fileUrl, { status: 'downloading', progress }, objectKey, msgId)
          }
        }

        // 合并所有数据块
        const totalLength = sumBy(chunks, (chunk) => chunk.length)
        const fileData = new Uint8Array(totalLength)
        let offset = 0

        for (const chunk of chunks) {
          fileData.set(chunk, offset)
          offset += chunk.length
        }

        // 写入文件
        const baseDir = isMobile() ? BaseDirectory.AppData : BaseDirectory.Resource
        await writeFile(filePath, fileData, { baseDir })

        // 构建绝对路径
        const baseDirPath = isMobile() ? await appDataDir() : await resourceDir()
        const absolutePath = await join(baseDirPath, filePath)

        finalizeSuccessfulWrite(fileUrl, fileName, absolutePath, filePath, objectKey, msgId)
        return absolutePath // 返回原生路径格式
      } catch (error) {
        console.error('文件下载失败:', error)

        // 更新状态为失败
        updateFileStatus(
          fileUrl,
          {
            status: 'failed',
            error: error instanceof Error ? error.message : '下载失败'
          },
          objectKey,
          msgId
        )

        window.$message?.error(`文件下载失败: ${error instanceof Error ? error.message : '未知错误'}`)
        return null
      }
    }

    /**
     * 将 worker 下载的字节数据写入到本地文件
     * @param fileUrl 文件URL（作为状态映射 key）
     * @param fileName 文件名
     * @param data 文件数据
     */
    const saveFileFromBytes = async (
      fileUrl: string,
      fileName: string,
      data: Uint8Array,
      objectKey?: string,
      msgId?: string
    ): Promise<string | null> => {
      try {
        const downloadsDir = await userStore.getUserRoomDir()
        const filePath = await join(downloadsDir, fileName)
        const baseDir = isMobile() ? BaseDirectory.AppData : BaseDirectory.Resource

        await writeFile(filePath, data, { baseDir })

        const baseDirPath = isMobile() ? await appDataDir() : await resourceDir()
        const absolutePath = await join(baseDirPath, filePath)

        finalizeSuccessfulWrite(fileUrl, fileName, absolutePath, filePath, objectKey, msgId)
        return absolutePath
      } catch (error) {
        console.error('保存文件失败:', error)
        updateFileStatus(
          fileUrl,
          {
            status: 'failed',
            error: error instanceof Error ? error.message : '保存失败'
          },
          objectKey,
          msgId
        )
        return null
      }
    }

    /**
     * 获取本地文件路径
     * @param fileUrl 文件URL
     * @param absolute 是否返回绝对路径，默认为 true
     * @param objectKey 服务端 objectKey
     * @param msgId 消息ID
     */
    const getLocalPath = (
      fileUrl: string,
      absolute: boolean = true,
      objectKey?: string,
      msgId?: string
    ): string | null => {
      const status = getFileStatus(fileUrl, objectKey, msgId)
      if (!status.isDownloaded) return null

      return absolute ? status.absolutePath || null : status.localPath || null
    }

    /**
     * 清理下载状态
     */
    const clearDownloadStatus = () => {
      downloadStatusMap.value = {}
    }

    /**
     * 移除特定文件的下载状态
     * @param fileUrl 文件URL
     * @param objectKey 服务端 objectKey
     * @param msgId 消息ID
     */
    const removeFileStatus = (fileUrl: string, objectKey?: string, msgId?: string) => {
      const key = getStatusKey(fileUrl, objectKey, msgId)
      delete downloadStatusMap.value[key]
    }

    /**
     * 批量检查文件状态
     * @param fileInfos 文件信息数组
     */
    const batchCheckFileStatus = async (
      fileInfos: Array<{ url: string; fileName: string; objectKey?: string; msgId?: string }>
    ) => {
      const promises = fileInfos.map(({ url, fileName, objectKey, msgId }) =>
        checkFileExists(url, fileName, objectKey, msgId)
      )

      await Promise.all(promises)
    }

    return {
      getFileStatus,
      updateFileStatus,
      checkFileExists,
      downloadFile,
      saveFileFromBytes,
      getLocalPath,
      clearDownloadStatus,
      removeFileStatus,
      batchCheckFileStatus,
      refreshFileDownloadStatus
    }
  },
  {
    share: {
      enable: true,
      initialize: true
    }
  }
)
