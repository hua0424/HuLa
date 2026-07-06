import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const sharedMocks = vi.hoisted(() => ({
  contentType: 1,
  updateMsg: vi.fn(),
  pushMsg: vi.fn(),
  sendWithTracking: vi.fn().mockResolvedValue(undefined),
  fileQueueItems: [] as { id: string }[]
}))

vi.mock('@/stores/user', () => ({
  useUserStore: () => ({
    userInfo: { uid: 'user-1' }
  })
}))

vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    getUserInfo: vi.fn().mockReturnValue({ name: 'me', avatar: '', locPlace: '' }),
    userList: []
  })
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    updateMsg: sharedMocks.updateMsg,
    pushMsg: sharedMocks.pushMsg,
    getMessage: vi.fn()
  })
}))

vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({
    currentSessionRoomId: 'room-1'
  })
}))

vi.mock('@/stores/setting', () => ({
  useSettingStore: () => ({
    chat: ref({ sendKey: 'Enter' })
  })
}))

vi.mock('@/hooks/useMessageSender', () => ({
  useMessageSender: () => ({
    sendWithTracking: sharedMocks.sendWithTracking
  })
}))

vi.mock('@/hooks/useCommon', () => ({
  useCommon: () => ({
    triggerInputEvent: vi.fn(),
    insertNode: vi.fn(),
    getMessageContentType: vi.fn().mockImplementation(() => sharedMocks.contentType),
    getEditorRange: vi.fn(),
    imgPaste: vi.fn(),
    reply: ref({ content: '', key: '' }),
    userUid: ref('user-1')
  })
}))

vi.mock('@/hooks/useUpload', () => ({
  UploadProviderEnum: { QINIU: 'qiniu', MINIO: 'minio' },
  useUpload: () => ({
    uploadFile: vi.fn().mockResolvedValue({
      uploadUrl: 'https://up.qiniu.com',
      downloadUrl: 'https://cdn.example.com/file.bin',
      config: { provider: 'qiniu' }
    }),
    doUpload: vi.fn().mockResolvedValue({ qiniuUrl: 'https://cdn.example.com/file.bin' })
  })
}))

vi.mock('@/utils/PlatformConstants', () => ({
  isMac: vi.fn().mockReturnValue(false),
  isMobile: vi.fn().mockReturnValue(false),
  isWindows: vi.fn().mockReturnValue(true)
}))

vi.mock('@/hooks/useFileUploadQueue', () => ({
  globalFileUploadQueue: {
    initQueue: vi.fn((files: any[]) => {
      sharedMocks.fileQueueItems.length = 0
      files.forEach((_, i) => sharedMocks.fileQueueItems.push({ id: `file-id-${i}` }))
    }),
    updateFileStatus: vi.fn(),
    queue: { items: sharedMocks.fileQueueItems }
  }
}))

vi.mock('@/hooks/useTrigger', () => ({
  useTrigger: () => ({
    checkAI: vi.fn().mockReturnValue(false),
    resetAllStates: vi.fn()
  })
}))

vi.mock('@/utils/ImageUtils', () => ({
  processClipboardImage: vi.fn()
}))

vi.mock('@/utils/MessageReply', () => ({
  getReplyContent: vi.fn().mockReturnValue('')
}))

vi.mock('@/utils/TauriInvokeHandler', () => ({
  invokeSilently: vi.fn()
}))

vi.mock('@/services/webSocketAdapter', () => ({
  default: { send: vi.fn() }
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, any>) => key + (params ? JSON.stringify(params) : '') })
}))

