import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-017 #198：RemoteLoginModal 复用为「下线通知」弹窗，按 payload.kind 区分文案：
 * 默认/remoteLogin = 异地登录（原有文案），sessionExpired = 登录状态已失效请重新登录。
 */

// storeToRefs 对非 pinia-store 的 plain mock 会丢属性，本 spec 降级为恒等（模板对 ref/plain 都能渲染）
vi.mock('pinia', async (importOriginal) => ({
  ...(await importOriginal<typeof import('pinia')>()),
  storeToRefs: (store: unknown) => store as any
}))

const getWindowPayloadMock = vi.hoisted(() => vi.fn().mockResolvedValue(null))
vi.mock('@/hooks/useWindow.ts', () => ({
  useWindow: () => ({ getWindowPayload: getWindowPayloadMock })
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: vi.fn().mockReturnValue({
    show: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    onCloseRequested: vi.fn().mockResolvedValue(vi.fn())
  }),
  WebviewWindow: { getByLabel: vi.fn().mockResolvedValue(null) }
}))

vi.mock('@/stores/setting', async () => {
  const { ref } = await import('vue')
  return {
    useSettingStore: () => ({ $state: { themes: { content: 'LIGHT' } }, themes: ref({ content: 'LIGHT' }) })
  }
})
vi.mock('@/stores/user.ts', () => ({
  useUserStore: () => ({ userInfo: { avatar: 'a.png' } })
}))
vi.mock('@/utils/PlatformConstants', () => ({ isMac: () => false }))

import RemoteLoginModal from '@/views/loginWindow/RemoteLoginModal.vue'

const mountModal = async () => {
  const wrapper = mount(RemoteLoginModal, {
    global: {
      stubs: {
        'n-config-provider': { template: '<div><slot /></div>' },
        'n-flex': { template: '<div><slot /></div>' },
        'n-button': { template: '<button><slot /></button>' }
      }
    }
  })
  await flushPromises()
  return wrapper
}

describe('RemoteLoginModal #198 sessionExpired 文案分支', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('payload 无 kind（默认）：保持异地登录文案', async () => {
    getWindowPayloadMock.mockResolvedValue({ ip: '1.2.3.4' })
    const wrapper = await mountModal()

    expect(wrapper.text()).toContain('您的账号在其他设备')
    expect(wrapper.text()).toContain('1.2.3.4')
    expect(wrapper.text()).not.toContain('登录状态已失效')
  })

  it('payload.kind = sessionExpired：显示「登录状态已失效，请重新登录」，不显示 IP', async () => {
    getWindowPayloadMock.mockResolvedValue({ kind: 'sessionExpired' })
    const wrapper = await mountModal()

    expect(wrapper.text()).toContain('登录状态已失效，请重新登录')
    expect(wrapper.text()).not.toContain('您的账号在其他设备')
    expect(wrapper.text()).not.toContain('未知IP')
  })
})
