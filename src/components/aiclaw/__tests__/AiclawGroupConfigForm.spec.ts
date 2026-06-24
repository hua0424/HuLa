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

  it('props.config 变化时表单重置为最新值', async () => {
    const wrapper = mountForm()
    await flushPromises()

    const rateInput = wrapper.find('[data-testid="aiclaw-group-config-rate-limit"] .n-input__input-el')
    await rateInput.setValue('99')

    await wrapper.setProps({ config: { ...baseConfig, rateLimitPerMinute: 1 } })
    await flushPromises()

    expect((rateInput.element as HTMLInputElement).value).toBe('1')
  })
})
