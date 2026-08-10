import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoticeItem } from '@/services/types'
import { NoticeType, RequestNoticeAgreeStatus } from '@/services/types'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'
import mymessageZh from '~/locales/zh-CN/mobile_mymessage.json'

/**
 * aichatoverview#232：移动端 MobileApplyList 历史通知（2026-07-13 前数据）缺 senderName、
 * 且群成员缓存查不到时，裸回退「未知用户」。对齐桌面 #66/#211 resolveNameOrUid 模式：
 * getUserInfo（含 senderName 兜底）→ uid 标识，最后才「未知用户」。
 */

// ref-driven：各用例独立控制通知列表与 store 查找结果
const requestFriendsListRef = ref<NoticeItem[]>([])
const getUserInfoMock = vi.fn((_uid: string): any => null)

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

vi.mock('@/utils/ImRequestUtils', () => ({
  getGroupInfo: vi.fn().mockResolvedValue({ name: '测试群', avatar: '' })
}))

import MobileApplyList from '@/mobile/components/my/MobileApplyList.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {
    'zh-CN': { aiclaw: aiclawZh, mobile_mymessage: mymessageZh }
  }
})

// Naive UI 的 NVirtualList 内部组件名是 'VirtualList'，真实组件在 happy-dom 里不渲染 slot，
// 用自定义 stub 把 items 透传给默认作用域插槽（先例：ApplyList.aiclawNotice.spec.ts）。
const VirtualListStub = {
  props: ['items'],
  template: '<div><div v-for="item in items" :key="item.id"><slot :item="item" /></div></div>'
}

const baseNotice: NoticeItem = {
  id: 'n-1',
  eventType: NoticeType.FRIEND_APPLY,
  type: 2,
  senderId: '2002',
  senderName: '安洁',
  receiverId: '1001',
  applyId: '0',
  roomId: '3001',
  operateId: '2002',
  content: '',
  status: RequestNoticeAgreeStatus.UNTREATED,
  isRead: false,
  createTime: Date.now()
}

const mountList = (type: 'friend' | 'group') =>
  mount(MobileApplyList, {
    props: { type },
    global: {
      plugins: [i18n],
      renderStubDefaultSlot: true,
      stubs: {
        VirtualList: VirtualListStub
      }
    }
  })

describe('#232 历史通知缺 senderName 的 uid 回退（移动端对齐桌面 #211）', () => {
  beforeEach(() => {
    getUserInfoMock.mockReset().mockReturnValue(null)
  })

  afterEach(() => {
    requestFriendsListRef.value = []
  })

  it('好友申请（FRIEND_APPLY）：store 查不到且无 senderName → 名字列回退 operateId', async () => {
    requestFriendsListRef.value = [
      { ...baseNotice, id: 'f-1', senderName: undefined, senderAvatar: undefined } as NoticeItem
    ]

    const wrapper = mountList('friend')
    await flushPromises()

    expect(wrapper.text()).toContain('2002')
    expect(wrapper.text()).not.toContain('未知用户')
  })

  it('AI 入群批准（AICLAW_GROUP_APPROVE）：缺 senderName → 标题与名字列回退 operateId', async () => {
    requestFriendsListRef.value = [
      {
        ...baseNotice,
        id: 'g-1',
        type: 1,
        eventType: NoticeType.AICLAW_GROUP_APPROVE,
        senderId: '2001',
        operateId: '2001',
        senderName: undefined,
        senderAvatar: undefined
      } as NoticeItem
    ]

    const wrapper = mountList('group')
    await flushPromises()

    expect(wrapper.text()).toContain('2001')
    expect(wrapper.text()).not.toContain('未知用户')
  })

  it('群邀请（GROUP_INVITE）：缺 senderName → 邀请人回退 operateId（不再「未知用户」）', async () => {
    requestFriendsListRef.value = [
      {
        ...baseNotice,
        id: 'g-2',
        type: 1,
        eventType: NoticeType.GROUP_INVITE,
        senderId: '2003',
        operateId: '2004',
        senderName: undefined
      } as NoticeItem
    ]

    const wrapper = mountList('group')
    await flushPromises()

    expect(wrapper.text()).toContain('2004')
    expect(wrapper.text()).not.toContain('未知用户')
  })

  it('移出群聊（GROUP_MEMBER_DELETE）：缺 senderName → 处理人/操作人回退 senderId', async () => {
    requestFriendsListRef.value = [
      {
        ...baseNotice,
        id: 'g-3',
        type: 1,
        eventType: NoticeType.GROUP_MEMBER_DELETE,
        senderId: '2005',
        operateId: '2006',
        senderName: undefined
      } as NoticeItem
    ]

    const wrapper = mountList('group')
    await flushPromises()

    expect(wrapper.text()).toContain('2005')
    expect(wrapper.text()).not.toContain('未知用户')
  })

  it('AI 好友申请（ADD_ME + receiverUserType=4）：申请人缺名回退 senderId、AI 名缺 receiverName 回退 operateId', async () => {
    requestFriendsListRef.value = [
      {
        ...baseNotice,
        id: 'f-2',
        eventType: NoticeType.ADD_ME,
        senderId: '2007',
        operateId: '2008',
        receiverUserType: 4,
        senderName: undefined,
        receiverName: undefined
      } as unknown as NoticeItem
    ]

    const wrapper = mountList('friend')
    await flushPromises()

    expect(wrapper.text()).toContain('2007')
    expect(wrapper.text()).toContain('2008')
    expect(wrapper.text()).not.toContain('未知用户')
  })

  it('既有优先级不变：store 命中时显示缓存名（最高优先）', async () => {
    getUserInfoMock.mockImplementation((uid: string): any => (String(uid) === '2002' ? { name: '缓存名' } : null))
    requestFriendsListRef.value = [{ ...baseNotice, id: 'f-3', senderName: undefined } as NoticeItem]

    const wrapper = mountList('friend')
    await flushPromises()

    expect(wrapper.text()).toContain('缓存名')
    expect(wrapper.text()).not.toContain('2002')
  })

  it('既有优先级不变：store 查不到但 senderName 存在时显示 senderName（uid 之前）', async () => {
    requestFriendsListRef.value = [{ ...baseNotice, id: 'f-4', senderName: '安洁' }]

    const wrapper = mountList('friend')
    await flushPromises()

    expect(wrapper.text()).toContain('安洁')
    expect(wrapper.text()).not.toContain('2002')
  })
})
