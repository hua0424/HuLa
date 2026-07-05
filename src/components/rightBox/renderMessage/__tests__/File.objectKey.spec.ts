import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import File from '../File.vue'
import { MessageStatusEnum } from '@/enums'

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn().mockImplementation((...parts: string[]) => parts.join('/'))
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: vi.fn(),
  revealItemInDir: vi.fn()
}))

const downloadFileMock = vi.fn().mockResolvedValue('/res/room-files/report.pdf')
const getFileStatusMock = vi.fn().mockReturnValue({ isDownloaded: false, status: 'pending' })
const checkFileExistsMock = vi.fn().mockResolvedValue(false)
const refreshFileDownloadStatusMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/stores/fileDownload', () => ({
  useFileDownloadStore: () => ({
    getFileStatus: getFileStatusMock,
    checkFileExists: checkFileExistsMock,
    downloadFile: downloadFileMock,
    refreshFileDownloadStatus: refreshFileDownloadStatusMock
  })
}))

vi.mock('@/stores/user', () => ({
  useUserStore: () => ({
    userInfo: { uid: 'user-1' },
    getUserRoomAbsoluteDir: vi.fn().mockResolvedValue('/res/room-files')
  })
}))

vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({
    currentSessionRoomId: 'room-1'
  })
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    getMessage: vi.fn(),
    updateMsg: vi.fn()
  })
}))

vi.mock('@/hooks/useDownload', () => ({
  useDownload: () => ({
    isDownloading: ref(false)
  })
}))

vi.mock('@/utils/PathUtil', () => ({
  getFilesMeta: vi.fn().mockResolvedValue([{ exists: false }])
}))

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': {} } })

describe('BL-003 File.vue objectKey-only receive', () => {
  beforeEach(() => {
    downloadFileMock.mockClear()
    getFileStatusMock.mockClear()
    checkFileExistsMock.mockClear()
    refreshFileDownloadStatusMock.mockClear()
    getFileStatusMock.mockReturnValue({ isDownloaded: false, status: 'pending' })
  })

  const mountFile = (body: any) =>
    mount(File, {
      props: {
        body,
        message: { id: 'msg-123', roomId: 'room-1' } as any,
        msgId: 'msg-123',
        messageStatus: MessageStatusEnum.SUCCESS
      },
      global: {
        plugins: [i18n]
      }
    })

  it('url 为空但有 objectKey 时仍渲染文件信息并显示下载入口', async () => {
    const wrapper = mountFile({
      fileName: 'report.pdf',
      size: 1024,
      url: '',
      objectKey: 'object-key-1'
    })
    await flushPromises()

    expect(wrapper.text()).toContain('report.pdf')
    expect(wrapper.find('.download-icon').exists()).toBe(true)
  })

  it('点击下载图标时，downloadFile 收到 objectKey 与 msgId', async () => {
    const wrapper = mountFile({
      fileName: 'report.pdf',
      size: 1024,
      url: '',
      objectKey: 'object-key-1'
    })
    await flushPromises()

    await wrapper.find('.file-icon-wrapper').trigger('click')
    await flushPromises()

    expect(downloadFileMock).toHaveBeenCalledWith('', 'report.pdf', 'msg-123', 'object-key-1')
  })

  it('旧消息（带 http url）不会显示下载入口（已下载）', async () => {
    getFileStatusMock.mockReturnValue({ isDownloaded: true, status: 'completed', absolutePath: '/tmp/old.pdf' })
    const wrapper = mountFile({
      fileName: 'old.pdf',
      size: 2048,
      url: 'https://example.com/old.pdf'
    })
    await flushPromises()

    expect(wrapper.find('.download-icon').exists()).toBe(false)
  })
})