vi.mock('@/strategy/MessageStrategy', () => {
  const IMAGE = 3
  const FILE = 4
  const VOICE = 5
  const VIDEO = 6

  const makeFileStrategy = () => ({
    getMsg: vi.fn().mockResolvedValue({
      type: FILE,
      path: '/tmp/file.bin',
      url: '',
      fileName: 'file.bin',
      size: 1024,
      mime: 'application/octet-stream'
    }),
    buildMessageBody: vi.fn().mockReturnValue({
      url: '',
      size: 1024,
      fileName: 'file.bin',
      mime: 'application/octet-stream'
    }),
    buildMessageType: vi.fn().mockReturnValue({
      message: { id: 'temp', body: {}, status: 'pending' }
    }),
    uploadFile: vi.fn().mockResolvedValue({
      uploadUrl: 'https://up.qiniu.com',
      downloadUrl: 'https://cdn.example.com/file.bin',
      config: { provider: 'qiniu', objectKey: 'object-key-file' }
    }),
    doUpload: vi.fn().mockResolvedValue({ qiniuUrl: 'https://cdn.example.com/file.bin' })
  })

  const makeVideoStrategy = () => ({
    getMsg: vi.fn().mockResolvedValue({
      type: VIDEO,
      path: '/tmp/video.mp4',
      url: '',
      thumbnail: new File(['thumb'], 'thumb.jpg', { type: 'image/jpeg' }),
      size: 1024,
      mime: 'video/mp4',
      duration: 0
    }),
    buildMessageBody: vi.fn().mockReturnValue({
      url: '',
      path: '/tmp/video.mp4',
      thumbUrl: 'blob://local-thumb',
      thumbSize: 1024,
      thumbWidth: 300,
      thumbHeight: 150,
      size: 1024,
      mime: 'video/mp4',
      duration: 0
    }),
    buildMessageType: vi.fn().mockReturnValue({
      message: { id: 'temp', body: {}, status: 'pending' }
    }),
    uploadFile: vi.fn().mockResolvedValue({
      uploadUrl: 'https://up.qiniu.com',
      downloadUrl: 'https://cdn.example.com/video.mp4',
      config: { provider: 'qiniu', objectKey: 'object-key-video' }
    }),
    doUpload: vi.fn().mockResolvedValue({ qiniuUrl: 'https://cdn.example.com/video.mp4' }),
    uploadThumbnail: vi.fn().mockResolvedValue({
      uploadUrl: 'https://up-thumb.qiniu.com',
      downloadUrl: 'https://cdn.example.com/thumb.jpg',
      config: { provider: 'qiniu' }
    }),
    doUploadThumbnail: vi.fn().mockResolvedValue({ qiniuUrl: 'https://cdn.example.com/thumb.jpg' })
  })

  return {
    messageStrategyMap: {
      [IMAGE]: makeFileStrategy(),
      [FILE]: makeFileStrategy(),
      [VOICE]: makeFileStrategy(),
      [VIDEO]: makeVideoStrategy()
    }
  }
})

vi.mock('@/utils/FileType', () => ({
  isPathUploadFile: vi.fn().mockImplementation((file: any) => file?.kind === 'path'),
  isVideoUploadFile: vi
    .fn()
    .mockImplementation(
      (file: any) => file?.type?.startsWith('video/') || /\.(mp4|mov|avi|wmv|mkv|flv|webm|m4v)$/i.test(file?.name || '')
    )
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppCache: 2, AppData: 9 },
  readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]))
}))

import { useMsgInput } from '@/hooks/useMsgInput'
import { MsgEnum } from '@/enums'

const makeInputDom = () =>
  ref({
    innerHTML: '',
    textContent: '',
    childNodes: [],
    querySelector: vi.fn().mockReturnValue(null),
    querySelectorAll: vi.fn().mockReturnValue([]),
    focus: vi.fn()
  })

