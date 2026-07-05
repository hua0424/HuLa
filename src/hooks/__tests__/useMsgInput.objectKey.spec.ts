import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

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

const updateMsgMock = vi.fn()
const pushMsgMock = vi.fn()

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    updateMsg: updateMsgMock,
    pushMsg: pushMsgMock
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

const sendWithTrackingMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/hooks/useMessageSender', () => ({
  useMessageSender: () => ({
    sendWithTracking: sendWithTrackingMock
  })
}))

vi.mock('@/hooks/useCommon', () => ({
  useCommon: () => ({
    triggerInputEvent: vi.fn(),
    insertNode: vi.fn(),
    getMessageContentType: vi.fn(),
    getEditorRange: vi.fn(),
    imgPaste: vi.fn(),
    reply: ref({ content: '', key: '' }),
    userUid: ref('user-1')
  })
}))

vi.mock('@/hooks/useUpload', () => ({
  UploadProviderEnum: { QINIU: 'qiniu' },
  useUpload: () => ({
    uploadFile: vi.fn().mockResolvedValue({
      uploadUrl: 'https://up.qiniu.com',
      downloadUrl: 'https://cdn.example.com/voice.mp3',
      config: { provider: 'qiniu', objectKey: 'object-key-1' }
    }),
    doUpload: vi.fn().mockResolvedValue({ qiniuUrl: 'https://cdn.example.com/voice.mp3' })
  })
}))

vi.mock('@/strategy/MessageStrategy', () => ({
  messageStrategyMap: {
    5: {
      uploadFile: vi.fn().mockResolvedValue({
        uploadUrl: 'https://up.qiniu.com',
        downloadUrl: 'https://cdn.example.com/voice.mp3',
        config: { provider: 'qiniu', objectKey: 'object-key-1' }
      }),
      doUpload: vi.fn().mockResolvedValue({ qiniuUrl: 'https://cdn.example.com/voice.mp3' })
    }
  }
}))

vi.mock('@/utils/PlatformConstants', () => ({
  isMac: vi.fn().mockReturnValue(false),
  isMobile: vi.fn().mockReturnValue(false),
  isWindows: vi.fn().mockReturnValue(true)
}))

vi.mock('@/hooks/useFileUploadQueue', () => ({
  globalFileUploadQueue: {
    add: vi.fn(),
    updateFileStatus: vi.fn()
  }
}))

vi.mock('@/hooks/useTrigger', () => ({
  useTrigger: () => ({
    checkAI: vi.fn().mockReturnValue(false)
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

describe('BL-003 useMsgInput send objectKey', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    updateMsgMock.mockClear()
    pushMsgMock.mockClear()
    sendWithTrackingMock.mockClear()
  })

  it('sendVoiceDirect 上传后将 MINIO 返回的 objectKey 写入消息体', async () => {
    const { sendVoiceDirect } = useMsgInput(ref(null))

    await sendVoiceDirect({
      localPath: '/tmp/voice.mp3',
      size: 1024,
      duration: 5,
      filename: 'voice.mp3'
    })
    await new Promise((r) => setTimeout(r, 10))

    expect(sendWithTrackingMock).toHaveBeenCalledTimes(1)
    const payload = sendWithTrackingMock.mock.calls[0][0].payload
    expect(payload.body).toMatchObject({
      url: 'https://cdn.example.com/voice.mp3',
      objectKey: 'object-key-1',
      size: 1024,
      second: 5
    })
    expect(payload.body.path).toBeUndefined()
  })
})
