import { useAiclawStore } from '@/stores/aiclaw'
import { useChatStore } from '@/stores/chat'
import { useGroupStore } from '@/stores/group'
import * as ImRequestUtils from '@/utils/ImRequestUtils'

/**
 * REQ-016 #195 F3（PRD #190 裁决 3）：建群流程 —— 防重 + 群名 + 链路提速。
 *
 * 桌面（layout/center）与移动（StartGroupChat）共享本流程：
 * 1. 模块级 inFlight 防重：并发/连点只发一次 createGroup（server RedissonLock 只排队不幂等）
 * 2. 群名可空：trim 后非空才带 groupName（server GroupAddReq 已支持，空维持默认命名）
 * 3. 提速：createGroup 拿到 roomId 后**先开配置弹窗**（onOpenBatchConfig），
 *    getSessionList(true) 全量重拉与群详情/成员补拉全部后台化——
 *    弹窗内自取配置（roomId 已足够保存），不被 5 步串行 await 拖住
 */

export type CreateGroupFlowOptions = {
  uidList: string[]
  groupName?: string
  /** 拿到 roomId 且选中成员含我的 aiclaw 时调用（应立即打开批量配置弹窗） */
  onOpenBatchConfig: (roomId: string, items: Array<{ uid: string; name?: string; adapterType?: string }>) => void
  /** 后台全量会话重拉完成且匹配到新群会话时回调（用于跳转到新群） */
  onSessionReady?: (roomId: string) => void
}

export type CreateGroupFlowResult = {
  roomId?: string
  /** true = 已有在途创建，本次被防重跳过 */
  skipped?: boolean
}

/** 模块级在途标志：建群不幂等，任何并发调用直接跳过 */
let inFlight = false

export const createGroupFlow = async (options: CreateGroupFlowOptions): Promise<CreateGroupFlowResult> => {
  if (inFlight) return { skipped: true }
  inFlight = true
  try {
    const name = options.groupName?.trim()
    const result: any = await ImRequestUtils.createGroup({
      uidList: options.uidList,
      ...(name ? { groupName: name } : {})
    })

    const resultRoomId = result?.roomId != null ? String(result.roomId) : undefined
    const resultId = result?.id != null ? String(result.id) : undefined
    // #87：无论会话列表是否已刷新到新群，都使用创建返回的 roomId 作为兜底
    const roomId = resultRoomId ?? resultId
    if (!roomId) return {}

    const chatStore = useChatStore()
    const groupStore = useGroupStore()
    const aiclawStore = useAiclawStore()

    // 后台化：全量会话重拉，完成后匹配新群会话回调（跳转用），不阻塞配置弹窗
    void chatStore
      .getSessionList(true)
      .then(() => {
        const matched = chatStore.sessionList.find((session) => {
          const sessionRoomId = String(session.roomId)
          const sessionDetailId = session.detailId != null ? String(session.detailId) : undefined
          return sessionRoomId === roomId || (sessionDetailId !== undefined && sessionDetailId === roomId)
        })
        if (matched?.roomId) options.onSessionReady?.(matched.roomId)
      })
      .catch((error) => console.error('[createGroupFlow] 后台刷新会话列表失败:', error))

    // 后台化：群详情/成员补拉（配置弹窗内也会自补，这里预热缓存）
    void Promise.all([groupStore.addGroupDetail(roomId), groupStore.getGroupUserList(roomId, true)]).catch((error) =>
      console.error('[createGroupFlow] 后台补拉群详情/成员失败:', error)
    )

    // 先开配置弹窗：只需 roomId + 我的 aiclaw 名单（名称走 aiclawStore 缓存，不等成员列表）
    await aiclawStore.ensureLoaded()
    const aiclawItems = options.uidList
      .filter((uid) => aiclawStore.isMyAiclaw(uid))
      .map((uid) => ({
        uid,
        name: aiclawStore.getName(uid),
        adapterType: aiclawStore.getAdapterType(uid)
      }))
    if (aiclawItems.length > 0) {
      options.onOpenBatchConfig(roomId, aiclawItems)
    }

    return { roomId }
  } finally {
    inFlight = false
  }
}
