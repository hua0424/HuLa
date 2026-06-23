import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const mockGroupGetUserInfo = vi.fn()
const mockContactList = ref<Array<{ uid: string; userType?: number }>>([])

vi.mock('@/stores/group', () => ({
  useGroupStore: vi.fn(() => ({
    getUserInfo: mockGroupGetUserInfo
  }))
}))
vi.mock('@/stores/contacts', () => ({
  useContactStore: vi.fn(() => ({
    contactsList: mockContactList.value
  }))
}))

import { UserType } from '@/enums'
import { isAiclaw, isAiclawByUserType, isSilentAiclaw } from '@/utils/AiclawUtils'

describe('AiclawUtils', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockGroupGetUserInfo.mockReset()
    mockContactList.value = []
  })

  describe('isAiclaw', () => {
    it('群成员缓存命中时按 userType 判断', () => {
      mockGroupGetUserInfo.mockReturnValue({ uid: '1001', userType: UserType.AICLAW })
      expect(isAiclaw('1001')).toBe(true)

      mockGroupGetUserInfo.mockReturnValue({ uid: '1002', userType: 1 })
      expect(isAiclaw('1002')).toBe(false)
    })

    it('群成员缓存未命中时 fallback 到好友列表', () => {
      mockGroupGetUserInfo.mockReturnValue(undefined)
      mockContactList.value = [{ uid: '1003', userType: UserType.AICLAW as number }]
      expect(isAiclaw('1003')).toBe(true)

      mockContactList.value = [{ uid: '1004', userType: 1 }]
      expect(isAiclaw('1004')).toBe(false)
    })

    it('两处都没数据时返回 false', () => {
      mockGroupGetUserInfo.mockReturnValue(undefined)
      mockContactList.value = []
      expect(isAiclaw('9999')).toBe(false)
    })

    it('userType 为 undefined 时继续 fallback', () => {
      mockGroupGetUserInfo.mockReturnValue({ uid: '1005', userType: undefined })
      mockContactList.value = [{ uid: '1005', userType: UserType.AICLAW as number }]
      expect(isAiclaw('1005')).toBe(true)
    })

    it('对 number uid 归一化后判断', () => {
      mockGroupGetUserInfo.mockReturnValue({ uid: 2001, userType: UserType.AICLAW })
      expect(isAiclaw(2001)).toBe(true)
    })
  })

  describe('isAiclawByUserType', () => {
    it('userType 为 AICLAW 时返回 true', () => {
      expect(isAiclawByUserType(UserType.AICLAW)).toBe(true)
    })

    it('userType 为其他值或 undefined 时返回 false', () => {
      expect(isAiclawByUserType(1)).toBe(false)
      expect(isAiclawByUserType(2)).toBe(false)
      expect(isAiclawByUserType(undefined)).toBe(false)
    })
  })

  describe('isSilentAiclaw', () => {
    it('AI 助理且 approved=false → true', () => {
      expect(isSilentAiclaw(UserType.AICLAW, false)).toBe(true)
    })

    it('AI 助理但 approved=true → false', () => {
      expect(isSilentAiclaw(UserType.AICLAW, true)).toBe(false)
    })

    it('AI 助理但 approved 未加载(undefined) → false', () => {
      expect(isSilentAiclaw(UserType.AICLAW, undefined)).toBe(false)
    })

    it('普通用户无论 approved 为何 → false', () => {
      expect(isSilentAiclaw(1, false)).toBe(false)
      expect(isSilentAiclaw(1, true)).toBe(false)
      expect(isSilentAiclaw(undefined, false)).toBe(false)
    })
  })
})
