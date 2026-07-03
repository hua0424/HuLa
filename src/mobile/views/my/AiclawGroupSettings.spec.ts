import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

// useRoute stub：提供 uid 路由参数
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { uid: '1001' }, query: {} })
}))

// chatStore stub：返回一条群配置，覆盖全部 5 个保留字段
const groupConfig = {
  roomId: 'room-1',
  roomName: '测试群',
  rateLimitPerMinute: 5,
  dailyLimit: 100,
  respondToAi: false,
  mentionRequired: true,
  approved: false
}

const inactiveConfig = {
  roomId: 'room-2',
  roomName: 'Beta 群',
  rateLimitPerMinute: 5,
  dailyLimit: 100,
  respondToAi: false,
  mentionRequired: true,
  approved: false
}

const activeConfig = {
  roomId: 'room-1',
  roomName: 'Alpha 群',
  rateLimitPerMinute: 5,
  dailyLimit: 100,
  respondToAi: false,
  mentionRequired: true,
  approved: true
}

const loadAiclawGroupConfigMock = vi.fn().mockResolvedValue(undefined)
const saveAiclawGroupConfigMock = vi.fn().mockResolvedValue(undefined)
const loadAiclawGroupConfigsMock = vi.fn().mockResolvedValue(undefined)
const getAiclawGroupConfigListMock = vi.fn().mockReturnValue([groupConfig])

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    loadAiclawGroupConfigs: loadAiclawGroupConfigsMock,
    loadAiclawGroupConfig: loadAiclawGroupConfigMock,
    getAiclawGroupConfigList: getAiclawGroupConfigListMock,
    saveAiclawGroupConfig: saveAiclawGroupConfigMock
  })
}))

// 避免测试里 fetchAdapterType 走真实网络/Pinia，让 onMounted 同步完成
vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: vi.fn().mockResolvedValue([])
}))

import AiclawGroupSettings from './AiclawGroupSettings.vue'

// #51 关键：用**真实 locale JSON** 喂 i18n（旧版内联 mock 文案绕过真实 JSON → 假绿，
// 漏掉了 group_settings.mention_required 里字面 @ 被当 linked-message 语法的 bug）。
const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': { aiclaw: aiclawZh }
  }
})

// Naive UI 组件经 unplugin 全局注册（见 vitest.config.ts），实际渲染真实组件，
// 表单项 label 渲染在 .n-form-item-label__text 中，按此断言渲染了哪些字段。
const mountForm = () =>
  mount(AiclawGroupSettings, {
    global: {
      plugins: [i18n],
      stubs: {
        AutoFixHeightPage: { template: '<div><slot name="header" /><slot name="container" /></div>' },
        HeaderBar: true
      }
    }
  })

// #51 判别守卫：vitest（happy-dom）里 vue-i18n 对非法 linked 格式不抛、只把
// 编译错误打到 console.error 并回退原串——所以仅靠 label 文本断言会假绿（裸 @ 时
// 标签照样渲染出原串）。捕获 console.error 才能真正区分裸 @ 与已转义 @。
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

function i18nCompileErrors(): string[] {
  return errorSpy.mock.calls
    .map((args: unknown[]) => args.map(String).join(' '))
    .filter((line: string) => /compilation error|Invalid linked format/i.test(line))
}

describe('REQ-012 #114：未激活群卡显眼化 + 一键批准', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAiclawGroupConfigListMock.mockReturnValue([inactiveConfig, activeConfig])
  })

  it('未激活群卡排在已激活前面', async () => {
    const wrapper = mountForm()
    await flushPromises()

    const cards = wrapper.findAll('[data-testid="aiclaw-group-card"]')
    expect(cards).toHaveLength(2)
    expect(cards[0].find('[data-testid="aiclaw-group-card-inactive-badge"]').exists()).toBe(true)
    expect(cards[1].find('[data-testid="aiclaw-group-card-inactive-badge"]').exists()).toBe(false)
  })

  it('未激活群卡显示「批准」按钮，已激活不显示', async () => {
    const wrapper = mountForm()
    await flushPromises()

    const cards = wrapper.findAll('[data-testid="aiclaw-group-card"]')
    expect(cards[0].find('[data-testid="aiclaw-group-card-approve-button"]').exists()).toBe(true)
    expect(cards[1].find('[data-testid="aiclaw-group-card-approve-button"]').exists()).toBe(false)
  })

  it('点击「批准」保存 approved=true 并重载配置', async () => {
    const wrapper = mountForm()
    await flushPromises()

    const approveBtn = wrapper.find('[data-testid="aiclaw-group-card-approve-button"]')
    expect(approveBtn.exists()).toBe(true)
    await approveBtn.trigger('click')
    await flushPromises()

    expect(saveAiclawGroupConfigMock).toHaveBeenCalledWith(1001, 'room-2', expect.objectContaining({ approved: true }))
    expect(loadAiclawGroupConfigMock).toHaveBeenCalledWith(1001, 'room-2')
  })
})

