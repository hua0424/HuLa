import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

/**
 * #45 空消息内联错误 的单元/组件测试。
 *
 * （#44 桌面上传按钮已回退：ChatFooter.vue 工具栏早有同功能文件按钮，#44 冗余——见 aichatoverview#44。）
 *
 * 被测实现位于 components/rightBox/MsgInput.vue（桌面发送行 + composer）：
 *   #45 桌面 handleDesktopSend 在空消息时不再弹全局 toast，而是把 composerError 置为
 *       「不能发送空消息」并在输入框下方内联显示（data-testid="composer-error"）；非空发送前清空、
 *       用户输入恢复时清空。空消息时 send-button 不被 disabledSend 禁用（非 AI），使内联错误可达。
 *
 * MsgInput.vue 依赖极重（useMsgInput / useCommon / 多个 store / tauri / router 经自动导入传递引入），
 * 这里沿用 retry.spec.ts 的「断链」手法：mock 这些汇聚点，只保留被测的模板与组件内逻辑（
 * getInputContent / handleDesktopSend / composerError 清除时机）为真。
 * getInputContent 读取 messageInputDom.textContent（组件内实现，未 mock），因此用真实 DOM 的
 * textContent 控制「空 / 非空」，断言真实分支。
 */

// @/stores/chat 在模块加载期 new Worker(timer.worker)（happy-dom 无 Worker），经传递导入被拉进来，
// 与被测逻辑无关；vi.mock 被提升到导入之前，断链该 store 即可避免模块加载期崩溃。
vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    updateMsg: vi.fn(),
    isMessageStreaming: vi.fn().mockReturnValue(false)
  })
}))

// --- 平台：固定桌面端（isMobile=false 才渲染桌面发送行 + send-button + composer-error） ---
vi.mock('@/utils/PlatformConstants', () => ({
  isMobile: () => false,
  isMac: () => false,
  isWeb: () => false
}))

// --- 路由汇聚点（经自动导入子组件传递引入真实 router -> 大量副作用），与被测逻辑无关 ---
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

// --- tauri 事件 / 窗口：组件 setup / onMounted 会触碰，测试环境无 tauri runtime ---
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getCurrent: () => ({ listen: vi.fn().mockResolvedValue(() => {}) }) }
}))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows', version: () => '10.0' }))

// --- useCommon：组件 setup 解构 handlePaste/processFiles（拖拽/粘贴共享路径用），安全空实现即可 ---
vi.mock('@/hooks/useCommon.ts', () => ({
  useCommon: () => ({
    handlePaste: vi.fn().mockResolvedValue(undefined),
    processFiles: vi.fn().mockResolvedValue(undefined)
  })
}))

