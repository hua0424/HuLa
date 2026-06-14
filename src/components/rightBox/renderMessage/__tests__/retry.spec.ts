import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { MessageStatusEnum, MsgEnum, ThemeEnum } from '@/enums'
// reactive 用于「逻辑层守卫」测试构造可变 message

/**
 * #19 失败消息「重试发送」单元/组件测试。
 *
 * 实现位于 renderMessage/index.vue 的 handleRetry：
 *   - 守卫：仅 status===FAILED 才发；SENDING/其它态忽略，避免重复发送
 *   - 触发时先 chatStore.updateMsg(... status: SENDING)（FAILED -> SENDING）
 *   - 复用 useMessageSender().sendWithTracking，参数携带 FAILED 消息的内容
 *
 * sendWithTracking 真实契约（见 hooks/useMessageSender.ts）：
 *   sendWithTracking({ tempMsgId, payload, onSuccess?, onError? }) => Promise
 *   成功/失败时的 SUCCESS/FAILED 状态写回由 sendWithTracking 内部完成（经 chatStore.updateMsg）。
 * 因此这里把 useMessageSender 整个 mock 掉：sendWithTracking 是 vi.fn()，
 * 由测试控制其「成功 / 失败」语义（成功 = resolve 并触发其内部 SUCCESS 写回的语义，
 * 失败 = 触发 FAILED 写回的语义），从而断言组件侧的接线与守卫，而非 hook 内部实现。
 */

// index.vue 经自动导入的 ContextMenu -> useCommon -> @/router 把整张路由图（含
// mobile/login.vue、FriendsList、fingerprint worker、colorthief）传递性拉进来，
// 这些在 happy-dom 下无法初始化，且与重试逻辑完全无关。mock 路由这一汇聚点即可断链。
vi.mock('@/router', () => ({
  default: {
    push: vi.fn(),
    currentRoute: { value: { name: '/message' } }
  }
}))

// colorthief 在 happy-dom 下无法 new（经多条自动导入子组件链路传递性引入），与重试逻辑无关。
vi.mock('colorthief', () => ({
  default: class {
    getColor() {
      return [0, 0, 0]
    }
  }
}))

// --- sendWithTracking mock：模拟真实回调契约 ---
// 真实实现里 SUCCESS/FAILED 由 sendWithTracking 内部写回 chatStore；这里用一个可注入“结果”的 fake，
// 让它在被调用时按注入的模式回调 onSuccess/onError 并代为写回 chatStore.updateMsg，贴合真实契约。
const sendWithTrackingMock = vi.fn()
vi.mock('@/hooks/useMessageSender', () => ({
  useMessageSender: () => ({ sendWithTracking: sendWithTrackingMock })
}))

// --- chatStore mock（updateMsg 用 vi.fn() 观测状态写回） ---
const updateMsgMock = vi.fn()
const chatStoreMock = {
  updateMsg: updateMsgMock,
  updateSessionLastActiveTime: vi.fn(),
  isMessageStreaming: vi.fn().mockReturnValue(false),
  isMsgMultiChoose: false,
  msgMultiChooseMode: ''
}
vi.mock('@/stores/chat', () => ({
  useChatStore: () => chatStoreMock
}))

// --- 其余 store mock：仅提供模板/computed 读到的安全默认值 ---
vi.mock('@/stores/user', () => ({
  useUserStore: () => ({ userInfo: { uid: 'me-1', avatar: '' } })
}))
vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({ currentSessionRoomId: 'room-9' })
}))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    getUserInfo: vi.fn().mockReturnValue(undefined),
    getUserDisplayName: vi.fn().mockReturnValue('me'),
    isAdmin: vi.fn().mockReturnValue(false),
    isCurrentLord: vi.fn().mockReturnValue(false),
    updateUserItem: vi.fn()
  })
}))
vi.mock('@/stores/cached', () => ({
  useCachedStore: () => ({
    badgeById: vi.fn().mockReturnValue(undefined)
  })
}))
const settingStoreMock = { themes: { content: ThemeEnum.LIGHT } }
vi.mock('@/stores/setting', () => ({
  useSettingStore: () => settingStoreMock
}))

// storeToRefs 仅在真实 pinia store 上工作；这里 store 是普通对象，passthrough 即可
// （组件只读 themes.content，不依赖响应式 ref 包装）。
vi.mock('pinia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pinia')>()
  return {
    ...actual,
    storeToRefs: (store: Record<string, unknown>) => store
  }
})