describe('BL-033 sendFilesDirect 视频自动识别', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    sharedMocks.updateMsg.mockClear()
    sharedMocks.pushMsg.mockClear()
    sharedMocks.sendWithTracking.mockClear()
    sharedMocks.contentType = MsgEnum.TEXT
  })

  it('mp4 文件走 MsgEnum.VIDEO 并写入 objectKey', async () => {
    const { sendFilesDirect } = useMsgInput(makeInputDom())

    await sendFilesDirect([new File(['video'], 'clip.mp4', { type: 'video/mp4' })])
    await new Promise((r) => setTimeout(r, 10))

    expect(sharedMocks.sendWithTracking).toHaveBeenCalledTimes(1)
    const payload = sharedMocks.sendWithTracking.mock.calls[0][0].payload
    expect(payload.msgType).toBe(MsgEnum.VIDEO)
    expect(payload.body.objectKey).toBe('object-key-video')
    expect(payload.body.path).toBeUndefined()
    expect(payload.body.thumbnail).toBeUndefined()
    expect(payload.body.mime).toBe('video/mp4')
    expect(payload.body.thumbUrl).toBe('https://cdn.example.com/thumb.jpg')
  })

  it('非视频文件仍走 MsgEnum.FILE', async () => {
    const { sendFilesDirect } = useMsgInput(makeInputDom())

    await sendFilesDirect([new File(['doc'], 'report.pdf', { type: 'application/pdf' })])
    await new Promise((r) => setTimeout(r, 10))

    expect(sharedMocks.sendWithTracking).toHaveBeenCalledTimes(1)
    const payload = sharedMocks.sendWithTracking.mock.calls[0][0].payload
    expect(payload.msgType).toBe(MsgEnum.FILE)
    expect(payload.body.objectKey).toBe('object-key-file')
  })

  it('路径视频文件读取后走 MsgEnum.VIDEO', async () => {
    const { sendFilesDirect } = useMsgInput(makeInputDom())

    await sendFilesDirect([
      {
        kind: 'path',
        path: 'C:\\videos\\clip.mov',
        name: 'clip.mov',
        size: 1024,
        type: 'video/quicktime'
      } as any
    ])
    await new Promise((r) => setTimeout(r, 10))

    expect(sharedMocks.sendWithTracking).toHaveBeenCalledTimes(1)
    const payload = sharedMocks.sendWithTracking.mock.calls[0][0].payload
    expect(payload.msgType).toBe(MsgEnum.VIDEO)
    expect(payload.body.objectKey).toBe('object-key-video')
  })

  it('视频严格校验失败时静默降级为 FILE', async () => {
    const { messageStrategyMap } = await import('@/strategy/MessageStrategy')
    vi.mocked(messageStrategyMap[MsgEnum.VIDEO].getMsg).mockRejectedValueOnce(
      new Error('仅支持 MP4/MOV/AVI/WMV 格式的视频')
    )

    const { sendFilesDirect } = useMsgInput(makeInputDom())

    await sendFilesDirect([new File(['video'], 'clip.webm', { type: 'video/webm' })])
    await new Promise((r) => setTimeout(r, 10))

    expect(sharedMocks.sendWithTracking).toHaveBeenCalledTimes(1)
    const payload = sharedMocks.sendWithTracking.mock.calls[0][0].payload
    expect(payload.msgType).toBe(MsgEnum.FILE)
  })

  it('缩略图上传失败时静默降级为 FILE', async () => {
    const { messageStrategyMap } = await import('@/strategy/MessageStrategy')
    const videoStrategy = messageStrategyMap[MsgEnum.VIDEO] as any
    vi.mocked(videoStrategy.uploadThumbnail).mockRejectedValueOnce(new Error('缩略图生成失败'))

    const { sendFilesDirect } = useMsgInput(makeInputDom())

    await sendFilesDirect([new File(['video'], 'clip.mp4', { type: 'video/mp4' })])
    await new Promise((r) => setTimeout(r, 10))

    expect(sharedMocks.sendWithTracking).toHaveBeenCalledTimes(1)
    const payload = sharedMocks.sendWithTracking.mock.calls[0][0].payload
    expect(payload.msgType).toBe(MsgEnum.FILE)
  })
})
