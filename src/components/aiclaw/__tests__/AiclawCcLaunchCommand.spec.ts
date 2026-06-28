import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'
import AiclawCcLaunchCommand from '@/components/aiclaw/AiclawCcLaunchCommand.vue'
import { imRequest } from '@/utils/ImRequestUtils'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': { aiclaw: aiclawZh }
  }
})

vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: vi.fn()
}))

describe('AiclawCcLaunchCommand', () => {
  const mountCommand = (props: { roomId: string; aiclawUid?: string }) =>
    mount(AiclawCcLaunchCommand, {
      props,
      global: {
        plugins: [i18n]
      }
    })

  let writeTextSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.mocked(imRequest).mockReset()
    writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    errorSpy.mockRestore()
  })

  it('挂载后调用接口并展示启动命令和工作目录', async () => {
    vi.mocked(imRequest).mockResolvedValue({
      launchCommand: 'claude --dir /workspace/p1 --room room-1',
      workspaceDir: '/workspace/p1'
    })

    const wrapper = mountCommand({ roomId: 'room-1', aiclawUid: '1001' })
    await flushPromises()

    expect(imRequest).toHaveBeenCalledTimes(1)
    expect(imRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { roomId: 'room-1', uid: '1001' }
      })
    )

    const commandInput = wrapper.find('[data-testid="aiclaw-cc-launch-command"] .n-input__textarea-el')
    expect((commandInput.element as HTMLTextAreaElement).value).toBe('claude --dir /workspace/p1 --room room-1')

    const workspaceInput = wrapper.find('[data-testid="aiclaw-cc-launch-workspace-dir"] .n-input__input-el')
    expect((workspaceInput.element as HTMLInputElement).value).toBe('/workspace/p1')
  })

  it('未传 aiclawUid 时不带 uid 参数请求', async () => {
    vi.mocked(imRequest).mockResolvedValue({
      launchCommand: 'claude --room room-2',
      workspaceDir: '/workspace/p2'
    })

    mountCommand({ roomId: 'room-2' })
    await flushPromises()

    expect(imRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { roomId: 'room-2' }
      })
    )
  })

  it('点击复制按钮调用 clipboard.writeText', async () => {
    vi.mocked(imRequest).mockResolvedValue({
      launchCommand: 'claude --room room-3',
      workspaceDir: '/workspace/p3'
    })

    const wrapper = mountCommand({ roomId: 'room-3' })
    await flushPromises()

    const copyButton = wrapper.find('[data-testid="aiclaw-cc-launch-copy"]')
    await copyButton.trigger('click')
    await flushPromises()

    expect(writeTextSpy).toHaveBeenCalledWith('claude --room room-3')
  })

  it('接口失败时展示错误提示和重试按钮', async () => {
    vi.mocked(imRequest).mockRejectedValue(new Error('network'))

    const wrapper = mountCommand({ roomId: 'room-4' })
    await flushPromises()

    expect(wrapper.text()).toContain('获取启动命令失败')

    vi.mocked(imRequest).mockResolvedValue({
      launchCommand: 'claude --room room-4',
      workspaceDir: '/workspace/p4'
    })
    const retryButton = wrapper.find('[data-testid="aiclaw-cc-launch-retry"]')
    await retryButton.trigger('click')
    await flushPromises()

    const commandInput = wrapper.find('[data-testid="aiclaw-cc-launch-command"] .n-input__textarea-el')
    expect((commandInput.element as HTMLTextAreaElement).value).toBe('claude --room room-4')
  })
})
