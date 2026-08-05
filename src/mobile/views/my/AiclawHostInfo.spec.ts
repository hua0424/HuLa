import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

/**
 * REQ-016 #196 F6 移动端对齐：AI 助理详情页显示主机名/IP/主人私聊工作目录；
 * 好友管理每行显示与该好友私聊的工作目录。null/缺省 → 「-」。
 */

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { uid: '1001' }, query: {} }),
  useRouter: () => ({ push: vi.fn() })
}))

const imRequestMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  imRequest: (...args: unknown[]) => imRequestMock(...args)
}))

vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({ patchCachedUserInfo: vi.fn() })
}))

import { ImUrlEnum } from '@/enums'
import AiAssistantDetail from './AiAssistantDetail.vue'
import AiclawFriends from './AiclawFriends.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': { aiclaw: aiclawZh }
  }
})

const globalStubs = {
  plugins: [i18n],
  stubs: {
    AutoFixHeightPage: { template: '<div><slot name="header" /><slot name="container" /></div>' },
    HeaderBar: true,
    AiclawEditProfileForm: true
  }
}

const detailItem = (overrides: Record<string, unknown> = {}) => ({
  uid: '1001',
  name: 'TestAI',
  avatar: '',
  description: '简介',
  authStatus: 1,
  activeStatus: 1,
  adapterType: 'opencode',
  publicPersona: '',
  createTime: Date.now(),
  hostname: 'gpu-node-01',
  ip: '192.168.8.83',
  ownerWorkspaceDir: '~/.aichat/opencode/workspace/1001/owner',
  ...overrides
})

beforeEach(() => {
  imRequestMock.mockReset()
  ;(globalThis as any).window.$message = { success: vi.fn(), error: vi.fn() }
})

describe('REQ-016 #196 F6 移动端：AI 助理详情页主机信息', () => {
  it('显示主机名/IP/主人私聊工作目录', async () => {
    imRequestMock.mockResolvedValue([detailItem()])
    const wrapper = mount(AiAssistantDetail, { global: globalStubs })
    await flushPromises()

    const hostInfo = wrapper.find('[data-testid="aiclaw-host-info"]')
    expect(hostInfo.exists()).toBe(true)
    expect(hostInfo.text()).toContain('gpu-node-01')
    expect(hostInfo.text()).toContain('192.168.8.83')
    expect(hostInfo.text()).toContain('~/.aichat/opencode/workspace/1001/owner')
  })

  it('字段为 null/缺省时显示「-」', async () => {
    imRequestMock.mockResolvedValue([detailItem({ hostname: null, ip: null, ownerWorkspaceDir: null })])
    const wrapper = mount(AiAssistantDetail, { global: globalStubs })
    await flushPromises()

    const hostInfo = wrapper.find('[data-testid="aiclaw-host-info"]')
    expect(hostInfo.exists()).toBe(true)
    expect(hostInfo.text()).toContain('-')
    expect(hostInfo.text()).not.toContain('null')
    expect(hostInfo.text()).not.toContain('undefined')
  })
})

describe('REQ-016 #196 F6 移动端：好友管理私聊工作目录', () => {
  it('每行显示 dmWorkspaceDir，null → 「-」', async () => {
    imRequestMock.mockImplementation(({ url }: { url: string }) => {
      if (url === ImUrlEnum.AICLAW_FRIENDS) {
        return Promise.resolve([
          {
            uid: '2001',
            name: '好友甲',
            avatar: '',
            account: 'acc1',
            activeStatus: 1,
            userType: 1,
            relationDesc: null,
            dmWorkspaceDir: '~/.aichat/opencode/workspace/1001/dm/2001'
          },
          {
            uid: '2002',
            name: '好友乙',
            avatar: '',
            account: 'acc2',
            activeStatus: 1,
            userType: 1,
            relationDesc: null,
            dmWorkspaceDir: null
          }
        ])
      }
      return Promise.resolve([])
    })

    const wrapper = mount(AiclawFriends, { global: globalStubs })
    await flushPromises()

    const dmDirs = wrapper.findAll('[data-testid="aiclaw-friend-dm-dir"]')
    expect(dmDirs).toHaveLength(2)
    expect(dmDirs[0].text()).toContain('~/.aichat/opencode/workspace/1001/dm/2001')
    expect(dmDirs[1].text()).toContain('-')
    expect(dmDirs[1].text()).not.toContain('null')
  })
})
