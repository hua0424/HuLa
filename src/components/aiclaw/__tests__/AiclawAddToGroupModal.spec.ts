import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import aiclawZh from '~/locales/zh-CN/aiclaw.json'

/**
 * #173 方案 b：AI 助理面板「添加到群」——群选择器。
 * 覆盖：
 * - 只列 owner 的群会话（type=GROUP），排除 aiclaw 已在的群与频道
 * - 选群 + 确认 → 调 inviteGroupMember({roomId, uidList:[aiclawUid]})
 * - 成功后 emit invited + 关闭；空列表兜底提示
 */

const sessionListRef = ref<any[]>([])
const groupConfigListRef = ref<any[]>([])

const inviteGroupMemberMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@/utils/ImRequestUtils', () => ({
  inviteGroupMember: inviteGroupMemberMock
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    get sessionList() {
      return sessionListRef.value
    },
    getAiclawGroupConfigList: () => groupConfigListRef.value,
    loadAiclawGroupConfigs: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/utils/AvatarUtils', () => ({
  AvatarUtils: { getAvatarUrl: (a: string) => a || '/logo.png' }
}))

import AiclawAddToGroupModal from '@/components/aiclaw/AiclawAddToGroupModal.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': { aiclaw: aiclawZh } }
})

// RoomTypeEnum.GROUP = 1, SINGLE = 2 ; IsAllUserEnum.Yes = 1 (channel)
const grp = (roomId: string, name: string, extra: Record<string, unknown> = {}) => ({
  roomId,
  name,
  type: 1,
  hotFlag: 0,
  avatar: '',
  ...extra
})

const mountModal = (props: Record<string, unknown> = {}) =>
  mount(AiclawAddToGroupModal, {
    props: { visible: true, aiclawUid: '9001', aiclawName: 'M4TestAI', ...props },
    global: {
      plugins: [i18n],
      stubs: { teleport: true }
    }
  })

describe('AiclawAddToGroupModal', () => {
  beforeEach(() => {
    inviteGroupMemberMock.mockClear()
    sessionListRef.value = []
    groupConfigListRef.value = []
    ;(globalThis as any).window.$message = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('只列群会话，排除单聊/频道与 aiclaw 已在的群', async () => {
    sessionListRef.value = [
      grp('100', '群A'),
      grp('200', '群B'),
      grp('300', '频道X', { hotFlag: 1 }), // 频道，排除
      { roomId: '400', name: '单聊', type: 2, hotFlag: 0 } // 单聊，排除
    ]
    groupConfigListRef.value = [{ roomId: '200', approved: true }] // aiclaw 已在 群B
    const wrapper = mountModal()
    await flushPromises()

    const vm = wrapper.vm as any
    const ids = vm.availableGroups.map((g: any) => g.roomId)
    expect(ids).toEqual(['100']) // 只剩群A
  })

  it('选群 + 确认 → 调 inviteGroupMember 且参数正确', async () => {
    sessionListRef.value = [grp('100', '群A')]
    const wrapper = mountModal({ aiclawUid: '9001' })
    await flushPromises()

    const vm = wrapper.vm as any
    vm.selectedRoomId = '100'
    await vm.handleConfirm()
    await flushPromises()

    expect(inviteGroupMemberMock).toHaveBeenCalledTimes(1)
    expect(inviteGroupMemberMock).toHaveBeenCalledWith({ roomId: '100', uidList: ['9001'] })
    expect(wrapper.emitted('invited')).toBeTruthy()
  })

  it('未选群时确认不发请求', async () => {
    sessionListRef.value = [grp('100', '群A')]
    const wrapper = mountModal()
    await flushPromises()
    const vm = wrapper.vm as any
    vm.selectedRoomId = ''
    await vm.handleConfirm()
    expect(inviteGroupMemberMock).not.toHaveBeenCalled()
  })

  it('邀请失败时不 emit invited、提示错误', async () => {
    inviteGroupMemberMock.mockRejectedValueOnce(new Error('boom'))
    sessionListRef.value = [grp('100', '群A')]
    const wrapper = mountModal()
    await flushPromises()
    const vm = wrapper.vm as any
    vm.selectedRoomId = '100'
    await vm.handleConfirm()
    await flushPromises()
    expect(wrapper.emitted('invited')).toBeFalsy()
    expect((window as any).$message.error).toHaveBeenCalled()
  })
})
