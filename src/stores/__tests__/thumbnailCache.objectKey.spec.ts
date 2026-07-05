import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

class MockWorker {
  private listeners: Array<(e: MessageEvent) => void> = []

  addEventListener = (type: string, fn: (e: MessageEvent) => void) => {
    if (type === 'message') {
      this.listeners.push(fn)
    }
  }

  removeEventListener = (type: string, fn: (e: MessageEvent) => void) => {
    if (type === 'message') {
      this.listeners = this.listeners.filter((l) => l !== fn)
    }
  }

  postMessage = (data: { url: string; originalUrl: string }) => {
    setTimeout(() => {
      this.listeners.forEach((fn) => {
        fn(
          new MessageEvent('message', {
            data: { url: data.originalUrl, success: true, buffer: new ArrayBuffer(8) }
          })
        )
      })
    }, 0)
  }
}

vi.stubGlobal('Worker', MockWorker)

vi.mock('@/stores/user', () => ({
  useUserStore: () => ({
    getUserRoomDir: vi.fn().mockResolvedValue('/app/user/room')
  })
}))

const updateMsgMock = vi.fn()
const getMessageMock = vi.fn().mockReturnValue(undefined)

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    updateMsg: updateMsgMock,
    getMessage: getMessageMock
  })
}))

vi.mock('@/utils/PathUtil', () => ({
  detectRemoteFileType: vi.fn().mockResolvedValue({ ext: 'jpg' })
}))

vi.mock('@/utils/fileSign', () => ({
  resolveSignedFileUrl: vi.fn().mockResolvedValue('https://signed.example.com/thumb.jpg')
}))

vi.mock('@/utils/TauriInvokeHandler', () => ({
  invokeSilently: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/utils/PlatformConstants', () => ({
  isMobile: vi.fn().mockReturnValue(false)
}))

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/app'),
  resourceDir: vi.fn().mockResolvedValue('/res'),
  join: vi.fn().mockImplementation((...parts: string[]) => parts.join('/'))
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData', Resource: 'Resource' },
  exists: vi.fn().mockResolvedValue(false),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined)
}))

import { useThumbnailCacheStore } from '@/stores/thumbnailCache'

describe('BL-003 thumbnailCache objectKey support', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    updateMsgMock.mockClear()
    getMessageMock.mockReturnValue(undefined)
  })

  const flushWorker = () => new Promise((r) => setTimeout(r, 20))

  it('url 为空但 objectKey 存在时，使用 objectKey 作为 task key 并完成下载', async () => {
    const store = useThumbnailCacheStore()

    const promise = store.enqueueThumbnail({
      url: '',
      objectKey: 'chat/object-key-1.png',
      msgId: 'msg-123',
      roomId: 'room-1',
      kind: 'image'
    })

    await flushWorker()
    const path = await promise

    expect(path).toContain('/thumbnails/')
    expect(path).toMatch(/\.png$/)

    const status = store.getStatus('', 'chat/object-key-1.png', 'msg-123')
    expect(status?.status).toBe('completed')
    expect(status?.path).toBe(path)
  })

  it('url 和 objectKey 都为空时，使用 msgId 作为 task key', async () => {
    const store = useThumbnailCacheStore()

    const promise = store.enqueueThumbnail({
      url: '',
      msgId: 'msg-456',
      roomId: 'room-1',
      kind: 'video'
    })

    await flushWorker()
    const path = await promise

    expect(path).toBeTruthy()
    const status = store.getStatus('', undefined, 'msg-456')
    expect(status?.status).toBe('completed')
  })

  it('已完成任务直接返回缓存路径，不重复下载', async () => {
    const store = useThumbnailCacheStore()

    const first = await store
      .enqueueThumbnail({
        url: '',
        objectKey: 'chat/object-key-2.jpg',
        msgId: 'msg-789',
        roomId: 'room-1',
        kind: 'image'
      })
      .then(async (p) => {
        await flushWorker()
        return p
      })

    const second = await store
      .enqueueThumbnail({
        url: '',
        objectKey: 'chat/object-key-2.jpg',
        msgId: 'msg-789',
        roomId: 'room-1',
        kind: 'image'
      })
      .then(async (p) => {
        await flushWorker()
        return p
      })

    expect(second).toBe(first)
  })

  it('invalidate 可按 objectKey 清除缓存状态', async () => {
    const store = useThumbnailCacheStore()

    await store
      .enqueueThumbnail({
        url: '',
        objectKey: 'chat/object-key-3.jpg',
        msgId: 'msg-000',
        roomId: 'room-1',
        kind: 'image'
      })
      .then(async (p) => {
        await flushWorker()
        return p
      })

    expect(store.getStatus('', 'chat/object-key-3.jpg', 'msg-000')?.status).toBe('completed')

    store.invalidate('', 'chat/object-key-3.jpg', 'msg-000')

    expect(store.getStatus('', 'chat/object-key-3.jpg', 'msg-000')).toBeUndefined()
  })
})
