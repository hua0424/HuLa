import { RoomTypeEnum } from '@/enums'
import { useChatStore } from '@/stores/chat'
import { useContactStore } from '@/stores/contacts'
import { useGroupStore } from '@/stores/group'
import { useUserStore } from '@/stores/user'
import { getUserByIds } from '@/utils/ImRequestUtils'

/**
 * REQ-016 #194 F1（PRD #190 裁决 2）：userInfoChange 帧处理。
 *
 * server 契约：WS 帧 `userInfoChange`，data `{ uid, changeType: 'profile' | 'remark' }`。
 * - profile（name/avatar/resume 变更，推该用户全部好友+本人）：重拉权威用户信息 →
 *   patchCachedUserInfo → patch 会话列表快照名/头像（聊天头部 activeItem 是同一 session
 *   快照的 computed，随 updateSession 自动刷新）。
 * - remark（好友备注，仅推 setter 本人）：备注 per-user 私有、帧不带值 → 先刷新本人
 *   联系人列表拿权威 remark，会话显示名按「备注优先」重算。
 *
 * 幂等：aiclaw 管理窗 handleProfileSaved 已做本地即时 patch，帧到达后重复 patch 同值无副作用。
 */
export type UserInfoChangePayload = {
  uid: string | number
  changeType?: 'profile' | 'remark'
}

export const handleUserInfoChange = async (data: UserInfoChangePayload): Promise<void> => {
  const uid = String(data?.uid ?? '').trim()
  if (!uid) return

  const chatStore = useChatStore()
  const groupStore = useGroupStore()
  const contactStore = useContactStore()
  const userStore = useUserStore()

  // remark 帧：刷新本人联系人列表，拿权威 remark（含备注被清空 → 回退昵称的场景）
  if (data.changeType === 'remark') {
    try {
      await contactStore.getContactList(true)
    } catch (error) {
      console.error('[userInfoChange] 刷新联系人列表失败:', error)
    }
  }

  // profile/remark 统一重拉权威用户信息（remark 清空时显示名要回退到权威昵称）
  let fresh: { name?: string; avatar?: string; resume?: string } | undefined
  try {
    const users = await getUserByIds([uid])
    fresh = users?.find((u) => String(u.uid) === uid)
  } catch (error) {
    console.error('[userInfoChange] 重拉用户信息失败:', error)
    return
  }

  if (fresh) {
    groupStore.patchCachedUserInfo(uid, { name: fresh.name, avatar: fresh.avatar, resume: fresh.resume })
    // 本人资料变更（多客户端同步）：同步 userStore.userInfo
    if (String(userStore.userInfo?.uid) === uid) {
      if (fresh.name !== undefined) userStore.userInfo!.name = fresh.name
      if (fresh.avatar !== undefined) userStore.userInfo!.avatar = fresh.avatar
      if (fresh.resume !== undefined) (userStore.userInfo as any).resume = fresh.resume
    }
  }

  // patch 单聊会话快照（备注优先）；群聊会话名与该 uid 无关，不动
  const remark = contactStore.contactsList.find((c) => String(c.uid) === uid)?.remark?.trim()
  for (const session of chatStore.sessionList) {
    if (session.type === RoomTypeEnum.SINGLE && String(session.detailId) === uid) {
      chatStore.updateSession(session.roomId, {
        name: remark || fresh?.name || session.name,
        avatar: fresh?.avatar || session.avatar
      })
    }
  }
}
