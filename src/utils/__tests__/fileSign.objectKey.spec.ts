import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveSignedFileUrl, signFileDownloadUrl } from '@/utils/fileSign'
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

describe('BL-003 resolveSignedFileUrl with objectKey', () => {
  beforeEach(() => {
    vi.mocked(imRequest).mockReset()
  })

  it('url 为空但有 msgId + objectKey 时，触发换签并返回签名 URL', async () => {
    vi.mocked(imRequest).mockResolvedValueOnce({ url: 'https://signed.example.com/file' })

    const result = await resolveSignedFileUrl('', 'msg-123', 'object-key-1')

    expect(result).toBe('https://signed.example.com/file')
    expect(imRequest).toHaveBeenCalledTimes(1)
  })

  it('url 为空且无 objectKey 时，即使 msgId 存在也不换签，返回原 url', async () => {
    const result = await resolveSignedFileUrl('', 'msg-123')

    expect(result).toBe('')
    expect(imRequest).not.toHaveBeenCalled()
  })

  it('本地 URL 但有 objectKey + msgId 时，换签后返回签名 URL', async () => {
    vi.mocked(imRequest).mockResolvedValueOnce({ url: 'https://signed.example.com/file' })

    const result = await resolveSignedFileUrl('file:///C:/tmp/file.txt', 'msg-123', 'object-key-1')

    expect(result).toBe('https://signed.example.com/file')
    expect(imRequest).toHaveBeenCalledTimes(1)
  })

  it('http(s) URL + msgId 仍按旧逻辑换签', async () => {
    vi.mocked(imRequest).mockResolvedValueOnce({ url: 'https://signed.example.com/file' })

    const result = await resolveSignedFileUrl('https://example.com/file.txt', 'msg-123')

    expect(result).toBe('https://signed.example.com/file')
    expect(imRequest).toHaveBeenCalledTimes(1)
  })

  it('换签失败时 fallback 到原 url（即使 url 为空）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(imRequest).mockRejectedValueOnce(new Error('server error'))

    const result = await resolveSignedFileUrl('', 'msg-123', 'object-key-1')

    expect(result).toBe('')
    warnSpy.mockRestore()
  })
})

describe('BL-003 signFileDownloadUrl', () => {
  beforeEach(() => {
    vi.mocked(imRequest).mockReset()
  })

  it('正常返回签名 URL', async () => {
    vi.mocked(imRequest).mockResolvedValueOnce({ url: 'https://signed.example.com/file' })

    const result = await signFileDownloadUrl('msg-123')

    expect(result).toBe('https://signed.example.com/file')
  })

  it('失败时返回 null', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(imRequest).mockRejectedValueOnce(new Error('network'))

    const result = await signFileDownloadUrl('msg-123')

    expect(result).toBeNull()
    warnSpy.mockRestore()
  })
})
