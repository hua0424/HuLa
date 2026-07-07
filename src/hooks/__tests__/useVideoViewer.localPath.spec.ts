import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sharedMocks = vi.hoisted(() => ({
  messageBody: {
    url: 'http://example.com/video.mp4',
    localPath: '/abs/path/video.mp4'
  } as Record<string, any>,
  tauriPath: {
    appDataDir: vi.fn().mockResolvedValue('/app/data'),
    resourceDir: vi.fn().mockResolvedValue('/resource'),
    isAbsolute: vi.fn().mockImplementation(async (path: string) => {
      return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
    }),
    join: vi.fn().mockImplementation((...segments: string[]) => segments.join('/'))
  }
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    currentMessageMap: {
      'msg-123': {
        message: {
          id: 'msg-123',
          roomId: 'room-1',
          type: 6, // VIDEO
          body: sharedMocks.messageBody
        }
      }
    }
  })
}))

vi.mock('@/stores/user', () => ({
  useUserStore: () => ({
    getUserRoomDir: vi.fn().mockResolvedValue('/user/room')
  })
}))

vi.mock('@/stores/videoViewer', () => ({
  useVideoViewer: () => ({
    resetVideoListOptimized: vi.fn(),
    $patch: vi.fn()
  })
}))

vi.mock('@/hooks/useWindow', () => ({
  useWindow: () => ({
    createWebviewWindow: vi.fn()
  })
}))

vi.mock('@/utils/fileSign', () => ({
  resolveSignedFileUrl: vi.fn().mockResolvedValue('https://signed.example.com/video.mp4')
}))

vi.mock('@/utils/PlatformConstants', () => ({
  isMobile: vi.fn().mockReturnValue(false)
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: {
    getByLabel: vi.fn().mockResolvedValue(null)
  }
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 9, Resource: 1 },
  exists: vi.fn().mockResolvedValue(false)
}))

vi.mock('@tauri-apps/api/path', () => sharedMocks.tauriPath)

import { useVideoViewer } from '@/hooks/useVideoViewer'

describe('useVideoViewer resolveDisplayPath 本地路径处理', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    sharedMocks.messageBody = {
      url: 'http://example.com/video.mp4',
      localPath: '/abs/path/video.mp4'
    }
    sharedMocks.tauriPath.appDataDir.mockClear()
    sharedMocks.tauriPath.resourceDir.mockClear()
    sharedMocks.tauriPath.isAbsolute.mockClear()
    sharedMocks.tauriPath.join.mockClear()
  })

  it('body.localPath 为绝对路径时直接返回，不再拼接 baseDirPath', async () => {
    const { resolveDisplayPath } = useVideoViewer()

    const path = await resolveDisplayPath('http://example.com/video.mp4')

    expect(path).toBe('/abs/path/video.mp4')
    expect(sharedMocks.tauriPath.isAbsolute).toHaveBeenCalledWith('/abs/path/video.mp4')
    expect(sharedMocks.tauriPath.resourceDir).not.toHaveBeenCalled()
    expect(sharedMocks.tauriPath.appDataDir).not.toHaveBeenCalled()
    expect(sharedMocks.tauriPath.join).not.toHaveBeenCalled()
  })

  it('body.localPath 为相对路径时，拼接 resourceDir', async () => {
    sharedMocks.messageBody = {
      url: 'http://example.com/video.mp4',
      localPath: 'videos/clip.mp4'
    }

    const { resolveDisplayPath } = useVideoViewer()

    const path = await resolveDisplayPath('http://example.com/video.mp4')

    expect(sharedMocks.tauriPath.isAbsolute).toHaveBeenCalledWith('videos/clip.mp4')
    expect(sharedMocks.tauriPath.resourceDir).toHaveBeenCalledTimes(1)
    expect(sharedMocks.tauriPath.join).toHaveBeenCalledWith('/resource', 'videos/clip.mp4')
    expect(path).toBe('/resource/videos/clip.mp4')
  })

  it('body.localPath 为 Windows 绝对路径时直接返回', async () => {
    sharedMocks.messageBody = {
      url: 'http://example.com/video.mp4',
      localPath: 'C:\\Users\\hula\\videos\\clip.mp4'
    }

    const { resolveDisplayPath } = useVideoViewer()

    const path = await resolveDisplayPath('http://example.com/video.mp4')

    expect(path).toBe('C:\\Users\\hula\\videos\\clip.mp4')
    expect(sharedMocks.tauriPath.resourceDir).not.toHaveBeenCalled()
    expect(sharedMocks.tauriPath.join).not.toHaveBeenCalled()
  })

  it('body.localPath 为空时走换签/远程路径逻辑', async () => {
    sharedMocks.messageBody = {
      url: '',
      objectKey: 'chat/video.mp4',
      localPath: ''
    }

    const { resolveDisplayPath } = useVideoViewer()

    const path = await resolveDisplayPath('chat/video.mp4')

    expect(path).toBe('https://signed.example.com/video.mp4')
  })
})
