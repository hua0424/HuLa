import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/app'),
  join: vi.fn().mockImplementation((...parts: string[]) => parts.join('/')),
  resourceDir: vi.fn().mockResolvedValue('/res')
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData', Resource: 'Resource' },
  exists: vi.fn().mockResolvedValue(false),
  writeFile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/utils/PlatformConstants', () => ({
  isMobile: vi.fn(() => false)
}))

vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: vi.fn()
}))

import { useFileDownloadStore } from '@/stores/fileDownload'
import { imRequest } from '@/utils/ImRequestUtils'

const mockUserStore = {
  getUserRoomDir: vi.fn().mockResolvedValue('room-files'),
  getUserRoomAbsoluteDir: vi.fn().mockResolvedValue('/res/room-files')
}

vi.mock('@/stores/user', () => ({
  useUserStore: () => mockUserStore
}))

vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-length': '0' }),
    body: {
      getReader: () => ({
        read: vi.fn().mockResolvedValueOnce({ done: true, value: undefined })
      })
    }
  } as unknown as Response)
)

const mockImRequest = vi.mocked(imRequest)

describe('BL-003 fileDownload store objectKey support', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockImRequest.mockReset()
    mockImRequest.mockResolvedValue({ url: 'https://signed.example.com/file' })
  })

  it('空 url + objectKey 时，downloadFile 用 objectKey 作为状态 key 并完成下载', async () => {
    const store = useFileDownloadStore()

    await store.downloadFile('', 'doc.pdf', 'msg-123', 'object-key-1')

    const status = store.getFileStatus('', 'object-key-1', 'msg-123')
    expect(status.status).toBe('completed')
    expect(status.isDownloaded).toBe(true)
    expect(mockImRequest).toHaveBeenCalledTimes(1)
  })

  it('空 url + 空 objectKey 时，downloadFile 用 msgId 作为兜底 key 并完成下载', async () => {
    const store = useFileDownloadStore()

    await store.downloadFile('', 'doc.pdf', 'msg-123')

    const status = store.getFileStatus('', undefined, 'msg-123')
    expect(status.status).toBe('completed')
    expect(status.isDownloaded).toBe(true)
  })

  it('checkFileExists 在 url 为空但 objectKey 存在时仍能写状态', async () => {
    const store = useFileDownloadStore()

    await store.checkFileExists('', 'doc.pdf', 'object-key-1', 'msg-123')

    const status = store.getFileStatus('', 'object-key-1', 'msg-123')
    expect(status.status).toBe('pending')
    expect(status.isDownloaded).toBe(false)
  })

  it('refreshFileDownloadStatus 使用与 downloadFile 一致的稳定 key', async () => {
    const store = useFileDownloadStore()

    await store.refreshFileDownloadStatus({
      fileUrl: '',
      objectKey: 'object-key-1',
      msgId: 'msg-123',
      roomId: 'room-1',
      userId: 'user-1',
      fileName: 'doc.pdf',
      exists: false
    })

    const status = store.getFileStatus('', 'object-key-1', 'msg-123')
    expect(status.status).toBe('pending')
    expect(status.isDownloaded).toBe(false)
  })

  it('旧消息（带 http url）状态 key 仍为 url，objectKey/msgId 不影响', async () => {
    const store = useFileDownloadStore()

    await store.checkFileExists('https://example.com/old.pdf', 'old.pdf')

    const status = store.getFileStatus('https://example.com/old.pdf')
    expect(status.status).toBe('pending')
  })
})
