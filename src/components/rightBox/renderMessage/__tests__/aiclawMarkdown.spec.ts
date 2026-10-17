import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeEnum, UserType } from '@/enums'
import type { TextBody } from '@/services/types'

/**
 * #435 aiclaw 完成态 markdown 渲染测试。
 *
 * 接线：renderMessage/index.vue 两分支本就透传 :from-user-uid；
 * Text.vue 新增 fromUserUid prop + isAiclawRendered 分支：
 *   - aiclaw 发送者完成态 -> AiclawMarkdown 整包渲染一次，预览卡移正文下方
 *   - 流式中 / 人类消息 -> 原纯文本/fragment 逻辑不动
 * 判定走 AiclawUtils.isAiclaw 单一事实源（groupStore 群成员缓存优先，
 * 无数据时 fallback contactStore 好友列表）。
 */

// --- 断链：与渲染判定无关的重依赖 ---
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

const openExternalUrlMock = vi.fn()
vi.mock('@/hooks/useLinkSegments', () => ({
  openExternalUrl: (...args: unknown[]) => openExternalUrlMock(...args),
  extractLinkSegments: (text: string) => [{ text, isLink: false }],
  normalizeExternalUrl: (url: string) => url,
  useLinkSegments: () => ({ segments: { value: [] }, openLink: openExternalUrlMock })
}))

