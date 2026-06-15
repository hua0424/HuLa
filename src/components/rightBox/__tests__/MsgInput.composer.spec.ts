import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

/**
 * #44 桌面端上传按钮 + #45 空消息内联错误 的单元/组件测试。
 *
 * 被测实现位于 components/rightBox/MsgInput.vue（桌面发送行 + composer）：
 *   #44 在发送按钮行最左侧新增上传图标按钮（data-testid="upload-button"），点击触发隐藏
 *       的 <input type="file" ref="uploadFileInput"> 的 click()；选择文件后 handleUploadFileSelect
 *       复用 useCommon().processFiles 走与拖拽/粘贴相同的链路（最终 setPendingFiles + showFileModal）。
 *   #45 桌面 handleDesktopSend 在空消息时不再弹全局 toast，而是把 composerError 置为
 *       「不能发送空消息」并在输入框下方内联显示（data-testid="composer-error"）；非空发送前清空、
 *       用户输入恢复时清空。
 *
 * MsgInput.vue 依赖极重（useMsgInput / useCommon / 多个 store / tauri / router 经自动导入传递引入），
 * 这里沿用 retry.spec.ts 的「断链」手法：mock 这些汇聚点，只保留被测的模板与组件内逻辑（
 * getInputContent / handleDesktopSend / handleUploadFileSelect / composerError 清除时机）为真。
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

// --- 平台：固定桌面端（isMobile=false 才渲染桌面发送行与 upload-button） ---
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

// --- useCommon：观测 processFiles 是否被 upload 链路调用；handlePaste 保持安全空实现 ---
const processFilesMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/hooks/useCommon.ts', () => ({
  useCommon: () => ({
    handlePaste: vi.fn().mockResolvedValue(undefined),
    processFiles: processFilesMock
  })
}))

// --- useMsgInput：被测组件 setup 解构的核心 hook，提供安全默认 + 可观测的 send ---
const sendMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/hooks/useMsgInput.ts', () => ({
  useMsgInput: () => ({
    inputKeyDown: vi.fn(),
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
        'n-button': slotStub,
        'n-popselect': slotStub,
        'n-flex': slotStub,
        'i18n-t': slotStub
      }
    }
  })

beforeEach(() => {
  processFilesMock.mockClear()
  sendMock.mockClear()
  // 组件用 window.$message.warning 弹全局 toast；用 spy 断言「不再被调用」
  ;(window as any).$message = { warning: vi.fn(), error: vi.fn(), success: vi.fn() }
})

afterEach(() => {
  vi.clearAllMocks()
})

// 取到组件内部输入框 DOM（getInputContent 读它的 textContent）
const getInputDom = (wrapper: ReturnType<typeof mountInput>) =>
  wrapper.get('[data-testid="message-input"]').element as HTMLElement

describe('#44 桌面端上传按钮', () => {
  it('桌面端渲染 upload-button 入口', () => {
    const wrapper = mountInput()
    const btn = wrapper.find('[data-testid="upload-button"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('aria-label')).toBe('上传文件')
  })

  it('点击 upload-button 触发隐藏 file input 的 click()', async () => {
    const wrapper = mountInput()
    const fileInput = wrapper.get('input[type="file"]').element as HTMLInputElement
    const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {})
    await wrapper.get('[data-testid="upload-button"]').trigger('click')
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('handleUploadFileSelect 选中文件后复用 processFiles 链路', async () => {
    const wrapper = mountInput()
    const vm = wrapper.vm as any
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    // 模拟 input change：file input 的 files 不可直接赋值，用事件 target 桩
    const target = { files: [file] as unknown as FileList, value: 'a.png' }
    await vm.handleUploadFileSelect({ target } as unknown as Event)
    await flushPromises()
    expect(processFilesMock).toHaveBeenCalledTimes(1)
    // 第一个参数应为文件数组（Array.from(files)）
    const firstArg = processFilesMock.mock.calls[0][0]
    expect(Array.isArray(firstArg)).toBe(true)
    expect(firstArg[0]).toBe(file)
    // 选完后清空 input.value，使同一文件可再次选择
    expect(target.value).toBe('')
  })

  it('无文件时不调用 processFiles', async () => {
    const wrapper = mountInput()
    const vm = wrapper.vm as any
    await vm.handleUploadFileSelect({ target: { files: null, value: '' } } as unknown as Event)
    await flushPromises()
    expect(processFilesMock).not.toHaveBeenCalled()
  })
})

describe('#45 空消息内联错误', () => {
  it('空内容点发送 -> composerError 置文案、不弹 toast、不发送', async () => {
    const wrapper = mountInput()
    const vm = wrapper.vm as any
    getInputDom(wrapper).textContent = '   ' // 纯空白
    await vm.handleDesktopSend()
    await nextTick()
    expect(vm.composerError).toBe('不能发送空消息')
    expect((window as any).$message.warning).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
    // 内联错误元素可见
    const err = wrapper.find('[data-testid="composer-error"]')
    expect(err.exists()).toBe(true)
    expect(err.text()).toContain('不能发送空消息')
  })

  it('非空内容点发送 -> 先清 composerError 且真正发送', async () => {
    const wrapper = mountInput()
    const vm = wrapper.vm as any
    vm.composerError = '不能发送空消息'
    await nextTick()
    getInputDom(wrapper).textContent = 'hello'
    await vm.handleDesktopSend()
    await flushPromises()
    expect(vm.composerError).toBe('')
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('用户输入恢复（有内容的 input 事件）时清空 composerError', async () => {
    const wrapper = mountInput()
    const vm = wrapper.vm as any
    vm.composerError = '不能发送空消息'
    await nextTick()
    const dom = getInputDom(wrapper)
    dom.textContent = 'typed'
    await wrapper.get('[data-testid="message-input"]').trigger('input')
    await nextTick()
    expect(vm.composerError).toBe('')
  })

  it('空消息时不再使用全局 toast（移除并存）', async () => {
    const wrapper = mountInput()
    const vm = wrapper.vm as any
    getInputDom(wrapper).textContent = ''
    await vm.handleDesktopSend()
    await nextTick()
    expect((window as any).$message.warning).not.toHaveBeenCalled()
  })
})
