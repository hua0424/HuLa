import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import Video from '../Video.vue'
import { MessageStatusEnum, MsgEnum } from '@/enums'

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': {} } })

const downloadFileMock = vi.fn().mockResolvedValue(undefined)
const isDownloadingMock = ref(false)
const processMock = ref(0)

vi.mock('@/hooks/useDownload', () => ({
  useDownload: () => ({
    downloadFile: downloadFileMock,
    isDownloading: isDownloadingMock,
    process: processMock
  })
}))

const openVideoViewerMock = vi.fn()
const getLocalVideoPathMock = vi.fn().mockResolvedValue('videos/clip.mp4')
const checkVideoDownloadedMock = vi.fn().mockResolvedValue(false)

vi.mock('@/hooks/useVideoViewer', () => ({
  useVideoViewer: () => ({
    openVideoViewer: openVideoViewerMock,
    getLocalVideoPath: getLocalVideoPathMock,
    checkVideoDownloaded: checkVideoDownloadedMock
  })
}))

vi.mock('@/stores/videoViewer', () => ({
  useVideoViewer: () => ({
    updateVideoPath: vi.fn()
  })
}))

const enqueueThumbnailMock = vi.fn().mockResolvedValue(undefined)
const invalidateMock = vi.fn()

vi.mock('@/stores/thumbnailCache', () => ({
  useThumbnailCacheStore: () => ({
    enqueueThumbnail: enqueueThumbnailMock,
    invalidate: invalidateMock
  })
}))

vi.mock('@/utils/fileSign', () => ({
  resolveSignedFileUrl: vi.fn().mockResolvedValue('https://signed.example.com/video.mp4')
}))

import { isMobile } from '@/utils/PlatformConstants'

vi.mock('@/utils/PlatformConstants', () => ({
  isMobile: vi.fn().mockReturnValue(false)
}))

vi.mock('vue', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('vue')
  return {
    ...actual,
    defineAsyncComponent: () =>
      actual.defineComponent({
        name: 'VideoPreview',
        template: '<div data-testid="video-preview">preview</div>'
      })
  }
})

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn().mockImplementation((path: string) => `convert://${path}`)
}))

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/app'),
  join: vi.fn().mockImplementation((...parts: string[]) => parts.join('/')),
  resourceDir: vi.fn().mockResolvedValue('/res')
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData', Resource: 'Resource' },
  exists: vi.fn().mockResolvedValue(false)
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    getMessage: vi.fn(),
    updateMsg: vi.fn()
  })
}))

vi.mock('@/utils/TauriInvokeHandler', () => ({
  invokeSilently: vi.fn()
}))

vi.mock('@/hooks/useIntersectionTaskQueue', () => ({
  useIntersectionTaskQueue: () => ({
    observe: vi.fn(),
    disconnect: vi.fn()
  })
}))

vi.mock('@/hooks/useMitt', () => ({
  useMitt: {
    on: vi.fn(),
    off: vi.fn()
  }
}))

describe('BL-003 Video.vue objectKey-only receive', () => {
  beforeEach(() => {
    downloadFileMock.mockClear()
    openVideoViewerMock.mockClear()
    enqueueThumbnailMock.mockClear()
    checkVideoDownloadedMock.mockResolvedValue(false)
  })

  const mountVideo = (body: any) =>
    mount(Video, {
      props: {
        body,
        message: { id: 'msg-123', roomId: 'room-1', type: MsgEnum.VIDEO } as any,
        messageStatus: MessageStatusEnum.SUCCESS
      },
      global: {
        plugins: [i18n],
        stubs: {
          'n-image': {
            template: '<img :src="$attrs.src" data-testid="video-thumb" />'
          },
          'n-flex': {
            template: '<div><slot /></div>'
          },
          transition: {
            template: '<div><slot /></div>'
          }
        }
      }
    })

  it('url 为空但有 objectKey 时，点击播放会发起下载并传入 msgId/objectKey', async () => {
    checkVideoDownloadedMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const wrapper = mountVideo({
      url: '',
      objectKey: 'object-key-1',
      filename: 'clip.mp4',
      size: 1024,
      thumbWidth: 300,
      thumbHeight: 150
    })
    await flushPromises()

    await wrapper.find('.play-button').trigger('click')
    await flushPromises()

    // 首次检查下载状态时应使用 objectKey 作为 workKey
    expect(checkVideoDownloadedMock).toHaveBeenCalledWith('object-key-1', 'clip.mp4')
    expect(downloadFileMock).toHaveBeenCalledWith(
      'object-key-1',
      'videos/clip.mp4',
      expect.anything(),
      'msg-123',
      'object-key-1'
    )
  })

  it('移动端 objectKey-only 视频解析播放地址时使用 objectKey 作为 key', async () => {
    vi.mocked(isMobile).mockReturnValue(true)
    checkVideoDownloadedMock.mockResolvedValue(true)
    const wrapper = mountVideo({
      url: '',
      objectKey: 'object-key-1',
      filename: 'clip.mp4',
      size: 1024,
      thumbWidth: 300,
      thumbHeight: 150
    })
    await flushPromises()

    await wrapper.find('.play-button').trigger('click')
    await flushPromises()

    expect(checkVideoDownloadedMock).toHaveBeenCalledWith('object-key-1', 'clip.mp4')
    expect(getLocalVideoPathMock).toHaveBeenCalledWith('object-key-1', 'clip.mp4')
  })

  it('旧消息（带 http url）按 url 路径下载，objectKey 为空', async () => {
    checkVideoDownloadedMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const wrapper = mountVideo({
      url: 'https://example.com/clip.mp4',
      filename: 'clip.mp4',
      size: 1024,
      thumbWidth: 300,
      thumbHeight: 150
    })
    await flushPromises()

    await wrapper.find('.play-button').trigger('click')
    await flushPromises()

    expect(downloadFileMock).toHaveBeenCalledWith(
      'https://example.com/clip.mp4',
      expect.any(String),
      expect.anything(),
      'msg-123',
      undefined
    )
  })
})
