import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

/**
 * #155 移动端 MsgInput 工具栏 testid 补齐。
 * 被测实现位于 components/rightBox/MsgInput.vue（移动端渲染分支）：
 *   - 语音按钮 data-testid="mobile-voice-button"
 *   - 表情按钮 data-testid="mobile-emoji-button"
 *   - 更多按钮 data-testid="mobile-more-button"
 *   - 发送按钮 data-testid="mobile-send-button"
 */

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    updateMsg: vi.fn(),
    isMessageStreaming: vi.fn().mockReturnValue(false)
  })
}))

vi.mock('@/utils/PlatformConstants', () => ({
  isMobile: () => true,
  isMac: () => false,
  isWeb: () => false
}))

vi.mock('@/router', () => ({
  default: { push: vi.fn(), currentRoute: { value: { name: '/message' } } }
}))
vi.mock('colorthief', () => ({
  default: class {
    getColor() {
      return [0, 0, 0]
    }
  }
}))

vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getCurrent: () => ({ listen: vi.fn().mockResolvedValue(() => {}) }) }
}))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows', version: () => '10.0' }))

vi.mock('@/hooks/useCommon.ts', () => ({
  useCommon: () => ({
    handlePaste: vi.fn().mockResolvedValue(undefined),
    processFiles: vi.fn().mockResolvedValue(undefined)
  })
}))

// --- useMsgInput：共享可观测的 send，供移动端发送行为断言 ---
const mobileSendMock = vi.fn().mockResolvedValue(undefined)
const mobileDisabledSendRef = ref(false)
vi.mock('@/hooks/useMsgInput.ts', () => ({
  useMsgInput: () => ({
    inputKeyDown: vi.fn(),
    handleAit: vi.fn(),
    handleInput: vi.fn(),
    msgInput: ref(''),
    send: mobileSendMock,
    sendLocationDirect: vi.fn(),
    sendFilesDirect: vi.fn(),
    sendVoiceDirect: vi.fn(),
    sendEmojiDirect: vi.fn(),
    personList: ref([]),
    disabledSend: mobileDisabledSendRef,
    ait: ref(false),
    chatKey: ref('Enter'),
    menuList: ref([]),
    selectedAitKey: ref(-1),
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
vi.mock('@/views/moreWindow/settings/config.ts', () => ({ useSendOptions: () => ref([]) }))

vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({ currentSession: ref({ roomId: 'room-1' }) })
}))
vi.mock('@/stores/setting.ts', () => ({
  useSettingStore: () => ({ themes: ref({ content: 'light' }) })
}))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    getUserInfo: vi.fn(),
    getUserDisplayName: vi.fn().mockReturnValue('me'),
    isAdmin: vi.fn().mockReturnValue(false)
  })
}))
vi.mock('pinia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pinia')>()
  return { ...actual, storeToRefs: (store: Record<string, unknown>) => store }
})

import MsgInput from '../../../components/rightBox/MsgInput.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': { editor: { send: '发送', placeholder: '请输入', send_or_newline: '{send} 发送 / {newline} 换行' } }
  }
})

const slotStub = { template: '<div><slot /></div>' }
const nButtonStub = {
  props: ['disabled'],
  inheritAttrs: false,
  template: '<button :disabled="disabled" v-bind="$attrs"><slot /></button>'
}

const mountMobileInput = () =>
  mount(MsgInput, {
    global: {
      plugins: [i18n],
      stubs: {
        VoiceRecorder: true,
        ContextMenu: slotStub,
        FileUploadModal: true,
        'n-scrollbar': slotStub,
        'n-button-group': slotStub,
        'n-button': nButtonStub,
        'n-popselect': slotStub,
        'n-flex': slotStub,
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

describe('#155 移动端 MsgInput testid', () => {
  it('渲染移动端语音/表情/更多按钮 testid', () => {
    const wrapper = mountMobileInput()
    expect(wrapper.find('[data-testid="mobile-voice-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mobile-emoji-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mobile-more-button"]').exists()).toBe(true)
  })

  it('有输入内容时渲染移动端发送按钮 testid', async () => {
    const wrapper = mountMobileInput()
    const vm = wrapper.vm as any
    vm.msgInput = 'hello'
    await nextTick()
    expect(wrapper.find('[data-testid="mobile-send-button"]').exists()).toBe(true)
  })
})

describe('#445 移动端发送走 IM（AI 模式已退役）', () => {
  it('有内容点击移动发送按钮 → 调用 IM send，不触发 send-ai/stop-ai', async () => {
    const wrapper = mountMobileInput()
    const inputEl = wrapper.find('#message-input').element as HTMLElement
    inputEl.textContent = 'hello'
    const vm = wrapper.vm as any
    vm.msgInput = 'hello'
    await nextTick()
    await wrapper.get('[data-testid="mobile-send-button"]').trigger('click')
    expect(mobileSendMock).toHaveBeenCalled()
    expect(wrapper.emitted('send-ai')).toBeUndefined()
    expect(wrapper.emitted('stop-ai')).toBeUndefined()
  })

  it('空内容点击移动发送按钮 → 不发送并弹全局提示', async () => {
    const wrapper = mountMobileInput()
    const inputEl = wrapper.find('#message-input').element as HTMLElement
    inputEl.textContent = ''
    const vm = wrapper.vm as any
    vm.msgInput = 'not-empty-so-button-renders'
    await nextTick()
    mobileDisabledSendRef.value = false
    await wrapper.get('[data-testid="mobile-send-button"]').trigger('click')
    expect(mobileSendMock).not.toHaveBeenCalled()
    expect((window as any).$message.warning).toHaveBeenCalled()
  })
})
