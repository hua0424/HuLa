import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

/**
 * #173 checkbox 状态漂移小修：邀请弹窗 disabled 判定应读「邀请目标群」的成员，
 * 而非环境态 currentSessionRoomId 对应的成员——后者在独立弹窗窗口里可能滞后/不同，
 * 造成 groupStore.userList 异步分批加载时同屏 disabled 状态漂移。
 */

const currentSessionRoomIdRef = ref('room-current')
const userListMapRef = ref<Record<string, Array<{ uid: string }>>>({})
const contactsListRef = ref<any[]>([])
const getUserInfoMock = vi.fn((uid: string): any => ({ name: `User-${uid}`, uid }))

vi.mock('@/stores/contacts', () => ({
  useContactStore: () => ({
    get contactsList() {
      return contactsListRef.value
    }
  })
}))
vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({
    get currentSessionRoomId() {
      return currentSessionRoomIdRef.value
    }
  })
}))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({
    getUserInfo: (uid: string) => getUserInfoMock(uid),
    getUserListByRoomId: (roomId: string) => userListMapRef.value[roomId] || [],
    get userList() {
      return userListMapRef.value[currentSessionRoomIdRef.value] || []
    }
  })
}))

import { getDisabledOptions, options } from '@/layout/center/model.tsx'

describe('#173 getDisabledOptions 读目标群成员（消 checkbox 漂移）', () => {
  beforeEach(() => {
    currentSessionRoomIdRef.value = 'room-current'
    userListMapRef.value = {
      'room-current': [{ uid: 'A' }, { uid: 'B' }],
      'room-target': [{ uid: 'C' }]
    }
  })

  it('传入显式 roomId 时读该群成员，而非当前会话群', () => {
    const disabled = getDisabledOptions('room-target')
    expect(disabled.sort()).toEqual(['C'])
  })

  it('目标群成员尚未加载（map 无该键）时返回空，不误用当前会话群成员', () => {
    const disabled = getDisabledOptions('room-not-loaded')
    expect(disabled).toEqual([])
  })

  it('不传 roomId 时回退到当前会话群（保留既有行为）', () => {
    const disabled = getDisabledOptions()
    expect(disabled.sort()).toEqual(['A', 'B'])
  })
})

describe('#221 穿梭框源列表 label 兜底链', () => {
  beforeEach(() => {
    contactsListRef.value = []
    getUserInfoMock.mockReset()
  })

  it('getUserInfo 无数据且 remark 为空时，回退好友分页自带的 name（不再空渲染）', () => {
    contactsListRef.value = [{ uid: '9001', name: 'CodexAI', remark: '', account: 'codexai' }]
    getUserInfoMock.mockReturnValue(undefined)

    const opt = (options.value as any[]).find((o) => o.value === '9001')
    expect(opt).toBeTruthy()
    expect(opt.label).toBe('CodexAI')
  })

  it('remark 有值时维持 remark 兜底（既有优先级不变）', () => {
    contactsListRef.value = [{ uid: '9002', name: 'Anjie', remark: '小安', account: 'anjie' }]
    getUserInfoMock.mockReturnValue(undefined)

    const opt = (options.value as any[]).find((o) => o.value === '9002')
    expect(opt.label).toBe('小安')
  })

  it('getUserInfo 有 name 时维持最高优先级（既有行为不变）', () => {
    contactsListRef.value = [{ uid: '9003', name: '分页名', remark: '备注名', account: 'x' }]
    getUserInfoMock.mockReturnValue({ name: '缓存名', uid: '9003' })

    const opt = (options.value as any[]).find((o) => o.value === '9003')
    expect(opt.label).toBe('缓存名')
  })
})

/**
 * aichatoverview#236：踢出群后邀请弹窗该成员名字空白+头像退化（PR#67 冒烟 incidental）。
 * 复现基线不含 #64：踢出后该 uid 退出 userListMap，friendInfoCache 只剩旧形态条目
 * （activeStatus/userType，无 name/avatar），label 链 `userInfo?.name || item.remark` 落空 →
 * 空白名 + '/logoD.png'。当前 dev 的 #64 链（friendInfoCache 重播种 + item.name/item.avatar
 * 兜底）覆盖该场景——踢出唯一共同群后等价于 #221「无共同群好友」。本组锁定等价性防回退。
 */
describe('#236 踢出群成员在邀请弹窗的名字/头像解析（#64 链等价覆盖）', () => {
  beforeEach(() => {
    contactsListRef.value = []
    getUserInfoMock.mockReset()
  })

  it('friendInfoCache 只剩旧形态条目（无 name/avatar）时，回退好友分页的 name/avatar', () => {
    // 旧形态：#64 前 getContactList 只播种 activeStatus/lastOptTime/userType
    contactsListRef.value = [
      { uid: '9001', name: 'CodexAI', avatar: 'https://x/codex.png', remark: '', account: 'codexai' }
    ]
    getUserInfoMock.mockReturnValue({ uid: '9001', activeStatus: 1, userType: 4 })

    const opt = (options.value as any[]).find((o) => o.value === '9001')
    expect(opt.label).toBe('CodexAI')
    expect(opt.avatar).toBe('https://x/codex.png')
  })

  it('弹窗 getContactList 重播种后 friendInfoCache 带名时，缓存名/头像优先（实时路径）', () => {
    contactsListRef.value = [
      { uid: '9001', name: '分页旧名', avatar: 'https://x/old.png', remark: '', account: 'codexai' }
    ]
    getUserInfoMock.mockReturnValue({ uid: '9001', name: 'CodexAI', avatar: 'https://x/codex.png', account: 'codexai' })

    const opt = (options.value as any[]).find((o) => o.value === '9001')
    expect(opt.label).toBe('CodexAI')
    expect(opt.avatar).toBe('https://x/codex.png')
  })

  it('分页项 name 缺失（服务端 null 形态）且缓存无名时仍空 label——记录边界，防静默改语义', () => {
    contactsListRef.value = [{ uid: '9001', name: null, avatar: null, remark: '', account: 'codexai' }]
    getUserInfoMock.mockReturnValue({ uid: '9001', activeStatus: 1, userType: 4 })

    const opt = (options.value as any[]).find((o) => o.value === '9001')
    expect(opt.label).toBeFalsy()
    expect(opt.avatar).toBe('/logoD.png')
  })
})