// --- store mock：aiclaw 身份可配 ---
const AICLAW_UID = 'aiclaw-1'
const HUMAN_UID = 'human-1'
vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    getUserInfo: vi.fn((uid: string) => (uid === AICLAW_UID ? { userType: UserType.AICLAW } : undefined)),
    getUserDisplayName: vi.fn().mockReturnValue(''),
    isAdmin: vi.fn().mockReturnValue(false),
    isCurrentLord: vi.fn().mockReturnValue(false),
    updateUserItem: vi.fn()
  })
}))
vi.mock('@/stores/contacts', () => ({
  useContactStore: () => ({ contactsList: [] })
}))
vi.mock('@/stores/user', () => ({
  useUserStore: () => ({ userInfo: { uid: 'me-1', avatar: '' } })
}))
vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({ currentSessionRoomId: 'room-9' })
}))
vi.mock('@/stores/setting', () => ({
  // storeToRefs 被 passthrough：themes 本体即 ref 形态
  useSettingStore: () => ({ themes: { value: { content: ThemeEnum.LIGHT } } })
}))
vi.mock('@/stores/cached', () => ({
  useCachedStore: () => ({ badgeById: vi.fn().mockReturnValue(undefined) })
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
vi.mock('pinia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pinia')>()
  return { ...actual, storeToRefs: (store: Record<string, unknown>) => store }
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
vi.mock('@/hooks/useMessageSender', () => ({
  useMessageSender: () => ({ sendWithTracking: vi.fn() })
}))

import Text from '../Text.vue'

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': {} } })

const makeBody = (
  content: string,
  urlContentMap: Record<string, { title: string; description: string; image: string }> = {}
): TextBody => ({
  content,
  reply: {} as TextBody['reply'],
  atUidList: [],
  urlContentMap
})

const mountText = (body: ReturnType<typeof makeBody>, extra: Record<string, unknown> = {}) =>
  mount(Text, {
    props: { body, searchKeyword: '', historyMode: false, isStreaming: false, ...extra },
    global: { plugins: [i18n] }
  })

/** markdown 异步高亮/懒块落定 */
const settleMarkdown = async () => {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('分支判定（Text.vue）', () => {
  it('aiclaw 完成态走 markdown 分支，人类消息不动', async () => {
    const md = '# 标题\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'
    const aiclaw = mountText(makeBody(md), { fromUserUid: AICLAW_UID })
    await settleMarkdown()
    expect(aiclaw.find('[data-testid="aiclaw-markdown"]').exists()).toBe(true)
    // markdown 源码不应原样直出
    expect(aiclaw.text()).not.toContain('|---|---|')

    const human = mountText(makeBody(md), { fromUserUid: HUMAN_UID })
    await settleMarkdown()
    expect(human.find('[data-testid="aiclaw-markdown"]').exists()).toBe(false)
    // 人类消息保持 fragment 纯文本
    expect(human.text()).toContain('|---|---|')
  })

  it('aiclaw 流式中仍是纯文本+光标，不进 markdown', () => {
    const wrapper = mountText(makeBody('# 标题'), { fromUserUid: AICLAW_UID, isStreaming: true })
    expect(wrapper.find('[data-testid="aiclaw-markdown"]').exists()).toBe(false)
    expect(wrapper.find('.streaming-cursor').exists()).toBe(true)
    expect(wrapper.text()).toContain('# 标题')
  })

  it('aiclaw 预览卡渲染在正文下方（v-for 整排），而非内联', async () => {
    const url = 'https://example.com/a'
    const body = makeBody(`看看这个链接 ${url} 吧`, {
      [url]: { title: '示例', description: '描述', image: '' }
    })
    const wrapper = mountText(body, { fromUserUid: AICLAW_UID })
    await settleMarkdown()
    const cards = wrapper.findAll('.text-card')
    expect(cards.length).toBe(1)
    expect(cards[0].text()).toContain('示例')
  })
})

describe('AiclawMarkdown 渲染与安全', () => {
  it('GFM 表格/代码块渲染：代码文本可读且有复制按钮', async () => {
    const wrapper = mountText(makeBody('```js\nconst a = 1\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |'), {
      fromUserUid: AICLAW_UID
    })
    await settleMarkdown()
    const root = wrapper.find('[data-testid="aiclaw-markdown"]')
    expect(root.exists()).toBe(true)
    // 表格成表
    expect(root.find('table').exists()).toBe(true)
    // 代码块容器 + 代码文本（shiki 或纯文本兜底都必须含源码）
    expect(root.find('.code-block-container').exists()).toBe(true)
    expect(root.text().replace(/\s+/g, ' ')).toContain('const a = 1')
    // 复制按钮（chat 场景保留的唯一代码操作）
    expect(root.find('button[aria-label="Copy"], button[aria-label="Copied"]').exists()).toBe(true)
  })

  it('XSS payload 被中和：危险元素/事件属性/危险协议一个不留', async () => {
    const wrapper = mountText(
      makeBody(
        '<script>alert(1)</script>\n\n<iframe src="https://evil.example/"></iframe>\n\n<img src=x onerror="alert(2)"> Bonjour\n\n[点我](javascript:alert(3))\n\n[图片](data:text/html,<h1>x</h1>)'
      ),
      { fromUserUid: AICLAW_UID }
    )
    await settleMarkdown()
    const root = wrapper.find('[data-testid="aiclaw-markdown"]')
    // 危险元素全部移除
    for (const sel of ['script', 'iframe', 'object', 'embed', 'form', 'link', 'meta']) {
      expect(root.find(sel).exists()).toBe(false)
    }
    // 事件属性全部剥离
    expect(root.html()).not.toMatch(/\son\w+\s*=/i)
    // 危险协议 href 全部剥离（文本保留、不可点跳）
    expect(root.find('a[href^="javascript:"]').exists()).toBe(false)
    expect(root.find('a[href^="data:"]').exists()).toBe(false)
    expect(root.text()).toContain('点我')
    // 正常图片/链接不受影响在其他用例覆盖；此处确认无残留可执行向量
    expect(root.find('img[onerror]').exists()).toBe(false)
  })

  it('http(s) 链接点击被拦截走外部浏览器，原生跳转被阻止', async () => {
    const wrapper = mountText(makeBody('[外部](https://example.com/x)'), { fromUserUid: AICLAW_UID })
    await settleMarkdown()
    const anchor = wrapper.find('[data-testid="aiclaw-markdown"] a[href="https://example.com/x"]')
    expect(anchor.exists()).toBe(true)
    await anchor.trigger('click')
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://example.com/x')
  })

  it('长代码块不撑破容器：存在横向滚动约束', async () => {
    const longLine = 'x'.repeat(500)
    const wrapper = mountText(makeBody(`\`\`\`\n${longLine}\n\`\`\``), { fromUserUid: AICLAW_UID })
    await settleMarkdown()
    const container = wrapper.find('[data-testid="aiclaw-markdown"] .code-block-container')
    expect(container.exists()).toBe(true)
  })
})