// --- useChatMain mock：handleRetry 不依赖它，仅满足 setup 解构 ---
vi.mock('@/hooks/useChatMain', () => ({
  chatMainInjectionKey: Symbol('chatMain'),
  // 模板里 handleItemType/specialMenuList/handleMsgClick 是函数，emojiList/activeBubble 是 ref
  useChatMain: () => ({
    optionsList: [],
    report: [],
    activeBubble: { value: '' },
    handleItemType: vi.fn().mockReturnValue([]),
    emojiList: { value: [] },
    specialMenuList: vi.fn().mockReturnValue([]),
    handleMsgClick: vi.fn()
  })
}))
vi.mock('@/hooks/usePopover', () => ({
  usePopover: () => ({ handlePopoverUpdate: vi.fn() })
}))
// RouterUtils 会 import 真实 router -> FriendsList -> userStatus -> colorthief（测试环境无法 new），
// handleRetry 不依赖它，直接 mock 断链。
vi.mock('@/utils/RouterUtils', () => ({
  toFriendInfoPage: vi.fn()
}))

import RenderMessage from '../index.vue'

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': {} } })

type MakeOpts = { status?: MessageStatusEnum }

// 构造一条「我发送的」文本消息（hasBubble(TEXT)=true、非 historyMode、isMe=true -> 渲染重试按钮）
const makeMessage = ({ status = MessageStatusEnum.FAILED }: MakeOpts = {}) => ({
  fromUser: { uid: 'me-1', avatar: '' },
  isCheck: false,
  message: {
    id: 'msg-100',
    roomId: 'room-9',
    type: MsgEnum.TEXT,
    status,
    sendTime: 1700000000000,
    body: { content: 'hello-retry' },
    messageMarks: {}
  }
})

// 透传 slot 的轻量 stub：保留结构与默认插槽渲染，但不加载真实子组件逻辑。
// 不能用 shallow（会吞掉 ContextMenu/n-flex 的默认插槽，重试按钮就渲染不出来）。
const slotStub = { template: '<div><slot /></div>' }
const triggerSlotStub = { template: '<div><slot /><slot name="trigger" /></div>' }

const mountRow = (msg: ReturnType<typeof makeMessage>) =>
  mount(RenderMessage, {
    props: {
      message: msg,
      isGroup: false,
      fromUser: { uid: 'me-1' }
    },
    global: {
      plugins: [i18n],
      stubs: {
        // 结构性包裹组件：用透传 slot 的 stub，保证内部的 retry-button 仍被渲染
        ContextMenu: slotStub,
        'n-flex': slotStub,
        'n-icon': slotStub,
        'n-popover': triggerSlotStub,
        'n-checkbox': true,
        'n-avatar': true,
        'n-image': true,
        Transition: slotStub,
        // 重试逻辑无关的重型/叶子子组件，全部 stub 掉
        InfoPopover: true,
        Text: true,
        Image: true,
        Video: true,
        Voice: true,
        File: true,
        Emoji: true,
        Location: true,
        AudioCall: true,
        VideoCall: true,
        MergeMessage: true,
        Announcement: true,
        BotMessage: true,
        RecallMessage: true,
        SystemMessage: true
      }
    }
  })

beforeEach(() => {
  sendWithTrackingMock.mockReset()
  updateMsgMock.mockReset()
  chatStoreMock.updateSessionLastActiveTime.mockClear()
  // 默认成功语义：sendWithTracking resolve，并按真实契约代为写回 SUCCESS
  sendWithTrackingMock.mockImplementation(async (opts: any) => {
    opts?.onSuccess?.({ message: { id: opts.tempMsgId } })
    chatStoreMock.updateMsg({ msgId: opts.tempMsgId, status: MessageStatusEnum.SUCCESS })
  })
})

