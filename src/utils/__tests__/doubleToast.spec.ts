import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-017 #200：带领域错误提示的调用，底层 network_error toast 应静默（只留领域 toast）。
 * - ImRequestUtils 各 mutation wrapper 支持 options.showError 透传；
 * - group store 的 exit/addAdmin/revokeAdmin/removeGroupMembers 与
 *   useMyRoomInfoUpdater.persistMyRoomInfo 全部以 showError:false 调底层；
 * - 桌面/移动「退出群聊」补领域 toast 的 locale 键存在。
 */

const invokeWithErrorHandlerMock = vi.hoisted(() => vi.fn().mockResolvedValue({}))
vi.mock('@/utils/TauriInvokeHandler', () => ({
  invokeWithErrorHandler: invokeWithErrorHandlerMock,
  invokeSilently: vi.fn().mockResolvedValue(null),
  ErrorType: { Network: 'Network', Unknown: 'Unknown' }
}))
vi.mock('@/utils/PlatformConstants', () => ({ isWeb: () => false }))

const chatStoreMock = vi.hoisted(() => ({ updateSession: vi.fn() }))
vi.mock('@/stores/chat', () => ({ useChatStore: () => chatStoreMock }))
const groupStoreMock = vi.hoisted(() => ({
  countInfo: { groupName: 'g', avatar: 'a', allowScanEnter: true } as null | object,
  updateGroupDetail: vi.fn()
}))
vi.mock('@/stores/group', () => ({ useGroupStore: () => groupStoreMock }))

import {
  addAdmin,
  exitGroup,
  notification,
  removeGroupMember,
  revokeAdmin,
  setSessionTop,
  shield,
  updateMyRoomInfo,
  updateRoomInfo
} from '@/utils/ImRequestUtils'
import { NotificationTypeEnum } from '@/enums'

describe('ImRequestUtils mutation wrapper #200 showError 透传', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).$message = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
  })

  const cases: Array<[string, () => Promise<unknown>]> = [
    ['exitGroup', () => exitGroup({ roomId: 'r1' }, { showError: false })],
    ['addAdmin', () => addAdmin({ roomId: 'r1', uidList: ['u1'] }, { showError: false })],
    ['revokeAdmin', () => revokeAdmin({ roomId: 'r1', uidList: ['u1'] }, { showError: false })],
    ['removeGroupMember', () => removeGroupMember({ roomId: 'r1', uidList: ['u1'] }, { showError: false })],
    ['updateMyRoomInfo', () => updateMyRoomInfo({ id: 'r1', myName: 'n', remark: '' }, { showError: false })],
    ['setSessionTop', () => setSessionTop({ roomId: 'r1', top: true }, { showError: false })],
    [
      'notification',
      () => notification({ roomId: 'r1', type: NotificationTypeEnum.NOT_DISTURB }, { showError: false })
    ],
    ['shield', () => shield({ roomId: 'r1', state: true }, { showError: false })],
    ['updateRoomInfo', () => updateRoomInfo({ id: 'r1', name: 'n' }, { showError: false })]
  ]

  for (const [name, call] of cases) {
    it(`${name}：options.showError=false 透传到 invokeWithErrorHandler`, async () => {
      await call()
      expect(invokeWithErrorHandlerMock).toHaveBeenCalledWith(
        'im_request_command',
        expect.anything(),
        expect.objectContaining({ showError: false })
      )
    })
  }

  it('exitGroup 不传 options 时保持默认（showError 非 false，回归守护）', async () => {
    await exitGroup({ roomId: 'r1' })
    const opts = invokeWithErrorHandlerMock.mock.calls[0][2] as Record<string, unknown>
    expect(opts?.showError).not.toBe(false)
  })
})

describe('#200 领域 toast locale 键', () => {
  it('zh-CN / en 均有 exit_failed 与 leave_failed，且不含裸 @（防 vue-i18n linked-message 语法炸）', async () => {
    const homeZh = (await import('~/locales/zh-CN/home.json')).default as any
    const homeEn = (await import('~/locales/en/home.json')).default as any
    const mcsZh = (await import('~/locales/zh-CN/mobile_chat_setting.json')).default as any
    const mcsEn = (await import('~/locales/en/mobile_chat_setting.json')).default as any

    for (const v of [
      homeZh.chat_header.toast.exit_failed,
      homeEn.chat_header.toast.exit_failed,
      mcsZh.leave_failed,
      mcsEn.leave_failed
    ]) {
      expect(typeof v).toBe('string')
      expect(v.length).toBeGreaterThan(0)
      expect(v).not.toContain('@')
    }
  })
})
