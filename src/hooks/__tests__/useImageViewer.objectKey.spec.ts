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

class MockImage {
  width = 100
  height = 100
  onload?: () => void
  onerror?: () => void
  private _src = ''
  set src(value: string) {
    this._src = value
    setTimeout(() => this.onload?.(), 0)
  }
  get src() {
    return this._src
  }
}

vi.stubGlobal('Image', MockImage)

const resetImageListMock = vi.fn()
const updateImageAtMock = vi.fn()
const updateSingleImageSourceMock = vi.fn()

vi.mock('@/stores/imageViewer', () => ({
  useImageViewer: () => ({
    resetImageList: resetImageListMock,
    updateImageAt: updateImageAtMock,
    updateSingleImageSource: updateSingleImageSourceMock,
    originalImageList: [],
    imageList: [],
    getMsgIdByUrl: vi.fn()
  })
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    currentMessageMap: {
      'msg-123': {
        message: {
          id: 'msg-123',
          roomId: 'room-1',
          type: 3, // IMAGE
          body: { url: '', objectKey: 'chat/object-key.png' }
        }
      }
    }
  })
}))

vi.mock('@/stores/fileDownload', () => ({
  useFileDownloadStore: () => ({
    getFileStatus: vi.fn(() => ({ isDownloaded: false })),
    updateFileStatus: vi.fn(),
    checkFileExists: vi.fn().mockResolvedValue(false),
    saveFileFromBytes: vi.fn().mockResolvedValue('/abs/object-key.png')
  })
}))

vi.mock('@/hooks/useWindow', () => ({
  useWindow: () => ({
    createWebviewWindow: vi.fn()
  })
}))

vi.mock('@/utils/fileSign', () => ({
  resolveSignedFileUrl: vi.fn().mockResolvedValue('https://signed.example.com/image.png')
}))

vi.mock('@/utils/PathUtil', () => ({
  getFilesMeta: vi.fn().mockResolvedValue([{ exists: false }])
}))

vi.mock('@/utils/Formatting', () => ({
  extractFileName: vi.fn((s: string) => s.split('/').pop() || '')
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path: string) => `convert://${path}`)
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: {
    getByLabel: vi.fn().mockResolvedValue(null)
  }
}))

import { useImageViewer } from '@/hooks/useImageViewer'
import { MsgEnum } from '@/enums'

const flushPromises = () => new Promise((r) => setTimeout(r, 20))

describe('BL-003 useImageViewer objectKey support', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetImageListMock.mockClear()
    updateImageAtMock.mockClear()
    updateSingleImageSourceMock.mockClear()
  })

  it('objectKey-only 图片打开查看器时，originalList 保留 objectKey，imageList 使用换签后的 URL', async () => {
    const { openImageViewer } = useImageViewer()

    void openImageViewer('chat/object-key.png', [MsgEnum.IMAGE, MsgEnum.EMOJI])
    await flushPromises()

    expect(resetImageListMock).toHaveBeenCalledTimes(1)
    const [imageList, index, originalList, msgIdMap] = resetImageListMock.mock.calls[0]

    expect(originalList).toEqual(['chat/object-key.png'])
    expect(imageList).toEqual(['https://signed.example.com/image.png'])
    expect(index).toBe(0)
    expect(msgIdMap).toEqual({ 'chat/object-key.png': 'msg-123' })
  })

  it('自定义列表中包含 objectKey 时也能正确解析显示 URL', async () => {
    const { openImageViewer } = useImageViewer()

    void openImageViewer('chat/object-key.png', [MsgEnum.IMAGE, MsgEnum.EMOJI], ['https://example.com/old.jpg'])
    await flushPromises()

    expect(resetImageListMock).toHaveBeenCalledTimes(1)
    const [imageList, index, originalList] = resetImageListMock.mock.calls[0]

    expect(originalList).toEqual(['chat/object-key.png', 'https://example.com/old.jpg'])
    expect(imageList).toEqual(['https://signed.example.com/image.png', 'https://example.com/old.jpg'])
    expect(index).toBe(0)
  })
})
