import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * #484 T3：成员权限与 aiclaw 配置当前事实的有界校准。
 *
 * 断言的都是「契约」而不是实现细节：
 * - 成员变更通知只作失效提示，事实来自一次当前读；旧包不能直接改 roleId/人数/成员表；
 * - 当前读按 coverage 收敛（未覆盖 UID 保持 unknown，不因为「本页没看到」就删成员）；
 * - 可信 NOT_ACCESSIBLE 才退场；传输/格式失败保留上次可信值并标未校准（保留后续机会）；
 * - 代次/账号切换使旧在飞结果失去提交资格。
 */
vi.hoisted(() => {
  class WorkerStub {
    onerror: ((e: unknown) => void) | null = null
    postMessage() {}
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  }
  globalThis.Worker = WorkerStub as unknown as typeof Worker
})

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getByLabel: vi.fn().mockResolvedValue(null), getCurrent: vi.fn() }
}))
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))
vi.mock('@tauri-apps/plugin-notification', () => ({
  sendNotification: vi.fn(),
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue('granted')
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/message' }),
  useRouter: () => ({ push: vi.fn() })
}))
vi.mock('@/utils/RenderReplyContent.ts', () => ({
  renderReplyContent: vi.fn().mockImplementation((_name, _type, content) => content)
}))
vi.mock('@/utils/UnreadCountManager', () => ({
  unreadCountManager: {
    refreshBadge: vi.fn(),
    calculateTotal: vi.fn(),
    setUpdateCallback: vi.fn(),
    requestUpdate: vi.fn()
  }
}))
vi.mock('@/utils/TauriInvokeHandler', () => ({
  invokeWithErrorHandler: vi.fn().mockResolvedValue(undefined),
  invokeSilently: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/stores/feed', () => ({
  useFeedStore: () => ({})
}))
vi.mock('@/stores/sessionUnread', () => ({
  useSessionUnreadStore: () => ({ apply: vi.fn().mockReturnValue({}), set: vi.fn(), remove: vi.fn() })
}))

// 只替换「当前读」这一个出口，其它导出保持真实实现（避免整模块 mock 让测试失去意义）
const groupUseStateMock = vi.hoisted(() => vi.fn())
const groupListMemberMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    groupUseState: (...args: unknown[]) => groupUseStateMock(...args),
    groupListMember: (...args: unknown[]) => groupListMemberMock(...args)
  }
})

import { useGroupStore } from '@/stores/group'
import { useGlobalStore } from '@/stores/global'
import { useUserStore } from '@/stores/user'
import { sessionBinding } from '@/services/sessionBinding'

const ROOM = '484'

/** 服务端 MEMBER 信封（字段名与 GroupUseStateResp 对齐） */
const memberEnvelope = (overrides: Record<string, unknown> = {}) => ({
  outcome: 'MEMBER',
  roomId: ROOM,
  selfUid: '1',
  selfRoleId: 2,
  memberCount: 40,
  groupName: 'G',
  account: 'acc',
  remark: '',
  myName: '',
  allowScanEnter: false,
  requestedMembers: [
    { uid: '1', exists: true, roleId: 2, name: 'Me', account: 'acc' },
    { uid: '2', exists: true, roleId: 3, name: 'Bob', account: 'acc' },
    { uid: '3', exists: false }
  ],
  coverage: { requested: 3, covered: 3, limit: 100, truncated: false },
  ...overrides
})

/** 直接写入本地成员表/群详情，模拟「上一份可信快照」 */
const seedMembers = (groupStore: ReturnType<typeof useGroupStore>) => {
  groupStore.updateMemberCache(ROOM, [
    { uid: '1', name: 'Me', account: 'acc', roleId: 3, activeStatus: 1, lastOptTime: 0, avatar: '' },
    { uid: '2', name: 'Bob', account: 'acc', roleId: 3, activeStatus: 1, lastOptTime: 0, avatar: '' },
    { uid: '3', name: 'Cara', account: 'acc', roleId: 3, activeStatus: 1, lastOptTime: 0, avatar: '' }
  ] as never)
  seedDetail(groupStore)
}
const seedDetail = (groupStore: ReturnType<typeof useGroupStore>, memberNum = 3) => {
  groupStore.groupDetails.push({
    roomId: ROOM,
    groupName: 'G',
    memberNum,
    onlineNum: memberNum,
    account: 'acc',
    avatar: '',
    roleId: 3
  } as never)
}

