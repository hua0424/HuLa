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
      config: { provider: 'qiniu', objectKey: 'object-key-upload' }
    }),
    doUpload: vi.fn().mockResolvedValue({ qiniuUrl: 'https://cdn.example.com/file.bin' })
  })
}))

vi.mock('@/utils/FileType', () => ({
  isPathUploadFile: vi.fn().mockReturnValue(false)
}))

vi.mock('@/strategy/MessageStrategy', () => {
  const IMAGE = 3
  const FILE = 4
  const VOICE = 5
  const VIDEO = 6

  const makeStrategy = (type: number) => ({
    getMsg: vi.fn().mockReturnValue({
      type,
      path: `/tmp/${type}.bin`,
      url: 'https://cdn.example.com/local.bin',
      thumbnail: { size: 1234 }
    }),
    buildMessageBody: vi.fn().mockReturnValue({
      url: '',
      size: 1024,
      fileName: 'file.bin',
      mime: 'application/octet-stream',
      width: 1,
      height: 1
    }),
    buildMessageType: vi.fn().mockReturnValue({
      message: { id: 'temp', body: {}, status: 'pending' }
    }),
    uploadFile: vi.fn().mockResolvedValue({
      uploadUrl: 'https://up.qiniu.com',
      downloadUrl: 'https://cdn.example.com/file.bin',
      config: { provider: 'qiniu', objectKey: `object-key-${type}` }
    }),
    doUpload: vi.fn().mockResolvedValue({ qiniuUrl: 'https://cdn.example.com/file.bin' }),
    uploadThumbnail: vi.fn().mockResolvedValue({
      uploadUrl: 'https://up-thumb.qiniu.com',
      downloadUrl: 'https://cdn.example.com/thumb.bin',
      config: { provider: 'qiniu' }
    }),
    doUploadThumbnail: vi.fn().mockResolvedValue({ qiniuUrl: 'https://cdn.example.com/thumb.bin' })
  })

  return {
    messageStrategyMap: {
      [IMAGE]: makeStrategy(IMAGE),
      [FILE]: makeStrategy(FILE),
      [VOICE]: {
        getMsg: vi.fn().mockReturnValue({
          type: VOICE,
          path: '/tmp/voice.mp3',
          url: 'asset:///tmp/voice.mp3',
          size: 1024,
          duration: 5,
          filename: 'voice.mp3'
        }),
        buildMessageBody: vi.fn().mockReturnValue({ url: 'asset:///tmp/voice.mp3', size: 1024, second: 5 }),
        buildMessageType: vi.fn().mockReturnValue({
          message: { id: 'temp', body: {}, status: 'pending' }
        }),
        uploadFile: vi.fn().mockResolvedValue({
          uploadUrl: 'https://up.qiniu.com',
          downloadUrl: 'https://cdn.example.com/voice.mp3',
          config: { provider: 'qiniu', objectKey: 'object-key-5' }
        }),
        doUpload: vi.fn().mockResolvedValue({ qiniuUrl: 'https://cdn.example.com/voice.mp3' })
      },
      [VIDEO]: makeStrategy(VIDEO)
    }
  }
})

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

describe('BL-003 useMsgInput send objectKey', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    sharedMocks.updateMsg.mockClear()
    sharedMocks.pushMsg.mockClear()
    sharedMocks.sendWithTracking.mockClear()
    sharedMocks.contentType = MsgEnum.TEXT
  })

  it('IMAGE 发送时把 MINIO 返回的 objectKey 写入消息体', async () => {
    sharedMocks.contentType = MsgEnum.IMAGE
    const { send } = useMsgInput(makeInputDom())

    await send()
    await new Promise((r) => setTimeout(r, 10))

    expect(sharedMocks.sendWithTracking).toHaveBeenCalledTimes(1)
    const payload = sharedMocks.sendWithTracking.mock.calls[0][0].payload
    expect(payload.msgType).toBe(MsgEnum.IMAGE)
    expect(payload.body.objectKey).toBe(`object-key-${MsgEnum.IMAGE}`)
    expect(payload.body.path).toBeUndefined()
  })

  it('VIDEO 发送时把 MINIO 返回的 objectKey 写入消息体', async () => {
    sharedMocks.contentType = MsgEnum.VIDEO
    const { send } = useMsgInput(makeInputDom())

    await send()
    await new Promise((r) => setTimeout(r, 10))

    expect(sharedMocks.sendWithTracking).toHaveBeenCalledTimes(1)
    const payload = sharedMocks.sendWithTracking.mock.calls[0][0].payload
    expect(payload.msgType).toBe(MsgEnum.VIDEO)
    expect(payload.body.objectKey).toBe(`object-key-${MsgEnum.VIDEO}`)
    expect(payload.body.path).toBeUndefined()
  })

  it('FILE 发送时把 MINIO 返回的 objectKey 写入消息体', async () => {
    const { sendFilesDirect } = useMsgInput(makeInputDom())

    await sendFilesDirect([{ name: 'report.pdf', size: 1024, type: 'application/pdf' } as any])
    await new Promise((r) => setTimeout(r, 10))

    expect(sharedMocks.sendWithTracking).toHaveBeenCalledTimes(1)
    const payload = sharedMocks.sendWithTracking.mock.calls[0][0].payload
    expect(payload.msgType).toBe(MsgEnum.FILE)
    expect(payload.body.objectKey).toBe(`object-key-${MsgEnum.FILE}`)
    expect(payload.body.path).toBeUndefined()
  })

  it('sendVoiceDirect 上传后将 MINIO 返回的 objectKey 写入消息体', async () => {
    const { sendVoiceDirect } = useMsgInput(makeInputDom())

    await sendVoiceDirect({
      localPath: '/tmp/voice.mp3',
      size: 1024,
      duration: 5,
      filename: 'voice.mp3'
    })
    await new Promise((r) => setTimeout(r, 10))

    expect(sharedMocks.sendWithTracking).toHaveBeenCalledTimes(1)
    const payload = sharedMocks.sendWithTracking.mock.calls[0][0].payload
    expect(payload.body).toMatchObject({
      url: 'https://cdn.example.com/voice.mp3',
      objectKey: 'object-key-5',
      size: 1024,
      second: 5
    })
    expect(payload.body.path).toBeUndefined()
  })
})
