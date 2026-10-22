import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'
import AiclawGroupConfigForm from '@/components/aiclaw/AiclawGroupConfigForm.vue'
import type { AiclawGroupConfig } from '@/services/wsType'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': { aiclaw: aiclawZh }
  }
})

const baseConfig: AiclawGroupConfig & { roomId: string } = {
  roomId: 'room-1',
  rateLimitPerMinute: 5,
  dailyLimit: 100,
  respondToAi: false,
  mentionRequired: true,
  approved: false
}

const mountForm = (
  overrides?: Partial<typeof baseConfig> & { adapterType?: string; defaultWorkspaceDir?: string },
  saving = false
) =>
  mount(AiclawGroupConfigForm, {
    props: {
      config: { ...baseConfig, ...overrides },
      saving,
      adapterType: overrides?.adapterType,
      defaultWorkspaceDir: overrides?.defaultWorkspaceDir
    },
    global: {
      plugins: [i18n]
    }
  })

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

describe('AiclawGroupConfigForm 纯展示表单', () => {
  it('渲染五个保留字段且真实 locale 无 i18n 编译错误', async () => {
    const wrapper = mountForm()
    await flushPromises()

    const labels = wrapper.findAll('.n-form-item-label__text').map((n) => n.text())
    expect(labels).toEqual(['频率限制', '每日上限', '响应其他 AI', '需要 @ 触发', '已批准'])
    expect(i18nCompileErrors()).toEqual([])
  })

  it('dir-based adapter 显示工作目录输入并预填默认值', async () => {
    const wrapper = mountForm({
      adapterType: 'opencode',
      defaultWorkspaceDir: '~/.aichat/opencode/workspace/1/group/g1'
    })
    await flushPromises()

    const labels = wrapper.findAll('.n-form-item-label__text').map((n) => n.text())
    expect(labels).toContain('工作目录')

    const input = wrapper.find('[data-testid="aiclaw-group-config-workspace-dir"] .n-input__input-el')
    expect((input.element as HTMLInputElement).value).toBe('~/.aichat/opencode/workspace/1/group/g1')
  })

  it('openclaw adapter 不显示工作目录输入', async () => {
    const wrapper = mountForm({ adapterType: 'openclaw' })
    await flushPromises()

    const labels = wrapper.findAll('.n-form-item-label__text').map((n) => n.text())
    expect(labels).not.toContain('工作目录')
  })

  it('保存时 emit save 并携带当前编辑值（boolean 保持 boolean）', async () => {
    const wrapper = mountForm({
      adapterType: 'opencode',
      defaultWorkspaceDir: '~/.aichat/opencode/workspace/1/group/g1'
    })
    await flushPromises()

    // 修改频率限制
    const rateInput = wrapper.find('[data-testid="aiclaw-group-config-rate-limit"] .n-input__input-el')
    await rateInput.setValue('12')

    // 修改每日上限
    const dailyInput = wrapper.find('[data-testid="aiclaw-group-config-daily-limit"] .n-input__input-el')
    await dailyInput.setValue('200')

    // 切换三个开关
    const respondSwitch = wrapper.find('[data-testid="aiclaw-group-config-respond-ai"]')
    await respondSwitch.trigger('click')

    const mentionSwitch = wrapper.find('[data-testid="aiclaw-group-config-mention"]')
    await mentionSwitch.trigger('click')

    const approvedSwitch = wrapper.find('[data-testid="aiclaw-group-config-approved"]')
    await approvedSwitch.trigger('click')

    await wrapper.find('[data-testid="aiclaw-group-config-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('save')).toHaveLength(1)
    const payload = wrapper.emitted('save')![0][0] as typeof baseConfig
    expect(payload.roomId).toBe('room-1')
    expect(payload.rateLimitPerMinute).toBe(12)
    expect(payload.dailyLimit).toBe(200)
    expect(payload.respondToAi).toBe(true)
    expect(payload.mentionRequired).toBe(false)
    expect(payload.approved).toBe(true)
    expect(payload.workspaceDir).toBe('~/.aichat/opencode/workspace/1/group/g1')
    expect(typeof payload.respondToAi).toBe('boolean')
    expect(typeof payload.mentionRequired).toBe('boolean')
    expect(typeof payload.approved).toBe('boolean')
  })

  it('saving=true 时保存按钮显示 loading', async () => {
    const wrapper = mountForm({}, true)
    await flushPromises()

    const button = wrapper.find('[data-testid="aiclaw-group-config-save"]')
    expect(button.classes()).toContain('n-button--loading')
  })

  // #457 A14：无草稿时跟随服务端（同群配置被后台更新 → 表单同步最新值）
  it('无未保存输入时 props.config 变化 → 表单同步为最新值', async () => {
    const wrapper = mountForm()
    await flushPromises()

    await wrapper.setProps({ config: { ...baseConfig, rateLimitPerMinute: 1 } })
    await flushPromises()

    const rateInput = wrapper.find('[data-testid="aiclaw-group-config-rate-limit"] .n-input__input-el')
    expect((rateInput.element as HTMLInputElement).value).toBe('1')
  })

  // #457 A14：同群后台配置更新不得覆盖用户未保存的输入
  it('存在未保存输入时后台配置更新不重置表单', async () => {
    const wrapper = mountForm()
    await flushPromises()

    const rateInput = wrapper.find('[data-testid="aiclaw-group-config-rate-limit"] .n-input__input-el')
    await rateInput.setValue('99')

    // 其它窗口/WS 广播带来同群新配置
    await wrapper.setProps({ config: { ...baseConfig, rateLimitPerMinute: 1, dailyLimit: 7 } })
    await flushPromises()

    expect((rateInput.element as HTMLInputElement).value).toBe('99')
    // 用户随后保存，提交的是自己的草稿而不是被覆盖后的服务端值
    await wrapper.find('[data-testid="aiclaw-group-config-save"]').trigger('click')
    expect((wrapper.emitted('save')![0][0] as typeof baseConfig).rateLimitPerMinute).toBe(99)
  })

  // #457 A14：保存成功后的刷新回包（与草稿一致）视为已对齐——此后没有未保存输入，
  // 后续同群后台更新可以正常同步（不得把「已对齐」误判成永久草稿）。
  it('保存后刷新回包与草稿一致 → 采纳为新基线，后续后台更新正常同步', async () => {
    const wrapper = mountForm()
    await flushPromises()

    const rateInput = wrapper.find('[data-testid="aiclaw-group-config-rate-limit"] .n-input__input-el')
    await rateInput.setValue('99')
    await wrapper.find('[data-testid="aiclaw-group-config-save"]').trigger('click')
    const draft = wrapper.emitted('save')![0][0] as typeof baseConfig

    // 保存成功后的刷新回包 = 草稿值（服务端确认），草稿不被回滚
    await wrapper.setProps({ config: { ...baseConfig, rateLimitPerMinute: draft.rateLimitPerMinute } })
    await flushPromises()
    expect((rateInput.element as HTMLInputElement).value).toBe('99')

    // 已与服务端对齐 → 后续同群后台更新正常同步
    await wrapper.setProps({ config: { ...baseConfig, rateLimitPerMinute: 3 } })
    await flushPromises()
    expect((rateInput.element as HTMLInputElement).value).toBe('3')
  })
})