describe('P2：表单保存 approved=false 后同步本地列表立即刷新徽章/排序', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAiclawGroupConfigListMock.mockReturnValue([
      {
        roomId: 'room-2',
        roomName: 'Beta 群',
        rateLimitPerMinute: 5,
        dailyLimit: 100,
        respondToAi: false,
        mentionRequired: true,
        approved: true
      },
      {
        roomId: 'room-1',
        roomName: 'Alpha 群',
        rateLimitPerMinute: 5,
        dailyLimit: 100,
        respondToAi: false,
        mentionRequired: true,
        approved: false
      }
    ])
  })

  const mountWithStubbedForm = () =>
    mount(AiclawGroupSettings, {
      global: {
        plugins: [i18n],
        stubs: {
          AutoFixHeightPage: { template: '<div><slot name="header" /><slot name="container" /></div>' },
          HeaderBar: true,
          AiclawGroupConfigForm: {
            name: 'AiclawGroupConfigFormStub',
            template: '<div data-testid="aiclaw-group-config-form" />',
            props: ['config', 'saving', 'adapterType', 'defaultWorkspaceDir'],
            emits: ['save']
          }
        }
      }
    })

  it('表单保存 approved=false 后重载配置并同步列表，立即显示未激活徽章', async () => {
    const wrapper = mountWithStubbedForm()
    await flushPromises()

    const forms = wrapper.findAllComponents({ name: 'AiclawGroupConfigFormStub' })
    expect(forms).toHaveLength(2)

    getAiclawGroupConfigListMock.mockReturnValue([
      {
        roomId: 'room-2',
        roomName: 'Beta 群',
        rateLimitPerMinute: 5,
        dailyLimit: 100,
        respondToAi: false,
        mentionRequired: true,
        approved: false
      },
      {
        roomId: 'room-1',
        roomName: 'Alpha 群',
        rateLimitPerMinute: 5,
        dailyLimit: 100,
        respondToAi: false,
        mentionRequired: true,
        approved: false
      }
    ])

    await forms[0].vm.$emit('save', {
      roomId: 'room-2',
      roomName: 'Beta 群',
      rateLimitPerMinute: 5,
      dailyLimit: 100,
      respondToAi: false,
      mentionRequired: true,
      approved: false
    })
    await flushPromises()

    expect(saveAiclawGroupConfigMock).toHaveBeenCalledWith(1001, 'room-2', expect.objectContaining({ approved: false }))
    expect(loadAiclawGroupConfigMock).toHaveBeenCalledWith(1001, 'room-2')

    const cards = wrapper.findAll('[data-testid="aiclaw-group-card"]')
    const betaCard = cards.find((c) => c.text().includes('Beta 群'))
    expect(betaCard).toBeDefined()
    expect(betaCard!.find('[data-testid="aiclaw-group-card-inactive-badge"]').exists()).toBe(true)
  })
})

describe('AiclawGroupSettings 群配置表单（S7 回归锁 + #51 i18n @ 转义守卫）', () => {
  beforeEach(() => {
    getAiclawGroupConfigListMock.mockReturnValue([groupConfig])
  })

  it('恰好渲染 5 个保留字段：频率限制 / 每日上限 / AI互触发 / @触发 / 已批准', async () => {
    const wrapper = mountForm()
    await flushPromises()

    const labels = wrapper.findAll('.n-form-item-label__text').map((n) => n.text())
    expect(labels).toEqual(['频率限制', '每日上限', '响应其他 AI', '需要 @ 触发', '已批准'])
    expect(labels).toHaveLength(5)
  })

  it('#51：表单文案在真实 locale JSON 下无 i18n 编译错误（裸 @ 会让此断言 RED）', async () => {
    const wrapper = mountForm()
    await flushPromises()
    expect(i18nCompileErrors()).toEqual([])
    // 表单子树真实渲染（未因 t() 抛错降级为 comment）：5 个 form-item 都在
    expect(wrapper.findAll('.n-form-item-label__text')).toHaveLength(5)
  })

  it('不存在任何 short-reply 字段（回归锁）', async () => {
    const wrapper = mountForm()
    await flushPromises()

    const html = wrapper.html().toLowerCase()
    expect(html).not.toContain('shortreply')
    expect(html).not.toContain('short_reply')
    expect(html).not.toContain('short-reply')
    expect(wrapper.text()).not.toContain('简短回复')
  })
})
