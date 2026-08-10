import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoticeItem } from '@/services/types'
import { NoticeType, RequestNoticeAgreeStatus } from '@/services/types'
import { emitTo } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'
import homeZh from '~/locales/zh-CN/home.json'

const aiclawUid = '2001'
const roomId = '3001'

const aiclawNotice: NoticeItem = {
  id: 'n-1',
  eventType: NoticeType.AICLAW_GROUP_APPROVE,
  type: 1,
  senderId: aiclawUid,
  senderName: '安洁',
  receiverId: '1001',
  applyId: '0',
  roomId,
  operateId: aiclawUid,
  content: 'Test Group',
  status: RequestNoticeAgreeStatus.UNTREATED,
  isRead: false,
  createTime: Date.now()
}

// #211：2026-07-13 前的历史通知缺 senderName/senderAvatar 字段
const historicalNotice: NoticeItem = {
  ...aiclawNotice,
  id: 'n-old',
  senderName: undefined,
  senderAvatar: undefined
}

// ref-driven：让各用例独立控制通知列表与 store 查找结果
const requestFriendsListRef = ref<NoticeItem[]>([aiclawNotice])
const getUserInfoMock = vi.fn((uid: string): any => (String(uid) === aiclawUid ? { name: '安洁', avatar: '' } : null))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('@/stores/user', () => ({
  useUserStore: () => ({ userInfo: { uid: '1001' } })
}))

vi.mock('@/stores/contacts', () => ({
  useContactStore: () => ({
    get requestFriendsList() {
      return requestFriendsListRef.value
    },
    applyPageOptions: { isLast: true },
    getApplyPage: vi.fn(),
    onHandleInvite: vi.fn()
  })
}))

vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    getUserInfo: (uid: string) => getUserInfoMock(uid)
  })
}))

const createWebviewWindow = vi.fn()
vi.mock('@/hooks/useWindow', () => ({
  useWindow: () => ({ createWebviewWindow })
}))

vi.mock('@/utils/PlatformConstants', () => ({
  isDesktop: () => true,
  isWeb: () => false,
  isMobile: () => false
}))

vi.mock('@/utils/ImRequestUtils', () => ({
  getGroupInfo: vi.fn().mockResolvedValue({ name: '测试群', avatar: '' })
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: {
    getByLabel: vi.fn().mockResolvedValue(null)
  }
}))

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn().mockResolvedValue(undefined)
}))

import ApplyList from '@/components/rightBox/ApplyList.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': { aiclaw: aiclawZh, home: homeZh }
  }
})

// Naive UI 的 NVirtualList 内部组件名是 'VirtualList'，真实组件在 happy-dom 里不渲染 slot，
// 用自定义 stub 把 items 透传给默认作用域插槽。
const VirtualListStub = {
  props: ['items'],
  template: '<div><div v-for="item in items" :key="item.id"><slot :item="item" /></div></div>'
}

const mountList = () =>
  mount(ApplyList, {
    props: { type: 'group' },
    global: {
      plugins: [i18n],
      renderStubDefaultSlot: true,
      stubs: {
        VirtualList: VirtualListStub
      }
    }
  })

describe('ApplyList #88 AI 助理入群待批准通知', () => {
  beforeEach(() => {
    createWebviewWindow.mockClear()
    ;(WebviewWindow.getByLabel as any).mockResolvedValue(null)
    ;(emitTo as any).mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('渲染 type=11 通知的“去批准”按钮', async () => {
    const wrapper = mountList()
    await flushPromises()

    const action = wrapper.find('[data-testid="aiclaw-notice-approve-action"]')
    expect(action.exists()).toBe(true)
    expect(action.text()).toBe('去批准')
  })

  it('点击“去批准”按钮会触发 handleAiclawApprove', async () => {
    const wrapper = mountList()
    await flushPromises()

    const spy = vi.spyOn(wrapper.vm as any, 'handleAiclawApprove').mockResolvedValue(undefined)
    const action = wrapper.find('[data-testid="aiclaw-notice-approve-action"]')
    await action.trigger('click')
    await flushPromises()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(aiclawNotice)
  })

  it('桌面端 handleAiclawApprove 打开新的 AI 助理窗口并携带目标参数', async () => {
    const wrapper = mountList()
    await flushPromises()

    await (wrapper.vm as any).handleAiclawApprove(aiclawNotice)
    await flushPromises()

    expect(createWebviewWindow).toHaveBeenCalledTimes(1)
    const lastArg = createWebviewWindow.mock.calls[0][10]
    expect(lastArg).toEqual({ aiclawUid, roomId })
  })

  it('若 AI 助理窗口已存在，则发射聚焦事件而不是新建窗口', async () => {
    const setFocus = vi.fn().mockResolvedValue(undefined)
    ;(WebviewWindow.getByLabel as any).mockResolvedValue({ setFocus })

    const wrapper = mountList()
    await flushPromises()

    await (wrapper.vm as any).handleAiclawApprove(aiclawNotice)
    await flushPromises()

    expect(createWebviewWindow).not.toHaveBeenCalled()
    expect(emitTo).toHaveBeenCalledTimes(1)
    expect(emitTo).toHaveBeenCalledWith('aiAssistant', 'aiclaw:approve-target', { aiclawUid, roomId })
    expect(setFocus).toHaveBeenCalledTimes(1)
  })
})

describe('#211 历史通知缺 senderName 的名字回退链', () => {
  beforeEach(() => {
    requestFriendsListRef.value = [historicalNotice]
    getUserInfoMock.mockReset().mockReturnValue(null)
  })

  afterEach(() => {
    requestFriendsListRef.value = [aiclawNotice]
    getUserInfoMock
      .mockReset()
      .mockImplementation((uid: string): any => (String(uid) === aiclawUid ? { name: '安洁', avatar: '' } : null))
  })

  it('store 查不到且无 senderName → 回退 operateId（不再渲染「未知用户」）', async () => {
    const wrapper = mountList()
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain(aiclawUid)
    expect(text).not.toContain('未知用户')
  })

  it('store 查不到但有 senderName → 仍用 senderName（既有 fallback 回归锁）', async () => {
    requestFriendsListRef.value = [aiclawNotice]
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.text()).toContain('安洁')
    expect(wrapper.text()).not.toContain('未知用户')
  })
})