describe('groupStore 当前读校准（#484）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    groupUseStateMock.mockReset()
    groupListMemberMock.mockReset()
    sessionBinding.value = null
    const userStore = useUserStore()
    userStore.userInfo = { uid: '1', name: 'Me' } as never
    const globalStore = useGlobalStore()
    globalStore.updateCurrentSessionRoomId(ROOM)
  })

  it('提示只作失效：旧包不能直接改人数与角色，成员事实来自一次当前读', async () => {
    const groupStore = useGroupStore()
    seedDetail(groupStore)
    groupUseStateMock.mockResolvedValue(memberEnvelope())

    // WS_MEMBER_CHANGE 的旧包路径现在是 invalidate + ensureGroupUse
    groupStore.invalidateGroupUse(ROOM, 'member-count')
    await groupStore.ensureGroupUse(ROOM)

    expect(groupStore.getGroupDetailByRoomId(ROOM)?.memberNum).toBe(40)
    // 读取前的本地角色（3）不允许保留：本人角色以当前读为准（2）
    expect(groupStore.myRoleIdInCurrentGroup).toBe(2)
  })

  it('按 coverage 收敛：未被覆盖的成员保持 unknown，不因「本页没看到」被删', async () => {
    const groupStore = useGroupStore()
    seedMembers(groupStore)
    // 只请求/覆盖 uid 2；uid 1、3 不在本次 coverage 内
    groupUseStateMock.mockResolvedValue(
      memberEnvelope({
        requestedMembers: [{ uid: '2', exists: true, roleId: 2, name: 'Bob', account: 'acc' }],
        coverage: { requested: 1, covered: 1, limit: 100, truncated: false }
      })
    )

    await groupStore.ensureGroupUse(ROOM)

    const uids = (groupStore.userListMap[ROOM] ?? []).map((m) => m.uid).sort()
    expect(uids).toEqual(['1', '2', '3'])
    expect((groupStore.userListMap[ROOM] ?? []).find((m) => m.uid === '2')?.roleId).toBe(2)
    // 未被覆盖的成员角色保持原值（不猜测、不清空）
    expect((groupStore.userListMap[ROOM] ?? []).find((m) => m.uid === '3')?.roleId).toBe(3)
  })

  it('exists=false 才移除成员（可信缺席），其余保持', async () => {
    const groupStore = useGroupStore()
    seedMembers(groupStore)
    groupUseStateMock.mockResolvedValue(memberEnvelope())

    await groupStore.ensureGroupUse(ROOM)

    const uids = (groupStore.userListMap[ROOM] ?? []).map((m) => m.uid).sort()
    expect(uids).toEqual(['1', '2'])
  })

  it('可信 NOT_ACCESSIBLE 才退场：清成员表与群详情，并留下一份不可访问快照', async () => {
    const groupStore = useGroupStore()
    seedMembers(groupStore)
    groupUseStateMock.mockResolvedValue({ outcome: 'NOT_ACCESSIBLE', roomId: ROOM, requestedMembers: [] })

    const state = await groupStore.ensureGroupUse(ROOM)

    expect(state?.outcome).toBe('NOT_ACCESSIBLE')
    expect(groupStore.userListMap[ROOM]).toBeUndefined()
    expect(groupStore.getGroupDetailByRoomId(ROOM)).toBeUndefined()
  })

  it('传输/格式失败不当成不可访问：保留上次可信值，并保留后续补跑机会', async () => {
    const groupStore = useGroupStore()
    seedMembers(groupStore)
    groupUseStateMock.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(memberEnvelope())

    await groupStore.ensureGroupUse(ROOM)
    // 失败：成员与详情都还在（不假称已确认失权）
    expect((groupStore.userListMap[ROOM] ?? []).length).toBe(3)
    expect(groupStore.getGroupDetailByRoomId(ROOM)?.memberNum).toBe(3)

    // 下一次进入/读取仍有有效机会校准
    await groupStore.ensureGroupUse(ROOM)
    expect(groupStore.getGroupDetailByRoomId(ROOM)?.memberNum).toBe(40)
  })

  it('畸形载荷（未知 outcome）按读失败处理，不折成 NOT_ACCESSIBLE', async () => {
    const groupStore = useGroupStore()
    seedMembers(groupStore)
    groupUseStateMock.mockResolvedValue({ outcome: 'WHATEVER', roomId: ROOM })

    await groupStore.ensureGroupUse(ROOM)

    expect((groupStore.userListMap[ROOM] ?? []).length).toBe(3)
    expect((groupStore as unknown as { groupUseStates: Record<string, unknown> }).groupUseStates[ROOM]).toBeUndefined()
  })

  it('失效提示期间的旧在飞结果不得把 scope 标为已校准（代次守卫）', async () => {
    const groupStore = useGroupStore()
    seedMembers(groupStore)
    let release!: (v: unknown) => void
    const staleResponse = new Promise((resolve) => (release = resolve))
    // 提示触发的补读不返回：旧结果不能替代它成为「已校准」
    groupUseStateMock.mockReturnValueOnce(staleResponse).mockReturnValue(new Promise(() => {}))

    const inflight = groupStore.ensureGroupUse(ROOM)
    // 提示在读取期间到达：本次结果已过期
    groupStore.invalidateGroupUse(ROOM, 'hint-during-read')
    release(memberEnvelope())
    await inflight

    expect((groupStore as unknown as { groupUseStates: Record<string, unknown> }).groupUseStates[ROOM]).toBeUndefined()
    // 旧结果也没有改动本地事实
    expect((groupStore.userListMap[ROOM] ?? []).length).toBe(3)
    expect(groupStore.getGroupDetailByRoomId(ROOM)?.memberNum).toBe(3)
  })

  it('群成员请求只发当前页 UID，且不重复（正常路径走当前读而非整表列表）', async () => {
    const groupStore = useGroupStore()
    seedMembers(groupStore)
    groupUseStateMock.mockResolvedValue(memberEnvelope())

    await groupStore.ensureGroupUse(ROOM)

    expect(groupUseStateMock).toHaveBeenCalledTimes(1)
    const [params, options] = groupUseStateMock.mock.calls[0]
    expect(params.roomId).toBe(ROOM)
    expect(params.memberUids).toEqual(['1', '2', '3'])
    // 后台校准失败不得弹全局 toast
    expect(options).toMatchObject({ showError: false })
    expect(groupListMemberMock).not.toHaveBeenCalled()
  })
})
