import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ImUrlEnum } from '@/enums'
import { signFileDownloadUrl, resolveSignedFileUrl } from '@/utils/fileSign'
import { imRequest } from '@/utils/ImRequestUtils'

vi.mock('@/stores/chat', () => ({
  useChatStore: vi.fn()
}))

vi.mock('@/stores/group', () => ({
  useGroupStore: vi.fn()
}))

vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: vi.fn()
}))

describe('BL-003 sign-on-access helpers', () => {
  beforeEach(() => {
    vi.mocked(imRequest).mockReset()
  })

  describe('signFileDownloadUrl', () => {
    it('正常换签时返回服务端提供的 url', async () => {
      vi.mocked(imRequest).mockResolvedValueOnce({ url: 'https://signed.example.com/file' })

      const result = await signFileDownloadUrl('123')

      expect(result).toBe('https://signed.example.com/file')
      expect(imRequest).toHaveBeenCalledTimes(1)
      expect(imRequest).toHaveBeenCalledWith({
        url: ImUrlEnum.FILE_SIGN_DOWNLOAD,
        body: { msgId: '123' }
      })
    })

    it('响应缺少 url 时返回 null', async () => {
      vi.mocked(imRequest).mockResolvedValueOnce({})

      const result = await signFileDownloadUrl('123')

      expect(result).toBeNull()
    })

    it('imRequest 抛异常时返回 null 并兜底', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.mocked(imRequest).mockRejectedValueOnce(new Error('network error'))

      const result = await signFileDownloadUrl('123')

      expect(result).toBeNull()
      warnSpy.mockRestore()
    })
  })

  describe('resolveSignedFileUrl', () => {
    it('有 msgId 且原 URL 为 http(s) 时，返回签名后的 URL', async () => {
      vi.mocked(imRequest).mockResolvedValueOnce({ url: 'https://signed.example.com/file' })

      const result = await resolveSignedFileUrl('https://example.com/file.txt', '123')

      expect(result).toBe('https://signed.example.com/file')
      expect(imRequest).toHaveBeenCalledWith({
        url: ImUrlEnum.FILE_SIGN_DOWNLOAD,
        body: { msgId: '123' }
      })
    })

    it('无 msgId 时直接返回原 URL，不调用换签', async () => {
      const result = await resolveSignedFileUrl('https://example.com/file.txt')

      expect(result).toBe('https://example.com/file.txt')
      expect(imRequest).not.toHaveBeenCalled()
    })

    it('本地/相对 URL 不触发换签，直接返回原 URL', async () => {
      const fileUrl = 'file:///C:/Users/test/file.txt'

      const result = await resolveSignedFileUrl(fileUrl, '123')

      expect(result).toBe(fileUrl)
      expect(imRequest).not.toHaveBeenCalled()
    })

    it('换签失败（如服务端 404）时返回原 URL 兜底', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.mocked(imRequest).mockRejectedValueOnce(new Error('network_error: error decoding response body'))

      const originalUrl = 'https://example.com/file.txt'
      const result = await resolveSignedFileUrl(originalUrl, '123')

      expect(result).toBe(originalUrl)
      expect(imRequest).toHaveBeenCalledTimes(1)
      warnSpy.mockRestore()
    })
  })
})