// --- useMsgInput：被测组件 setup 解构的核心 hook，提供安全默认 + 可观测的 send ---
const sendMock = vi.fn().mockResolvedValue(undefined)
// disabledSend 可控：模拟「真实 hook 在内容为空时 disabledSend=true」，以验证发送按钮在空消息下
// 仍可点（非 AI），从而 composer-error 可达——这是 #45 修复前假绿的根源（旧 spec 恒 false 且直调 handleDesktopSend）。
const disabledSendRef = ref(false)
const inputKeyDownMock = vi.fn()
vi.mock('@/hooks/useMsgInput.ts', () => ({
  useMsgInput: () => ({
    inputKeyDown: inputKeyDownMock,
    handleAit: vi.fn(),
    handleAI: vi.fn(),
    handleInput: vi.fn(),
    msgInput: ref(''),
    send: sendMock,
    sendLocationDirect: vi.fn(),
    sendFilesDirect: vi.fn(),
    sendVoiceDirect: vi.fn(),
    sendEmojiDirect: vi.fn(),
    personList: ref([]),
    disabledSend: disabledSendRef,
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

// --- hooks / 工具汇聚点：仅提供被测无关的安全默认 ---
vi.mock('@/hooks/useMitt.ts', () => ({
  useMitt: { on: vi.fn(), off: vi.fn(), emit: vi.fn() }
}))
vi.mock('@/views/moreWindow/settings/config.ts', () => ({ useSendOptions: () => ref([]) }))

// --- store mock：仅提供模板/setup 读到的安全默认值 ---
// storeToRefs 被透传（见下），组件对解构出的值会建立 watch，因此这里用 ref 包裹避免
// 「Invalid watch source」告警（真实 store 经 storeToRefs 得到的也是 ref）。
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

import MsgInput from '../MsgInput.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': { editor: { send: '发送', placeholder: '请输入', send_or_newline: '{send} 发送 / {newline} 换行' } }
  }
})

// 透传 slot 的轻量 stub：保留默认插槽渲染，但不加载真实子组件逻辑。
const slotStub = { template: '<div><slot /></div>' }
// n-button stub：保留 :disabled prop 与 fallthrough 属性（data-testid / @click），
// 渲染成真实 <button>，以便断言「空消息下 send-button 是否被禁用」并经真实点击触发 handleDesktopSend。
const nButtonStub = {
  props: ['disabled'],
  inheritAttrs: false,
  template: '<button :disabled="disabled" v-bind="$attrs"><slot /></button>'
}

const mountInput = () =>
  mount(MsgInput, {
    props: { isAIMode: false, isAIStreaming: false },
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
  sendMock.mockClear()
  inputKeyDownMock.mockClear()
  disabledSendRef.value = false
  // 组件用 window.$message.warning 弹全局 toast；用 spy 断言「不再被调用」
  ;(window as any).$message = { warning: vi.fn(), error: vi.fn(), success: vi.fn() }
})

afterEach(() => {
  vi.clearAllMocks()
})

// 取到组件内部输入框 DOM（getInputContent 读它的 textContent）
const getInputDom = (wrapper: ReturnType<typeof mountInput>) =>
  wrapper.get('[data-testid="message-input"]').element as HTMLElement

describe('#45 空消息内联错误', () => {
  // 关键：测「可达触发」——不直调 handleDesktopSend，而是经真实 send-button 点击 / 回车，
  // 且让 disabledSend=true（模拟真实空内容），验证按钮在非 AI 下仍可点、composer-error 可达。
  it('门：非 AI 空输入时 send-button 不被 disabledSend 禁用（修复前因被禁用→composer-error 不可达）', () => {
    disabledSendRef.value = true // 真实空内容时 disabledSend=true
    const wrapper = mountInput() // props.isAIMode=false
    const btn = wrapper.get('[data-testid="send-button"]')
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('空输入点 send-button -> 显示 composer-error、不弹全局 toast、不发送（经真实按钮触发）', async () => {
    disabledSendRef.value = true
    const wrapper = mountInput()
    getInputDom(wrapper).textContent = '   ' // 纯空白
    await wrapper.get('[data-testid="send-button"]').trigger('click')
    await nextTick()
    const err = wrapper.find('[data-testid="composer-error"]')
    expect(err.exists()).toBe(true)
    expect(err.text()).toContain('不能发送空消息')
    expect((window as any).$message.warning).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('非空点 send-button -> 先清 composer-error 且真正发送', async () => {
    const wrapper = mountInput()
    const vm = wrapper.vm as any
    vm.composerError = '不能发送空消息'
    await nextTick()
    getInputDom(wrapper).textContent = 'hello'
    await wrapper.get('[data-testid="send-button"]').trigger('click')
    await flushPromises()
    expect(vm.composerError).toBe('')
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('空输入回车 -> 显示 composer-error、不发送（与按钮一致、不再静默早返回）', async () => {
    const wrapper = mountInput()
    getInputDom(wrapper).textContent = ''
    await wrapper.get('[data-testid="message-input"]').trigger('keydown.enter')
    await nextTick()
    const err = wrapper.find('[data-testid="composer-error"]')
    expect(err.exists()).toBe(true)
    expect(err.text()).toContain('不能发送空消息')
    expect(inputKeyDownMock).not.toHaveBeenCalled()
  })

  it('非空回车 -> 清 composer-error 且走原 inputKeyDown 发送链路', async () => {
    const wrapper = mountInput()
    const vm = wrapper.vm as any
    vm.composerError = '不能发送空消息'
    await nextTick()
    getInputDom(wrapper).textContent = 'hello'
    await wrapper.get('[data-testid="message-input"]').trigger('keydown.enter')
    await nextTick()
    expect(vm.composerError).toBe('')
    expect(inputKeyDownMock).toHaveBeenCalledTimes(1)
  })

  it('用户输入恢复（有内容的 input 事件）时清空 composer-error', async () => {
    const wrapper = mountInput()
    const vm = wrapper.vm as any
    vm.composerError = '不能发送空消息'
    await nextTick()
    getInputDom(wrapper).textContent = 'typed'
    await wrapper.get('[data-testid="message-input"]').trigger('input')
    await nextTick()
    expect(vm.composerError).toBe('')
  })
})
