import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import homeZh from '~/locales/zh-CN/home.json'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

/**
 * REQ-017 #204 B：群通知行直读 NoticeVO.groupName/groupAvatar（server #203 契约），
 * 删掉 per-row getGroupInfo 回源（N+1）；字段缺失（旧 server/异常）回退现有回源路径。
 */

const getGroupInfoMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  getGroupInfo: (...args: unknown[]) => getGroupInfoMock(...args)
}))

const contactStoreMock = vi.hoisted(() => ({
  requestFriendsList: [] as any[],
  applyPageOptions: { isLast: true },
  getApplyPage: vi.fn().mockResolvedValue(undefined),
  onHandleInvite: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/stores/contacts.ts', () => ({ useContactStore: () => contactStoreMock }))

vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({ getUserInfo: () => ({ name: '某人', avatar: '' }) })
}))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ userInfo: { uid: 'me' } }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/hooks/useWindow', () => ({ useWindow: () => ({ createWebviewWindow: vi.fn() }) }))
vi.mock('@/utils/PlatformConstants', () => ({ isDesktop: () => false }))

import ApplyList from '@/components/rightBox/ApplyList.vue'
import { NoticeType, type NoticeItem } from '@/services/types'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': { home: homeZh, aiclaw: aiclawZh } }
})

const makeNotice = (overrides: Partial<NoticeItem>): NoticeItem =>
  ({
    applyId: 'a1',
    eventType: NoticeType.GROUP_APPLY,
    type: 1,
    roomId: 'r1',
    senderId: 'u9',
    receiverId: 'me',
    content: '',
    status: 0,
    isRead: false,
    createTime: Date.now(),
    ...overrides
  }) as NoticeItem

// Naive UI 的 NVirtualList 内部组件名是 'VirtualList'，真实组件在 happy-dom 里不渲染 slot，
// 用自定义 stub 把 items 透传给默认作用域插槽（ApplyList.aiclawNotice.spec.ts 同款先例）。
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

describe('ApplyList 群通知直读 groupName/groupAvatar（REQ-017 #204 B）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    contactStoreMock.requestFriendsList = []
  })

  it('onMounted 拉取列表并保留「点击清空未读」语义（click=true，防未读角标回潮）', async () => {
    mountList()
    await flushPromises()

    expect(contactStoreMock.getApplyPage).toHaveBeenCalledWith('group', true, true)
  })

  it('NoticeVO 带 groupName/groupAvatar：直接渲染，零回源（getGroupInfo 不调用）', async () => {
    contactStoreMock.requestFriendsList = [
      makeNotice({ groupName: 'AIChat 内测群', groupAvatar: 'http://x/group.png' })
    ]
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.text()).toContain('AIChat 内测群')
    expect(wrapper.text()).not.toContain(homeZh.apply_list.group.loading)
    const img = wrapper.find('img')
    expect(img.attributes('src')).toContain('group.png')
    expect(getGroupInfoMock).not.toHaveBeenCalled()
  })

  it('字段缺失（旧 server）：回退现有「加载中」+回源路径，不显示 null/undefined 字面量', async () => {
    getGroupInfoMock.mockResolvedValue({ name: '回源群', avatar: 'http://x/fallback.png' })
    contactStoreMock.requestFriendsList = [makeNotice({})]
    const wrapper = mountList()
    await flushPromises()

    expect(getGroupInfoMock).toHaveBeenCalledWith('r1')
    await flushPromises()
    expect(wrapper.text()).toContain('回源群')
    expect(wrapper.text()).not.toContain('undefined')
    expect(wrapper.text()).not.toContain('null')
  })

  it('groupName 为空串（异常数据）：按缺失处理走回退，不渲染空名', async () => {
    getGroupInfoMock.mockResolvedValue({ name: '回源群2', avatar: '' })
    contactStoreMock.requestFriendsList = [makeNotice({ groupName: null, groupAvatar: null })]
    const wrapper = mountList()
    await flushPromises()

    expect(getGroupInfoMock).toHaveBeenCalledWith('r1')
    await flushPromises()
    expect(wrapper.text()).toContain('回源群2')
  })
})
