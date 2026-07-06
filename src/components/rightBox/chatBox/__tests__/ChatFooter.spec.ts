import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'

/**
 * #155 桌面端 ChatFooter 上传按钮 testid 补齐：
 *   - 文件按钮 data-testid="chat-footer-file"
 *   - 图片按钮 data-testid="chat-footer-image"
 *   - 语音按钮 data-testid="chat-footer-voice"
 */

vi.mock('@/utils/PlatformConstants', () => ({
  isMobile: () => false,
  isMac: () => false,
  isWeb: () => false
}))

vi.mock('@/router', () => ({
  default: { push: vi.fn(), currentRoute: { value: { name: '/message' } } }
}))

vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getCurrent: () => ({ listen: vi.fn().mockResolvedValue(() => {}) }) }
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn() }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows', version: () => '10.0' }))

vi.mock('@/hooks/useCommon.ts', () => ({
  useCommon: () => ({
    handlePaste: vi.fn().mockResolvedValue(undefined),
    processFiles: vi.fn().mockResolvedValue(undefined),
    insertNodeAtRange: vi.fn(),
    triggerInputEvent: vi.fn(),
    imgPaste: vi.fn()
  })
}))

vi.mock('@/hooks/useMsgInput.ts', () => ({
  useMsgInput: () => ({
    inputKeyDown: vi.fn(),
    handleAit: vi.fn(),
    handleAI: vi.fn(),
    handleInput: vi.fn(),
    msgInput: ref(''),
    send: vi.fn().mockResolvedValue(undefined),
    sendLocationDirect: vi.fn(),
    sendFilesDirect: vi.fn(),
    sendVoiceDirect: vi.fn(),
    sendEmojiDirect: vi.fn(),
    personList: ref([]),
    disabledSend: ref(false),
    ait: ref(false),
    aiDialogVisible: ref(false),
    selectedAIKey: ref(''),
    chatKey: ref('Enter'),
    menuList: ref([]),
    selectedAitKey: ref(-1),
    groupedAIModels: ref([]),
    updateSelectionRange: vi.fn(),
    focusOn: vi.fn(),
    getCursorSelectionRange: vi.fn()
  })
}))

vi.mock('@/hooks/useAiclawSession', () => ({
  useAiclawSession: () => ({
    allowedUploadTypes: ref(null)
  })
}))

vi.mock('@/hooks/useMitt.ts', () => ({
  useMitt: { on: vi.fn(), off: vi.fn(), emit: vi.fn() }
}))
vi.mock('@/hooks/useGlobalShortcut.ts', () => ({
  useGlobalShortcut: () => ({ handleScreenshot: vi.fn() })
}))
vi.mock('@/hooks/useChatLayout.ts', () => ({
  useChatLayoutGlobal: () => ({
    footerHeight: ref(100),
    setFooterHeight: vi.fn()
  })
}))
vi.mock('@/hooks/useWindow.ts', () => ({
  useWindow: () => ({ createWebviewWindow: vi.fn() })
}))
vi.mock('@/views/moreWindow/settings/config.ts', () => ({ useSendOptions: () => ref([]) }))

vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({
    currentSession: ref({ roomId: 'room-1', type: 2 }),
    currentSessionRoomId: ref('room-1')
  })
}))
vi.mock('@/stores/setting.ts', () => ({
  useSettingStore: () => ({
    themes: ref({ content: 'light' }),
    screenshot: ref({ isConceal: false }),
    setScreenshotConceal: vi.fn(),
    shortcuts: ref({ screenshot: 'Ctrl+Shift+A' })
  })
}))
vi.mock('@/stores/history', () => ({
  useHistoryStore: () =>
    reactive({
      emoji: [],
      setEmoji: vi.fn()
    })
}))
vi.mock('@/stores/chat', () => ({
  useChatStore: () =>
    reactive({
      isMsgMultiChoose: false,
      updateMsg: vi.fn()
    })
}))
vi.mock('@/stores/contacts', () => ({
  useContactStore: () => ({ contactsList: ref([]) })
}))
vi.mock('@/stores/emoji', () => ({
  useEmojiStore: () => ({ emojiList: ref([]) })
}))
vi.mock('pinia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pinia')>()
  return { ...actual, storeToRefs: (store: Record<string, unknown>) => store }
})

import ChatFooter from '../ChatFooter.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': {
      editor: {
        file: '文件',
        image: '图片',
        voice: '语音',
        location: '位置',
        chat_history: '聊天记录',
        relation: { not_friends: '不是好友' },
        screenshot: '截图',
        screenshot_hide_curr_window: '隐藏当前窗口'
      },
      aiclaw: { chat: { notice: '暂不支持' } }
    }
  }
})

const slotStub = { template: '<div><slot /><slot name="trigger" /></div>' }
const nCheckboxStub = {
  props: ['checked'],
  template: '<input type="checkbox" :checked="checked" />'
}

const mountFooter = () =>
  mount(ChatFooter, {
    global: {
      plugins: [i18n],
      stubs: {
        MsgInput: true,
        ChatMsgMultiChoose: true,
        LocationModal: true,
        Emoticon: true,
        'n-popover': slotStub,
        'n-flex': slotStub,
        'n-checkbox': nCheckboxStub,
        'n-button-group': slotStub,
        'n-button': slotStub,
        'n-popselect': slotStub,
        'n-virtual-list': true,
        'n-avatar': true,
        'n-tag': true,
        'i18n-t': slotStub
      }
    }
  })

beforeEach(() => {
  ;(window as any).$message = { warning: vi.fn(), error: vi.fn(), success: vi.fn() }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('#155 桌面端 ChatFooter 上传按钮 testid', () => {
  it('渲染文件/图片/语音上传按钮的 testid', () => {
    const wrapper = mountFooter()
    expect(wrapper.find('[data-testid="chat-footer-file"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="chat-footer-image"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="chat-footer-voice"]').exists()).toBe(true)
  })

  it('文件/图片/语音按钮分别使用对应图标', () => {
    const wrapper = mountFooter()
    expect(wrapper.get('[data-testid="chat-footer-file"] use').attributes('href')).toBe('#file2')
    expect(wrapper.get('[data-testid="chat-footer-image"] use').attributes('href')).toBe('#photo')
    expect(wrapper.get('[data-testid="chat-footer-voice"] use').attributes('href')).toBe('#voice')
  })
})
