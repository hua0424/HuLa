import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * #210 二期：成员变化跨窗广播 util。
 * 桌面端经 Tauri emit 广播（管理窗收敛的数据源）；web 端无多窗，no-op。
 */

const emitMock = vi.hoisted(() => vi.fn())
const isWebRef = vi.hoisted(() => ({ value: false }))

vi.mock('@tauri-apps/api/event', () => ({
  emit: (...args: unknown[]) => emitMock(...args)
}))

vi.mock('@/utils/PlatformConstants', () => ({
  isWeb: () => isWebRef.value
}))

import { ChangeTypeEnum } from '@/enums'
import { MEMBER_CHANGE_EVENT, broadcastMemberChange, broadcastRoomDissolution } from '@/utils/memberChangeBroadcast'

describe('memberChangeBroadcast（#210 二期跨窗广播）', () => {
  beforeEach(() => {
    emitMock.mockReset().mockResolvedValue(undefined)
    isWebRef.value = false
  })

  it('成员变化：映射 userList→uidList 后经 Tauri emit 广播', async () => {
    await broadcastMemberChange({
      roomId: 'room-1',
      changeType: ChangeTypeEnum.REMOVE,
      userList: [{ uid: 1001 }, { uid: '1002' }]
    })

    expect(emitMock).toHaveBeenCalledTimes(1)
    expect(emitMock).toHaveBeenCalledWith(MEMBER_CHANGE_EVENT, {
      roomId: 'room-1',
      changeType: ChangeTypeEnum.REMOVE,
      uidList: ['1001', '1002']
    })
  })

  it('群解散：dissolved 直发', async () => {
    await broadcastRoomDissolution('room-9')

    expect(emitMock).toHaveBeenCalledWith(MEMBER_CHANGE_EVENT, { roomId: 'room-9', dissolved: true })
  })

  it('web 端 no-op（无多窗，路由态 userListMap 同上下文是活的）', async () => {
    isWebRef.value = true

    await broadcastMemberChange({ roomId: 'room-1', changeType: ChangeTypeEnum.JOIN, userList: [{ uid: 1 }] })
    await broadcastRoomDissolution('room-1')

    expect(emitMock).not.toHaveBeenCalled()
  })

  it('emit 抛错不向上传播（广播是旁路信号，不能炸主链路）', async () => {
    emitMock.mockRejectedValue(new Error('ipc down'))

    await expect(
      broadcastMemberChange({ roomId: 'room-1', changeType: ChangeTypeEnum.JOIN, userList: [{ uid: 1 }] })
    ).resolves.toBeUndefined()
  })
})
