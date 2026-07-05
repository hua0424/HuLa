import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import Voice from '../Voice.vue'
import { ThemeEnum } from '@/enums'

const loadAudioWaveformMock = vi.fn().mockResolvedValue(new ArrayBuffer(8))
const getAudioUrlMock = vi.fn().mockResolvedValue('blob://audio')

vi.mock('@/hooks/useAudioFileManager', () => ({
  useAudioFileManager: () => ({
    loadAudioWaveform: loadAudioWaveformMock,
    getAudioUrl: getAudioUrlMock,
    cleanup: vi.fn()
  })
}))

vi.mock('@/hooks/useAudioPlayback', () => ({
  useAudioPlayback: () => ({
    isPlaying: ref(false),
    loading: ref(false),
    audioElement: ref(null),
    playbackProgress: ref(0),
    togglePlayback: vi.fn(),
    createAudioElement: vi.fn(),
    seekToTime: vi.fn(),
    cleanup: vi.fn()
  })
}))

vi.mock('@/hooks/useWaveformRenderer', () => ({
  useWaveformRenderer: () => ({
    waveformWidth: ref(100),
    scanLinePosition: ref(0),
    waveformCanvas: ref(null),
    drawWaveform: vi.fn(),
    drawWaveformThrottled: vi.fn(),
    drawWaveformImmediate: vi.fn(),
    generateWaveformData: vi.fn().mockResolvedValue(undefined),
    shouldUpdateCache: ref(false)
  })
}))

vi.mock('@/hooks/useVoiceDragControl', () => ({
  useVoiceDragControl: () => ({
    isDragging: ref(false),
    showTimePreview: ref(false),
    previewTime: ref(0),
    handleDragStart: vi.fn(),
    cleanup: vi.fn()
  })
}))

vi.mock('@/utils/fileSign', () => ({
  resolveSignedFileUrl: vi.fn().mockResolvedValue('https://signed.example.com/voice.mp3')
}))

import { resolveSignedFileUrl } from '@/utils/fileSign'

vi.mock('@/stores/setting', () => ({
  useSettingStore: () => ({
    themes: ref({ content: ThemeEnum.LIGHT })
  })
}))

vi.mock('@/stores/user', () => ({
  useUserStore: () => ({
    userInfo: { uid: 'user-1' }
  })
}))

vi.mock('pinia', async (importOriginal) => ({
  ...(await importOriginal<typeof import('pinia')>()),
  storeToRefs: (store: Record<string, unknown>) => store
}))

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': {} } })

describe('BL-003 Voice.vue objectKey-only receive', () => {
  beforeEach(() => {
    loadAudioWaveformMock.mockClear()
    getAudioUrlMock.mockClear()
    vi.mocked(resolveSignedFileUrl).mockClear()
  })

  const mountVoice = (body: any, msgId?: string) =>
    mount(Voice, {
      props: {
        body,
        fromUserUid: 'user-2',
        msgId
      },
      global: {
        plugins: [i18n]
      }
    })

  it('url 为空但有 objectKey + msgId 时，用签名 URL 加载波形与音频', async () => {
    mountVoice(
      {
        url: '',
        objectKey: 'object-key-1',
        second: 5
      },
      'msg-123'
    )
    await flushPromises()

    expect(loadAudioWaveformMock).toHaveBeenCalledWith('https://signed.example.com/voice.mp3')
    expect(getAudioUrlMock).toHaveBeenCalledWith('https://signed.example.com/voice.mp3')
  })

  it('旧消息（带 http url）直接使用原 url，不触发换签', async () => {
    const { resolveSignedFileUrl } = await import('@/utils/fileSign')
    mountVoice(
      {
        url: 'https://example.com/voice.mp3',
        second: 5
      },
      'msg-123'
    )
    await flushPromises()

    expect(resolveSignedFileUrl).not.toHaveBeenCalled()
    expect(loadAudioWaveformMock).toHaveBeenCalledWith('https://example.com/voice.mp3')
  })
})
