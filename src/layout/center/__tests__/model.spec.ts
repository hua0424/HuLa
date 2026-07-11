import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

/**
 * #173 checkbox 状态漂移小修：邀请弹窗 disabled 判定应读「邀请目标群」的成员，
 * 而非环境态 currentSessionRoomId 对应的成员——后者在独立弹窗窗口里可能滞后/不同，
 * 造成 groupStore.userList 异步分批加载时同屏 disabled 状态漂移。
 */

const currentSessionRoomIdRef = ref('room-current')
const userListMapRef = ref<Record<string, Array<{ uid: string }>>>({})

vi.mock('@/stores/contacts', () => ({
  useContactStore: () => ({ contactsList: [] })
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
    getUserInfo: (uid: string) => ({ name: `User-${uid}`, uid }),
    getUserListByRoomId: (roomId: string) => userListMapRef.value[roomId] || [],
    get userList() {
      return userListMapRef.value[currentSessionRoomIdRef.value] || []
    }
  })
}))

import { getDisabledOptions } from '@/layout/center/model.tsx'

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
