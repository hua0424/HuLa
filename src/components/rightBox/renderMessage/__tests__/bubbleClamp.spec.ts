import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageStatusEnum, MsgEnum, ThemeEnum } from '@/enums'

/**
 * #436 AC3 回归：移动端窄屏气泡钳制。
 *
 * 缺陷：index.vue 的 bubbleMaxWidth 移动分支返回 '84%'，但父链
 * （n-flex.flex-1 → 内层 n-flex → 气泡包裹层）的 flex 子项默认
 * min-width:auto，被不可断行内容（超宽 token/多列宽表）按 min-content
 * 逐级撑大；84% 相对已被撑大的父失去上限作用 → 气泡 692px、列表整体横滚。
 * 修复：移动端三层统一加 min-w-0（包裹层兼 max-w-full），百分比重新相对视口
 * 约束的父解析；桌面分支零改动。
 */

// mobile 开关：mount 前拨动，断言双分支类名
const mobileFlag = vi.hoisted(() => ({ value: true }))
vi.mock('@/utils/PlatformConstants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/PlatformConstants')>()
  return {
    ...actual,
    isMobile: () => mobileFlag.value
  }
})

// 以下 mock 块复用 retry.spec.ts 的断链（index.vue 重型依赖与本断言无关）
vi.mock('@/router', () => ({
  default: {
    push: vi.fn(),
    currentRoute: { value: { name: '/message' } }
  }
}))
vi.mock('colorthief', () => ({
  default: class {
    getColor() {
      return [0, 0, 0]
    }
  }
}))
vi.mock('@/hooks/useMessageSender', () => ({
  useMessageSender: () => ({ sendWithTracking: vi.fn() })
}))
vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    updateMsg: vi.fn(),
    updateSessionLastActiveTime: vi.fn(),
    isMessageStreaming: vi.fn().mockReturnValue(false),
    isMsgMultiChoose: false,
    msgMultiChooseMode: ''
  })
}))
vi.mock('@/stores/user', () => ({
  useUserStore: () => ({ userInfo: { uid: 'me-1', avatar: '' } })
}))
vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({ currentSessionRoomId: 'room-9' })
}))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    getUserInfo: vi.fn().mockReturnValue(undefined),
    getUserDisplayName: vi.fn().mockReturnValue('ai'),
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
vi.mock('@/stores/setting', () => ({
  useSettingStore: () => ({ themes: { content: ThemeEnum.LIGHT } })
}))
vi.mock('pinia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pinia')>()
  return {
    ...actual,
    storeToRefs: (store: Record<string, unknown>) => store
  }
})
vi.mock('@/hooks/useChatMain', () => ({
  chatMainInjectionKey: Symbol('chatMain'),
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
vi.mock('@/utils/RouterUtils', () => ({
  toFriendInfoPage: vi.fn()
}))

import RenderMessage from '../index.vue'

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': {} } })

// 一条 AI 文本消息（超宽无空格 token，复现 AC3 的 min-content 撑大源）
const makeAiMessage = () => ({
  fromUser: { uid: 'ai-1', username: 'ai', avatar: '', locPlace: '' },
  isCheck: false,
  sendTime: 1700000000000,
  message: {
    id: 'msg-436',
    roomId: 'room-9',
    type: MsgEnum.TEXT,
    status: MessageStatusEnum.SUCCESS,
    sendTime: 1700000000000,
    body: { content: `LONG_WIDE${'x'.repeat(60)}`, urlContentMap: {} },
    messageMarks: {}
  }
})

const slotStub = { template: '<div><slot /></div>' }
const triggerSlotStub = { template: '<div><slot /><slot name="trigger" /></div>' }

const mountRow = () =>
  mount(RenderMessage, {
    props: {
      message: makeAiMessage(),
      isGroup: false,
      fromUser: { uid: 'ai-1' }
    },
    global: {
      plugins: [i18n],
      stubs: {
        ContextMenu: slotStub,
        'n-flex': slotStub,
        'n-icon': slotStub,
        'n-popover': triggerSlotStub,
        'n-checkbox': true,
        'n-avatar': true,
        'n-image': true,
        Transition: slotStub,
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
  vi.clearAllMocks()
  mobileFlag.value = true
})

describe('#436 AC3 移动端气泡钳制', () => {
  it('移动端：行容器 + 内容列 + 气泡包裹层全部 min-w-0（百分比相对视口约束父解析）', async () => {
    const wrapper = mountRow()
    await flushPromises()
    const bubble = wrapper.find('[data-testid="assistant-message"]')
    expect(bubble.exists()).toBe(true)
    const cls = bubble.classes()
    expect(cls).toContain('min-w-0')
    expect(cls).toContain('w-full')
    expect(cls).toContain('max-w-full')
    // 父级：内容列 n-flex（flex-1）
    const parent = bubble.element.parentElement
    expect(parent?.className).toContain('flex-1')
    expect(parent?.className).toContain('min-w-0')
    // 祖父级：消息行容器（flex-1）
    const grandParent = parent?.parentElement
    expect(grandParent?.className).toContain('flex-1')
    expect(grandParent?.className).toContain('min-w-0')
  })

  it('桌面端：不引入 min-w-0（零影响）', async () => {
    mobileFlag.value = false
    const wrapper = mountRow()
    await flushPromises()
    const bubble = wrapper.find('[data-testid="assistant-message"]')
    expect(bubble.exists()).toBe(true)
    expect(bubble.classes()).not.toContain('min-w-0')
  })
})
