import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'
import aiclawEn from '~/locales/en/aiclaw.json'
import componentsZh from '~/locales/zh-CN/components.json'
import componentsEn from '~/locales/en/components.json'
import { ImUrlEnum } from '@/enums'

/**
 * #394 跨平台激活码刷新确认文案与删除操作解耦。
 * 最高 seam：真实共用弹窗 + 真实 i18n 资源 + 真实对话框按钮行为。
 * 外部请求 adapter（imRequest）可替换，但不断言源码 key、不捕获孤立 dialog 配置。
 */

const imRequestMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: (...args: unknown[]) => imRequestMock(...args)
}))

import AiclawTokenDialog from '@/components/aiclaw/AiclawTokenDialog.vue'
import AiclawDeleteConfirmDialog from '@/components/aiclaw/AiclawDeleteConfirmDialog.vue'

type DialogConfig = {
  title: string
  content: string
  positiveText: string
  negativeText: string
  onPositiveClick: () => Promise<void> | void
}

function makeI18n(locale: 'zh-CN' | 'en') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: locale,
    messages: {
      'zh-CN': { aiclaw: aiclawZh, components: componentsZh },
      en: { aiclaw: aiclawEn, components: componentsEn }
    }
  })
}

let dialogWarningMock: ReturnType<typeof vi.fn>
let messageMocks: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  imRequestMock.mockReset()
  dialogWarningMock = vi.fn()
  messageMocks = { success: vi.fn(), error: vi.fn() }
  ;(globalThis as Record<string, unknown>).window ??= globalThis
  const w = window as unknown as Record<string, unknown>
  w.$dialog = { warning: dialogWarningMock }
  w.$message = messageMocks
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

function compileErrors(): string[] {
  return errorSpy.mock.calls
    .map((args: unknown[]) => args.map(String).join(' '))
    .filter((line: string) => /compilation error|Invalid linked format/i.test(line))
}

async function openRefreshDialog(locale: 'zh-CN' | 'en') {
  const i18n = makeI18n(locale)
  const wrapper = mount(AiclawTokenDialog, {
    props: { visible: true, uid: '215247446024193', token: 'OLD-ACTIVATION-TOKEN' },
    global: { plugins: [i18n], stubs: { teleport: true } }
  })
  await flushPromises()
  // 真实刷新按钮：文案来自真实资源 aiclaw.token.refresh
  const refreshLabel = String(i18n.global.t('aiclaw.token.refresh'))
  const btn = wrapper.findAll('button').find((b) => b.text().includes(refreshLabel))
  expect(btn).toBeTruthy()
  await btn!.trigger('click')
  expect(dialogWarningMock).toHaveBeenCalledTimes(1)
  const cfg = dialogWarningMock.mock.calls[0][0] as DialogConfig
  return { wrapper, i18n, cfg }
}

describe('#394 刷新确认文案（真实弹窗 + 真实资源 + 真实按钮）', () => {
  it('中文：正按钮“重新生成”，标题/说明/双按钮无“删除”误导、无 raw key', async () => {
    const { cfg } = await openRefreshDialog('zh-CN')
    expect(cfg.positiveText).toBe('重新生成')
    expect(cfg.negativeText).toBe('取消')
    for (const text of [cfg.title, cfg.content, cfg.positiveText, cfg.negativeText]) {
      expect(text).not.toContain('删除')
      expect(text).not.toContain('aiclaw.')
      expect(text).not.toContain('components.')
    }
    expect(compileErrors()).toEqual([])
  })

  it('英文：正按钮“Regenerate”，标题/说明/双按钮无“Delete”误导、无 raw key', async () => {
    const { cfg } = await openRefreshDialog('en')
    expect(cfg.positiveText).toBe('Regenerate')
    expect(cfg.negativeText).toBe('Cancel')
    for (const text of [cfg.title, cfg.content, cfg.positiveText, cfg.negativeText]) {
      expect(text).not.toContain('Delete')
      expect(text).not.toContain('delete')
      expect(text).not.toContain('aiclaw.')
      expect(text).not.toContain('components.')
    }
    expect(compileErrors()).toEqual([])
  })

  it('取消/关闭不发任何刷新请求', async () => {
    await openRefreshDialog('zh-CN')
    // 只打开确认框、不点正按钮：零请求
    expect(imRequestMock).not.toHaveBeenCalled()
  })

  it('一次确认只请求对应 uid 的刷新接口，不碰 deactivate/delete；成功显示新码+成功提示+refreshed', async () => {
    const { wrapper, i18n, cfg } = await openRefreshDialog('zh-CN')
    imRequestMock.mockResolvedValueOnce({ activationToken: 'NEW-ACTIVATION-TOKEN' })
    await cfg.onPositiveClick()
    await flushPromises()

    expect(imRequestMock).toHaveBeenCalledTimes(1)
    const arg = imRequestMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg).toMatchObject({ url: ImUrlEnum.AICLAW_REFRESH_ACTIVATION, params: { uid: '215247446024193' } })
    expect(JSON.stringify(arg)).not.toContain('deactivate')
    expect(JSON.stringify(arg)).not.toContain('delete')
    expect(messageMocks.success).toHaveBeenCalledWith(String(i18n.global.t('aiclaw.token.refresh_success')))
    expect(wrapper.emitted('refreshed')).toHaveLength(1)
    // 新激活码渲染进弹窗展示区
    expect(wrapper.text()).toContain('NEW-ACTIVATION-TOKEN')
  })

  it('请求失败不发成功提示/通知，loading 能结束', async () => {
    const { wrapper, cfg } = await openRefreshDialog('zh-CN')
    imRequestMock.mockRejectedValueOnce(new Error('network-down'))
    await cfg.onPositiveClick()
    await flushPromises()

    expect(messageMocks.success).not.toHaveBeenCalled()
    expect(wrapper.emitted('refreshed')).toBeFalsy()
    const vm = wrapper.vm as unknown as { refreshing: boolean }
    expect(vm.refreshing).toBe(false)
  })

  it('真正删除弹窗保留删除文案+密码确认，无密码不能提交（刷新不要求删除密码）', async () => {
    const i18n = makeI18n('zh-CN')
    const wrapper = mount(AiclawDeleteConfirmDialog, {
      props: { visible: true },
      global: { plugins: [i18n], stubs: { teleport: true } }
    })
    await flushPromises()
    expect(wrapper.text()).toContain(String(i18n.global.t('aiclaw.delete.confirm')))
    expect(wrapper.text()).toContain(String(i18n.global.t('aiclaw.delete.password')))
    const buttons = wrapper.findAll('button')
    const confirmBtn = buttons.find((b) => b.text().includes('确认删除'))
    expect(confirmBtn).toBeTruthy()
    expect(confirmBtn!.attributes('disabled')).toBeDefined()
    await confirmBtn!.trigger('click')
    expect(wrapper.emitted('confirm')).toBeFalsy()
  })
})
