import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

/**
 * REQ-015 #186 F1：AI 助理「编辑资料」弹窗（名称+简介）。
 * 覆盖：
 * - 初始值回填、maxlength 20/200 与创建表单一致
 * - 名称必填：空名称禁止提交（按钮 disabled + 提交守卫）
 * - 提交接线 PUT aiclawProfile，成功后 emit saved
 */

const imRequestMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: (...args: unknown[]) => imRequestMock(...args)
}))

import AiclawEditProfileForm from '@/components/aiclaw/AiclawEditProfileForm.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': { aiclaw: aiclawZh } }
})

const mountForm = (props: Record<string, unknown> = {}) =>
  mount(AiclawEditProfileForm, {
    props: { visible: true, uid: '1001', name: '旧名字', description: '旧简介', ...props },
    global: {
      plugins: [i18n],
      stubs: { teleport: true }
    }
  })

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  imRequestMock.mockReset()
  imRequestMock.mockResolvedValue({})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  ;(globalThis as any).window.$message = { success: vi.fn(), error: vi.fn() }
})

afterEach(() => {
  errorSpy.mockRestore()
})

function i18nCompileErrors(): string[] {
  return errorSpy.mock.calls
    .map((args: unknown[]) => args.map(String).join(' '))
    .filter((line: string) => /compilation error|Invalid linked format/i.test(line))
}

describe('AiclawEditProfileForm（REQ-015 #186 F1）', () => {
  it('回填初始名称与简介，maxlength 20/200，无 i18n 编译错误', async () => {
    const wrapper = mountForm()
    await flushPromises()

    const nameInput = wrapper.find('[data-testid="aiclaw-edit-profile-name"] input')
    const descInput = wrapper.find('[data-testid="aiclaw-edit-profile-description"] textarea')
    expect((nameInput.element as HTMLInputElement).value).toBe('旧名字')
    expect((descInput.element as HTMLTextAreaElement).value).toBe('旧简介')
    expect(nameInput.attributes('maxlength')).toBe('20')
    expect(descInput.attributes('maxlength')).toBe('200')
    expect(i18nCompileErrors()).toEqual([])
  })

  it('名称为空时保存按钮禁用', async () => {
    const wrapper = mountForm({ name: '' })
    await flushPromises()

    const saveBtn = wrapper.find('[data-testid="aiclaw-edit-profile-save"]')
    expect(saveBtn.attributes('disabled')).toBeDefined()
  })

  it('名称清空后再点保存也不发请求', async () => {
    const wrapper = mountForm()
    await flushPromises()

    const nameInput = wrapper.find('[data-testid="aiclaw-edit-profile-name"] input')
    await nameInput.setValue('   ')
    const saveBtn = wrapper.find('[data-testid="aiclaw-edit-profile-save"]')
    expect(saveBtn.attributes('disabled')).toBeDefined()

    const vm = wrapper.vm as any
    await vm.handleSubmit()
    expect(imRequestMock).not.toHaveBeenCalled()
  })

  it('提交接线 PUT aiclawProfile（uid 路径参数 + name/description body），成功后 emit saved', async () => {
    const wrapper = mountForm()
    await flushPromises()

    await wrapper.find('[data-testid="aiclaw-edit-profile-name"] input').setValue('新名字')
    await wrapper.find('[data-testid="aiclaw-edit-profile-description"] textarea').setValue('新简介')
    await wrapper.find('[data-testid="aiclaw-edit-profile-save"]').trigger('click')
    await flushPromises()

    expect(imRequestMock).toHaveBeenCalledTimes(1)
    expect(imRequestMock.mock.calls[0][0]).toMatchObject({
      params: { uid: '1001' },
      body: { name: '新名字', description: '新简介' }
    })
    expect(wrapper.emitted('saved')).toBeTruthy()
    expect(wrapper.emitted('saved')![0]).toEqual([{ name: '新名字', description: '新简介' }])
  })

  it('保存失败时不 emit saved', async () => {
    imRequestMock.mockRejectedValueOnce(new Error('boom'))
    const wrapper = mountForm()
    await flushPromises()

    await wrapper.find('[data-testid="aiclaw-edit-profile-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('saved')).toBeFalsy()
  })
})
