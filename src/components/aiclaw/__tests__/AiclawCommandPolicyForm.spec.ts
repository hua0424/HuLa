import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

const api = vi.hoisted(() => ({ getCommandPolicy: vi.fn(), putCommandPolicy: vi.fn() }))
vi.mock('@/services/agentCommands', () => api)
import AiclawCommandPolicyForm from '@/components/aiclaw/AiclawCommandPolicyForm.vue'
import type { CommandPolicy } from '@/services/agentCommands'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': { aiclaw: aiclawZh }
  }
})

const message = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

const policy: CommandPolicy = {
  defaults: [{ roomId: 0, capabilityId: 'skill:*', state: 'open' }],
  rows: [
    {
      roomId: 192033499994624,
      capabilityId: 'skill:x',
      state: 'approval_required',
      mode: 'list',
      allowedUids: [1],
      version: 3
    }
  ],
  effective: { 'skill:x': 'approval_required' }
}

const mountForm = (roomId?: string) =>
  mount(AiclawCommandPolicyForm, {
    props: { aiclawUid: 'agent', roomId },
    global: { plugins: [i18n] }
  })

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  api.getCommandPolicy.mockReset().mockResolvedValue(policy)
  api.putCommandPolicy.mockReset().mockResolvedValue({})
  message.success.mockReset()
  message.error.mockReset()
  Object.defineProperty(window, '$message', { value: message, configurable: true, writable: true })
})

afterEach(() => {
  errorSpy.mockRestore()
})

describe('AiclawCommandPolicyForm 主人命令权限表单（aichatoverview#504）', () => {
  it('群范围：读覆盖行、显名单模式与名单外提示', async () => {
    const wrapper = mountForm('192033499994624')
    await flushPromises()
    expect(api.getCommandPolicy).toHaveBeenCalledExactlyOnceWith({
      aiclawUid: 'agent',
      roomId: '192033499994624'
    })
    expect(wrapper.find('[data-testid="aiclaw-command-policy-scope-group"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="aiclaw-command-policy-row-skill:x"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="aiclaw-command-policy-mode-skill:x"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="aiclaw-command-policy-uids-skill:x"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('名单外用户在该群内不可调用')
  })

  it('默认范围：只读默认徽标、无名单模式', async () => {
    const wrapper = mountForm()
    await flushPromises()
    expect(api.getCommandPolicy).toHaveBeenCalledExactlyOnceWith({ aiclawUid: 'agent' })
    expect(wrapper.text()).toContain('默认')
    expect(wrapper.find('[data-testid^="aiclaw-command-policy-mode-"]').exists()).toBe(false)
  })

  it('保存携带版本；版本冲突映射专用提示', async () => {
    const wrapper = mountForm('192033499994624')
    await flushPromises()
    await wrapper.find('[data-testid="aiclaw-command-policy-save-skill:x"]').trigger('click')
    await flushPromises()
    expect(api.putCommandPolicy).toHaveBeenCalledExactlyOnceWith({
      aiclawUid: 'agent',
      roomId: '192033499994624',
      items: [{ capabilityId: 'skill:x', state: 'approval_required', mode: 'list', allowedUids: [1], version: 3 }]
    })
    expect(message.success).toHaveBeenCalledTimes(1)

    api.putCommandPolicy.mockRejectedValueOnce(new Error('version_conflict'))
    await wrapper.find('[data-testid="aiclaw-command-policy-save-skill:x"]').trigger('click')
    await flushPromises()
    expect(message.error).toHaveBeenCalledExactlyOnceWith('已被他人修改，请刷新后重试')
  })
})