describe('#19 失败消息重试发送（handleRetry）', () => {
  it('核心：对 FAILED 消息点击重试 -> sendWithTracking 被调用一次，且参数携带该 FAILED 消息内容', async () => {
    const msg = makeMessage({ status: MessageStatusEnum.FAILED })
    const wrapper = mountRow(msg)

    const btn = wrapper.find('[data-testid="retry-button"]')
    expect(btn.exists()).toBe(true)

    await btn.trigger('click')
    await flushPromises()

    expect(sendWithTrackingMock).toHaveBeenCalledTimes(1)
    const arg = sendWithTrackingMock.mock.calls[0][0]
    expect(arg.tempMsgId).toBe('msg-100') // tempMsgId === msg.id
    expect(arg.payload).toMatchObject({
      id: 'msg-100',
      roomId: 'room-9',
      msgType: MsgEnum.TEXT,
      body: { content: 'hello-retry' }
    })
  })

  it('状态置回：触发时 chatStore.updateMsg 以 {msgId, roomId, status: SENDING} 被调用（FAILED -> SENDING）', async () => {
    const msg = makeMessage({ status: MessageStatusEnum.FAILED })
    const wrapper = mountRow(msg)

    await wrapper.find('[data-testid="retry-button"]').trigger('click')
    await flushPromises()

    // 第一次 updateMsg 即组件侧的 FAILED -> SENDING 置回
    expect(updateMsgMock).toHaveBeenCalled()
    expect(updateMsgMock.mock.calls[0][0]).toEqual({
      msgId: 'msg-100',
      roomId: 'room-9',
      status: MessageStatusEnum.SENDING
    })
  })

  it('成功路径：sendWithTracking 成功回调被接线并触发 SUCCESS 写回', async () => {
    const msg = makeMessage({ status: MessageStatusEnum.FAILED })
    const wrapper = mountRow(msg)

    await wrapper.find('[data-testid="retry-button"]').trigger('click')
    await flushPromises()

    // 成功语义下，最终出现一次 status: SUCCESS 的写回（由 sendWithTracking 内部契约完成）
    const statuses = updateMsgMock.mock.calls.map((c) => c[0].status)
    expect(statuses).toContain(MessageStatusEnum.SENDING) // 组件侧置回
    expect(statuses).toContain(MessageStatusEnum.SUCCESS) // hook 成功写回
  })

  it('失败可再试：失败后状态回到 FAILED，再次点击 -> sendWithTracking 再被调用（未锁死）', async () => {
    // 失败语义：sendWithTracking 触发 onError 并按契约写回 FAILED
    sendWithTrackingMock.mockImplementation(async (opts: any) => {
      opts?.onError?.(opts.tempMsgId)
      chatStoreMock.updateMsg({ msgId: opts.tempMsgId, status: MessageStatusEnum.FAILED })
    })

    const msg = makeMessage({ status: MessageStatusEnum.FAILED })
    const wrapper = mountRow(msg)

    // 第一次重试 -> 失败
    await wrapper.find('[data-testid="retry-button"]').trigger('click')
    await flushPromises()
    expect(sendWithTrackingMock).toHaveBeenCalledTimes(1)
    const statusesAfterFirst = updateMsgMock.mock.calls.map((c) => c[0].status)
    expect(statusesAfterFirst).toContain(MessageStatusEnum.FAILED) // 回到 FAILED，按钮仍在

    // 按钮仍存在（v-if status===FAILED，prop 仍为 FAILED），可再次点击
    const btn = wrapper.find('[data-testid="retry-button"]')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    await flushPromises()

    // 再次被调用，证明失败后未被锁死
    expect(sendWithTrackingMock).toHaveBeenCalledTimes(2)
  })

  it('防重守卫（UI层）：SENDING 状态消息不渲染 retry-button，无法触发重发', async () => {
    const msg = makeMessage({ status: MessageStatusEnum.SENDING })
    const wrapper = mountRow(msg)

    // v-if="status===FAILED"：SENDING 态没有重试入口，从源头杜绝重复发送
    expect(wrapper.find('[data-testid="retry-button"]').exists()).toBe(false)
    expect(sendWithTrackingMock).not.toHaveBeenCalled()
  })

  it('防重守卫（逻辑层）：同一句柄在消息变 SENDING 后触发 -> 守卫拦截，不重发', async () => {
    // 以 FAILED 渲染出按钮，其 @click 句柄为 handleRetry(message)，闭包持有这条响应式 message。
    const msg = reactive(makeMessage({ status: MessageStatusEnum.FAILED }))
    const wrapper = mountRow(msg as unknown as ReturnType<typeof makeMessage>)
    const el = wrapper.find('[data-testid="retry-button"]').element as HTMLElement

    // 控制组：status 仍是 FAILED 时，同一元素的原生 click 会真正命中 handleRetry 并发送一次，
    // 证明下面「不发送」不是因为元素脱离 DOM、句柄没被调用。
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(sendWithTrackingMock).toHaveBeenCalledTimes(1)

    sendWithTrackingMock.mockClear()
    updateMsgMock.mockClear()

    // 把同一条消息置为 SENDING（模拟「已在发送中」）。Vue 的 DOM 更新被批处理到下一个微任务，
    // 此处同步派发 click，元素仍在 DOM，句柄照样命中 handleRetry，但此时 message.status===SENDING，
    // 守卫 status!==FAILED 应直接 return，不调用 sendWithTracking、不做 SENDING 置回。
    msg.message.status = MessageStatusEnum.SENDING
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(sendWithTrackingMock).not.toHaveBeenCalled()
    expect(updateMsgMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: MessageStatusEnum.SENDING, msgId: 'msg-100' })
    )
  })
})
