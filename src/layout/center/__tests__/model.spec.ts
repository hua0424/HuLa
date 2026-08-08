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
