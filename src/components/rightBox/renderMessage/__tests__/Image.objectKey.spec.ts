import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Image from '../Image.vue'
import { MsgEnum } from '@/enums'

const enqueueThumbnailMock = vi.fn().mockResolvedValue('/thumbs/abc.jpg')
const invalidateMock = vi.fn()
const getStatusMock = vi.fn()

vi.mock('@/stores/thumbnailCache', () => ({
  useThumbnailCacheStore: () => ({
    enqueueThumbnail: enqueueThumbnailMock,
    invalidate: invalidateMock,
    getStatus: getStatusMock
  })
}))

vi.mock('@/utils/fileSign', () => ({
  resolveSignedFileUrl: vi.fn().mockResolvedValue('https://signed.example.com/image.jpg')
}))

vi.mock('@/utils/QiniuImageUtils', () => ({
  buildQiniuThumbnailUrl: vi.fn().mockImplementation((url: string) => url),
  getPreferredQiniuFormat: vi.fn().mockReturnValue('webp')
}))

vi.mock('@/hooks/useImageViewer', () => ({
  useImageViewer: () => ({
    openImageViewer: vi.fn()
  })
}))

vi.mock('@/utils/PlatformConstants', () => ({
  isMobile: vi.fn().mockReturnValue(false)
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn().mockImplementation((path: string) => `convert://${path}`)
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(false)
}))

describe('BL-003 Image.vue objectKey-only receive', () => {
  beforeEach(() => {
    enqueueThumbnailMock.mockClear()
    invalidateMock.mockClear()
    getStatusMock.mockClear()
  })

  const mountImage = (body: any) =>
    mount(Image, {
      props: {
        body,
        message: { id: 'msg-123', roomId: 'room-1', type: MsgEnum.IMAGE } as any,
        onImageClick: vi.fn()
      },
      global: {
        stubs: {
          'n-image': {
            template: '<img :src="$attrs.src" data-testid="image-content" />'
          },
          'n-flex': {
            template: '<div><slot /></div>'
          }
        }
      }
    })

  it('url 为空但有 objectKey 时仍渲染图片占位并触发缩略图下载', async () => {
    mountImage({
      url: '',
      objectKey: 'object-key-1',
      width: 100,
      height: 100
    })
    await flushPromises()

    expect(enqueueThumbnailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '',
        objectKey: 'object-key-1',
        msgId: 'msg-123',
        kind: 'image'
      })
    )
  })

  it('旧消息（带 http url）直接以 url 作为缩略图源，不依赖 objectKey', async () => {
    mountImage({
      url: 'https://example.com/old.jpg',
      width: 100,
      height: 100
    })
    await flushPromises()

    expect(enqueueThumbnailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/old.jpg',
        objectKey: undefined,
        msgId: 'msg-123',
        kind: 'image'
      })
    )
  })
})
