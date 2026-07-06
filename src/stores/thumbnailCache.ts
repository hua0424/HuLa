import { appDataDir, join, resourceDir } from '@tauri-apps/api/path'
import { BaseDirectory, exists, mkdir, writeFile } from '@tauri-apps/plugin-fs'
import { defineStore } from 'pinia'
import { StoresEnum } from '@/enums'
import { useUserStore } from '@/stores/user'
import { useChatStore } from '@/stores/chat'
import { detectRemoteFileType } from '@/utils/PathUtil'
import { isMobile } from '@/utils/PlatformConstants'
import { invokeSilently } from '@/utils/TauriInvokeHandler'
import { TauriCommand } from '@/enums'
import { md5FromString } from '@/utils/Md5Util'
import { resolveSignedFileUrl, type SignDownloadTarget } from '@/utils/fileSign'

type TaskKind = 'image' | 'video' | 'emoji'

type Task = {
  url: string
  objectKey?: string
  msgId: string
  roomId: string
  kind: TaskKind
  target?: SignDownloadTarget
  status: 'pending' | 'downloading' | 'completed' | 'failed'
  retries: number
  path?: string
  error?: string
}

export const useThumbnailCacheStore = defineStore(
  StoresEnum.THUMBNAIL_CACHE,
  () => {
    const userStore = useUserStore()
    const chatStore = useChatStore()

    const maxConcurrency = 4
    const queue: Task[] = []
    let active = 0
    const statusMap = ref<Record<string, Task>>({})
    const worker = new Worker(new URL('../workers/imageDownloader.ts', import.meta.url))
    const waiterMap = new Map<string, Array<(path: string | null) => void>>()

    const getTaskKey = (task: Task) => {
      return task.url || task.objectKey || (task.msgId ? `msgId:${task.msgId}` : '')
    }

    const notifyWaiters = (task: Task, path: string | null) => {
      const key = getTaskKey(task)
      const waiters = waiterMap.get(key)
      if (waiters?.length) {
        waiters.forEach((resolve) => resolve(path))
        waiterMap.delete(key)
      }
    }

    const buildUpdatedBody = (task: Task, currentBody: any, abs: string) => {
      if (task.kind === 'emoji') {
        return { ...currentBody, localPath: abs }
      }
      return { ...currentBody, thumbnailPath: abs }
    }

    const persistMessage = async (task: Task, abs: string) => {
      const msg = chatStore.getMessage(task.msgId)
      if (!msg) return
      const nextBody = buildUpdatedBody(task, msg.message.body || {}, abs)
      chatStore.updateMsg({ msgId: task.msgId, status: msg.message.status, body: nextBody })
      const updated = { ...msg, message: { ...msg.message, body: nextBody } }
      await invokeSilently(TauriCommand.SAVE_MSG, { data: updated as any })
    }

    const ensureCacheDir = async (kind: TaskKind) => {
      const dir = await userStore.getUserRoomDir()
      const folder = kind === 'emoji' ? 'emojis' : 'thumbnails'
      const target = await join(dir, folder)
      const baseDir = isMobile() ? BaseDirectory.AppData : BaseDirectory.Resource
      const ok = await exists(target, { baseDir })
      if (!ok) {
        await mkdir(target, { baseDir, recursive: true })
      }
      return { relativeDir: target, baseDir }
    }

    const decideExt = async (url: string, msgId?: string) => {
      const match = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)
      if (match?.[1]) {
        return match[1].toLowerCase()
      }
      const info = await detectRemoteFileType({ url, fileSize: null, msgId })
      return info?.ext ? info.ext : 'jpg'
    }

    const getAbsolute = async (relativePath: string) => {
      const baseDirPath = isMobile() ? await appDataDir() : await resourceDir()
      return await join(baseDirPath, relativePath)
    }

    const dispatchNext = async () => {
      if (active >= maxConcurrency) return
      const next = queue.shift()
      if (!next) return
      active++
      await processTask(next)
      active--
      void dispatchNext()
    }

    const processTask = async (task: Task) => {
      const taskKey = getTaskKey(task)
      try {
        task.status = 'downloading'
        statusMap.value[taskKey] = task
        const { relativeDir, baseDir } = await ensureCacheDir(task.kind)
        const hash = await md5FromString(taskKey)
        const ext = await decideExt(task.url || task.objectKey || '', task.msgId)
        const fileName = `${hash}.${ext}`
        const relPath = await join(relativeDir, fileName)
        const existsFlag = await exists(relPath, { baseDir })
        if (existsFlag) {
          const abs = await getAbsolute(relPath)
          task.status = 'completed'
          task.path = abs
          statusMap.value[taskKey] = task
          notifyWaiters(task, abs)
          await persistMessage(task, abs)
          return
        }

        const fetchUrl = await resolveSignedFileUrl(task.url, task.msgId, task.objectKey, task.target ?? 'file')

        const buffer: ArrayBuffer = await new Promise((resolve, reject) => {
          const handler = (e: MessageEvent<any>) => {
            const data = e.data
            if (data?.url !== taskKey) return
            worker.removeEventListener('message', handler as any)
            if (data.success) resolve(data.buffer as ArrayBuffer)
            else reject(new Error(data.error || 'download failed'))
          }
          worker.addEventListener('message', handler as any)
          worker.postMessage({ url: fetchUrl, originalUrl: taskKey })
        })

        const bytes = new Uint8Array(buffer)
        await writeFile(relPath, bytes, { baseDir })
        const abs = await getAbsolute(relPath)
        task.status = 'completed'
        task.path = abs
        statusMap.value[taskKey] = task
        notifyWaiters(task, abs)
        await persistMessage(task, abs)
      } catch (err: any) {
        task.retries += 1
        task.error = String(err?.message || err)
        statusMap.value[taskKey] = task
        if (task.retries < 3) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** (task.retries - 1)))
          queue.unshift(task)
        } else {
          task.status = 'failed'
          notifyWaiters(task, null)
        }
      }
    }

    const enqueueThumbnail = async (options: {
      url: string
      objectKey?: string
      msgId: string
      roomId: string
      kind: TaskKind
      target?: SignDownloadTarget
    }) => {
      const t: Task = { ...options, status: 'pending', retries: 0 }
      const taskKey = getTaskKey(t)
      const existsTask = statusMap.value[taskKey]
      if (existsTask?.status === 'completed') {
        return Promise.resolve(existsTask.path ?? null)
      }

      const promise = new Promise<string | null>((resolve) => {
        const waiters = waiterMap.get(taskKey)
        if (waiters) {
          waiters.push(resolve)
        } else {
          waiterMap.set(taskKey, [resolve])
        }
      })

      if (!existsTask || existsTask.status === 'failed') {
        statusMap.value[taskKey] = t
        queue.push(t)
        void dispatchNext()
      }

      return promise
    }

    const invalidate = (url?: string, objectKey?: string, msgId?: string) => {
      if (!url && !objectKey && !msgId) return
      const key = url || objectKey || (msgId ? `msgId:${msgId}` : '')
      if (statusMap.value[key]) {
        delete statusMap.value[key]
      }
      waiterMap.delete(key)
    }

    const getStatus = (url?: string, objectKey?: string, msgId?: string) => {
      const key = url || objectKey || (msgId ? `msgId:${msgId}` : '')
      return statusMap.value[key]
    }

    return {
      enqueueThumbnail,
      invalidate,
      getStatus
    }
  },
  {
    share: { enable: true, initialize: true }
  }
)
