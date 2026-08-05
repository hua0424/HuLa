import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import homeZh from '~/locales/zh-CN/home.json'

/**
 * REQ-016 #194 F2：桌面 InfoPopover 补 uid + 简介(resume) 两行（account 已有）。
 * 简介为空显示「-」；缓存无 resume 时 onMounted 经 getUserByIds 补拉并回填缓存。
 */

// storeToRefs 对非 pinia-store 的 plain mock 会丢属性（内部走 toRefs(store.$state)），
// 本 spec 里统一降级为恒等：模板对 ref/plain 都能正常渲染
vi.mock('pinia', async (importOriginal) => ({
  ...(await importOriginal<typeof import('pinia')>()),
  storeToRefs: (store: unknown) => store as any
}))

const groupStoreMocks = vi.hoisted(() => ({
  user: {
    uid: '1001',
    name: '安洁',
    account: 'anjie001',
    avatar: 'a.png',
    activeStatus: 1,
    resume: '全栈开发助手'
  } as any,
  patchCachedUserInfo: vi.fn()
}))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    getUserInfo: (uid: string) => (String(uid) === '1001' ? groupStoreMocks.user : undefined),
    patchCachedUserInfo: groupStoreMocks.patchCachedUserInfo
  })
}))

vi.mock('@/stores/cached', () => ({ useCachedStore: () => ({ badgeById: () => undefined }) }))
vi.mock('@/stores/chat', () => ({ useChatStore: () => ({ isGroup: false }) }))
vi.mock('@/stores/contacts', () => ({ useContactStore: () => ({ contactsList: [] }) }))
vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({ currentSessionRoomId: 'room-1', addFriendModalInfo: { show: false } })
}))
vi.mock('@/stores/setting', () => ({
  useSettingStore: () => ({ $state: { themes: { content: 'LIGHT' } }, themes: { content: 'LIGHT' } })
}))
// storeToRefs 对 userStatusStore.stateList 同样需要 $state
vi.mock('@/stores/userStatus', () => ({
  useUserStatusStore: () => ({ $state: { stateList: [] }, stateList: [] })
}))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ userInfo: { uid: '999' } }) }))
vi.mock('@/hooks/useCommon', () => ({
  useCommon: () => ({ userUid: { value: '999' }, openMsgSession: vi.fn() })
}))
vi.mock('@/hooks/useWindow', () => ({ useWindow: () => ({ createWebviewWindow: vi.fn() }) }))
vi.mock('@/layout/left/hook', () => ({ leftHook: () => ({ openContent: vi.fn() }) }))
vi.mock('@/hooks/useMitt', () => ({ useMitt: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }))

const getUserByIdsMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({
  getUserByIds: (...args: unknown[]) => getUserByIdsMock(...args)
}))

import InfoPopover from '@/components/common/InfoPopover.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': { home: homeZh } }
})

const mountPopover = () =>
  mount(InfoPopover, {
    props: { uid: '1001', activeStatus: 1 },
    global: { plugins: [i18n] }
  })

/** 动态 import('@/utils/ImRequestUtils') 的解析超出单轮 flushPromises，多等一个宏任务 */
const flushAll = async () => {
  await flushPromises()
  await new Promise((r) => setTimeout(r, 10))
  await flushPromises()
}

describe('InfoPopover uid/简介（REQ-016 #194 F2）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    groupStoreMocks.user = {
      uid: '1001',
      name: '安洁',
      account: 'anjie001',
      avatar: 'a.png',
      activeStatus: 1,
      resume: '全栈开发助手'
    }
    getUserByIdsMock.mockResolvedValue([])
  })

  it('显示 uid 行', async () => {
    const wrapper = mountPopover()
    await flushAll()

    const uidRow = wrapper.find('[data-testid="info-popover-uid"]')
    expect(uidRow.exists()).toBe(true)
    expect(uidRow.text()).toContain('1001')
  })

  it('显示简介行（缓存有 resume 时直接渲染）', async () => {
    const wrapper = mountPopover()
    await flushAll()

    const resumeRow = wrapper.find('[data-testid="info-popover-resume"]')
    expect(resumeRow.exists()).toBe(true)
    expect(resumeRow.text()).toContain('全栈开发助手')
  })

  it('简介为空时显示「-」', async () => {
    groupStoreMocks.user.resume = ''
    const wrapper = mountPopover()
    await flushAll()

    const resumeRow = wrapper.find('[data-testid="info-popover-resume"]')
    expect(resumeRow.exists()).toBe(true)
    expect(resumeRow.text()).toContain('-')
  })

  it('缓存无 resume 字段时经 getUserByIds 补拉并回填缓存', async () => {
    delete groupStoreMocks.user.resume
    getUserByIdsMock.mockResolvedValue([{ uid: '1001', name: '安洁', avatar: 'a.png', resume: '补拉简介' }])

    mountPopover()
    await flushAll()

    expect(getUserByIdsMock).toHaveBeenCalledWith(['1001'])
    expect(groupStoreMocks.patchCachedUserInfo).toHaveBeenCalledWith(
      '1001',
      expect.objectContaining({ resume: '补拉简介' })
    )
  })

  it('补拉失败时不炸、简介行显示「-」', async () => {
    delete groupStoreMocks.user.resume
    getUserByIdsMock.mockRejectedValue(new Error('network'))

    const wrapper = mountPopover()
    await flushAll()

    const resumeRow = wrapper.find('[data-testid="info-popover-resume"]')
    expect(resumeRow.exists()).toBe(true)
    expect(resumeRow.text()).toContain('-')
  })
})
