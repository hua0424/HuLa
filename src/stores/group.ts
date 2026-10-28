import { defineStore } from 'pinia'
import { OnlineEnum, RoleEnum, RoomTypeEnum, StoresEnum } from '@/enums'
import type { GroupDetailReq, UserItem } from '@/services/types'
import { useGlobalStore } from '@/stores/global'
import { useUserStore } from '@/stores/user'
import * as ImRequestUtils from '@/utils/ImRequestUtils'
import {
  isRoomErrorToastSuppressed,
  releaseErrorToastsForRoom,
  suppressErrorToastsForRoom
} from '@/utils/errorToastSuppression'
import { useChatStore } from './chat'
import { scopedChatStorage } from './persistHomeWindowOnly'
import { SessionExpiredError, isSessionCurrent, sessionBinding } from '@/services/sessionBinding'
import {
  GROUP_USE_MAX_MEMBER_UIDS,
  type GroupUseMemberProjection,
  type GroupUseState,
  normalizeRequestedUids,
  parseGroupUseState
} from '@/services/groupUseState'
import { isWeb } from '@/utils/PlatformConstants'

export const useGroupStore = defineStore(
  StoresEnum.GROUP,
  () => {
    const globalStore = useGlobalStore()
    const userStore = useUserStore()
    const chatStore = useChatStore()

    // 动态加载没有的群组 [防止并发冲突加载]
    const groupDetailsCache = ref<Record<string, GroupDetailReq>>({})
    const loadingGroups = ref<Set<string>>(new Set())

    // 群组相关状态
    const currentSessionState = ref({
      roomId: '',
      loading: false,
      lastLoadedRoomId: ''
    })

    type InternalUserItem = UserItem & { __order?: number }

    // #239 PR2：A 类键 reactive→ref——收包整键替换写穿 ref.value，跨窗活同步落地（#237 终裁第 1 条）
    const userListMap = ref<Record<string, UserItem[]>>({})
    const memberOrderCounters = reactive<Record<string, number>>({})
    const onlineCountMap = ref<Record<string, number>>({})

    // #179：选中会话期间按 roomId 抑制相关请求的网络错误弹窗（注册表见 errorToastSuppression），
    // 幽灵会话由 useMessage 兜底统一清理并给出优雅提示，瞬时错误由调用方补回提示。
    // 抑制/释放动作落到中央注册表，invokeWithErrorHandler 对所有带该 roomId 的请求统一压制；
    // 本 store 的 getGroupUserList 同步读取同一注册表决定底层请求是否带 showError。
    // 已确认解散/失效的房间：成员拉取直接短路，避免任何迟到/重复请求再弹错误
    const dissolvedRoomIds = reactive(new Set<string>())

    const suppressMemberFetchError = (roomId: string) => {
      suppressErrorToastsForRoom(roomId)
    }

    const releaseMemberFetchError = (roomId: string) => {
      releaseErrorToastsForRoom(roomId)
    }

    const markRoomDissolved = (roomId: string) => {
      if (roomId) dissolvedRoomIds.add(roomId)
    }

    /** 房间是否已确认解散/失效（REQ-016 #195：解散回滚短路等场景读取） */
    const isRoomDissolved = (roomId: string) => {
      return dissolvedRoomIds.has(roomId)
    }

    const getRoleSortWeight = (roleId?: number) => {
      switch (roleId) {
        case RoleEnum.LORD:
          return 0
        case RoleEnum.ADMIN:
          return 1
        case RoleEnum.NORMAL:
          return 2
        default:
          return 3
      }
    }

    const ensureMemberOrder = (roomId: string, members: InternalUserItem[]) => {
      if (!memberOrderCounters[roomId]) {
        memberOrderCounters[roomId] = 0
      }

      members.forEach((member) => {
        if (member.__order === undefined) {
          member.__order = memberOrderCounters[roomId]++
        }
      })
    }

    const sortMembersByRole = (roomId: string, members: InternalUserItem[]) => {
      ensureMemberOrder(roomId, members)

      return [...members].sort((a, b) => {
        // 按角色排序（群主 > 管理员 > 普通成员）
        const roleDiff = getRoleSortWeight(a.roleId) - getRoleSortWeight(b.roleId)
        if (roleDiff !== 0) {
          return roleDiff
        }

        // 最后按加入顺序排序
        return (a.__order ?? Number.MAX_SAFE_INTEGER) - (b.__order ?? Number.MAX_SAFE_INTEGER)
      })
    }

    const setRoomMemberList = (roomId: string, members: UserItem[]) => {
      if (!Array.isArray(members) || members.length === 0) {
        userListMap.value[roomId] = []
        memberOrderCounters[roomId] = 0
        onlineCountMap.value[roomId] = 0
        return
      }

      const sortedMembers = sortMembersByRole(roomId, members as InternalUserItem[])
      userListMap.value[roomId] = sortedMembers
      onlineCountMap.value[roomId] = sortedMembers.filter((m) => m.activeStatus === OnlineEnum.ONLINE).length
    }
    /**
     * #484：群「使用事实」当前读快照（本人角色/可访问性/人数/有界 UID 投影）。
     *
     * 只有当前读结果能授予/收回本群管理能力；`userListMap` 只是展示快照，
     * 可能来自旧 WS 载荷（`memberList` 还会用 adminUidList 覆盖 roleId），
     * 不能单独作为权限依据（设计 §2/§6）。放 $state 供辅窗只读收敛，不各自发 HTTP。
     */
    const groupUseStates = ref<Record<string, GroupUseState>>({})

    /** 运行态（不进 $state、不广播不持久化）：hint/切房/账号代次变化都会推进代次 */
    const groupUseGenerations = new Map<string, number>()
    const groupUseInFlight = new Map<string, Promise<GroupUseState | null>>()
    const groupUseDirty = new Set<string>()

    const groupUseGenerationOf = (roomId: string) => groupUseGenerations.get(roomId) ?? 0

    const resetGroupUseState = () => {
      groupUseStates.value = {}
      groupUseGenerations.clear()
      groupUseInFlight.clear()
      groupUseDirty.clear()
    }

    /**
     * 只按 census 覆盖到的 UID 收敛：未请求/页外的成员保持现状（unknown），
     * 不当成「不存在」，也不整表替换（设计 §4.1「按 coverage 更新」）。
     */
    const applyMemberProjections = (roomId: string, projections: GroupUseMemberProjection[]) => {
      if (!Array.isArray(projections) || projections.length === 0) return
      const current = userListMap.value[roomId]
      if (!Array.isArray(current) || current.length === 0) return

      const byUid = new Map(projections.map((item) => [item.uid, item]))
      let changed = false
      const next: UserItem[] = []
      current.forEach((member) => {
        const projection = byUid.get(String(member.uid))
        if (projection && projection.exists === false) {
          // 权威判定「已不在群」才移除；网络失败/未覆盖都不走到这里
          changed = true
          return
        }
        if (projection && typeof projection.roleId === 'number' && projection.roleId !== member.roleId) {
          changed = true
          next.push({ ...member, roleId: projection.roleId })
          return
        }
        next.push(member)
      })

      if (!changed) return
      setRoomMemberList(roomId, next)
    }

    const applyGroupUseResult = (roomId: string, result: GroupUseState | null, expectedGeneration: number): boolean => {
      // 晚到结果：代次已推进或账号代次已变，一律丢弃（设计 §4.1）
      if (expectedGeneration !== groupUseGenerationOf(roomId)) return false
      if (!isWeb() && !isSessionCurrent(sessionBinding.value)) return false

      if (!result) {
        // 传输/格式失败不是「不可访问」：保留上次可信快照并标记未校准（设计 §3.3）
        groupUseDirty.add(roomId)
        return false
      }

      groupUseStates.value[roomId] = result
      groupUseDirty.delete(roomId)

      if (result.outcome === 'NOT_ACCESSIBLE') {
        // 可信不可访问：停用该房间成员能力与派生状态，保留合法本地聊天历史
        removeAllUsers(roomId)
        removeGroupDetail(roomId)
        delete groupDetailsCache.value[roomId]
        return true
      }

      applyMemberProjections(roomId, result.requestedMembers)
      const detail = groupDetails.value.find((item) => item.roomId === roomId)
      if (detail && typeof result.memberCount === 'number') {
        detail.memberNum = result.memberCount
      }
      return true
    }

    const readGroupUseOnce = (roomId: string): Promise<GroupUseState | null> => {
      const generation = groupUseGenerationOf(roomId)
      // 只把当前阅读范围内的成员放进有界投影；页外成员保持 unknown
      const memberUids = normalizeRequestedUids(
        (userListMap.value[roomId] ?? []).map((member) => String(member.uid))
      ).slice(0, GROUP_USE_MAX_MEMBER_UIDS)

      const request = (async () => {
        try {
          const raw = await ImRequestUtils.groupUseState({ roomId, memberUids }, { showError: false })
          const parsed = parseGroupUseState(raw)
          if (!parsed) {
            console.warn(`[group-use] room=${roomId} 当前读响应格式不符，保留上次可信快照`)
          }
          return parsed
        } catch (error) {
          if (error instanceof SessionExpiredError) return null
          console.warn(`[group-use] room=${roomId} 当前读失败:`, error)
          return null
        }
      })()

      groupUseInFlight.set(roomId, request)
      void request.finally(() => {
        // 旧 finally 不得清掉新请求（设计 §4.1）
        if (groupUseInFlight.get(roomId) === request) groupUseInFlight.delete(roomId)
        // 本轮期间又收到 hint：有界补跑一次，避免永久停在未校准
        if (groupUseDirty.has(roomId) && groupUseGenerationOf(roomId) === generation + 1) {
          void ensureGroupUse(roomId).catch(() => undefined)
        }
      })
      return request
    }

    /**
     * 取得该房间当前使用事实（有界、单飞、可被 hint 作废）。
     * 有同代次可信快照直接返回；有在飞请求则合并复用；否则发起一次当前读。
     */
    const ensureGroupUse = async (roomId: string): Promise<GroupUseState | null> => {
      if (!roomId) return null
      const existing = groupUseStates.value[roomId]
      if (existing && !groupUseDirty.has(roomId)) return existing

      const inFlight = groupUseInFlight.get(roomId)
      if (inFlight) return await inFlight

      const generation = groupUseGenerationOf(roomId)
      const result = await readGroupUseOnce(roomId)
      applyGroupUseResult(roomId, result, generation)
      return groupUseStates.value[roomId] ?? null
    }

    /**
     * 通知只作失效提示：不应用载荷、不直接改权限；推进代次让在飞结果作废。
     * 活跃房间立即补一次当前读；非活跃房间等下次进入/读取时校准（设计 §2/§6）。
     */
    const invalidateGroupUse = (roomId: string, reason = 'hint') => {
      if (!roomId) return
      groupUseGenerations.set(roomId, groupUseGenerationOf(roomId) + 1)
      groupUseDirty.add(roomId)
      // 不在这里清空成员表：提示只是「可能过期」，清空会把可读缓存变成空白，
      // 且让本次校准失去 coverage 依据（不知道该请求哪些 UID）。
      // 过期由 groupUseDirty 标记，下一次当前读按 coverage 覆盖。
      delete groupDetailsCache.value[roomId]
      console.info(`[group-use] room=${roomId} 收到失效提示(${reason})，等待当前读校准`)

      if (globalStore.currentSessionRoomId !== roomId) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void ensureGroupUse(roomId).catch(() => undefined)
    }

    const groupDetails = ref<GroupDetailReq[]>([])
    const userListOptions = ref({ isLast: false, loading: true, cursor: '' }) // 分页加载相关状态（#239 PR2：A 类键 ref 化）
    const myNameInCurrentGroup = computed({
      get() {
        const user = getCurrentUser()
        return user?.myName || user?.name || ''
      },
      set(value: string) {
        // 这里可以添加设置昵称的逻辑
        const user = getCurrentUser()
        if (user) {
          user.myName = value
        }
      }
    })

    const myRoleIdInCurrentGroup = computed({
      get() {
        // #484：本人角色以当前读 selfRole 为准，未校准时才回落到成员列表快照
        const authoritative = groupUseStates.value[globalStore.currentSessionRoomId]?.selfRoleId
        if (typeof authoritative === 'number') return authoritative
        return getCurrentUser()?.roleId || RoleEnum.NORMAL
      },
      set(value: number) {
        // 这里可以添加设置角色的逻辑
        const user = getCurrentUser()
        if (user) {
          user.roleId = value
        }
      }
    })

    // 添加获取当前会话状态的方法
    const getCurrentSessionState = () => {
      return {
        ...currentSessionState.value,
        isCurrentRoom: (roomId: string) => currentSessionState.value.roomId === roomId
      }
    }

    // 添加成员缓存管理方法
    const getCachedMembers = (roomId: string) => {
      return userListMap.value[roomId] || []
    }

    const updateMemberCache = (roomId: string, members: UserItem[]) => {
      setRoomMemberList(roomId, members)
    }

    /**
     * 添加会话切换方法
     */
    const switchSession = async (newSession: any, _oldSession?: any) => {
      if (!newSession?.roomId || newSession.roomId === currentSessionState.value.roomId) {
        return
      }

      const roomId: string = newSession.roomId
      // 设置当前加载的房间ID
      currentSessionState.value.roomId = roomId
      currentSessionState.value.loading = true

      try {
        // 缓存只用于首屏占位，不再是「已校准」的依据（设计 §4.2）
        const cachedMembers = getCachedMembers(roomId)
        if (cachedMembers && Array.isArray(cachedMembers) && cachedMembers.length > 0) {
          setRoomMemberList(roomId, cachedMembers)
        }

        // 重置群组并加载新的群成员数据
        resetGroupData()
        await getGroupUserList(roomId, true)
        // 进入房间即触发一次当前读：非活跃期间漏掉的通知在这里追平（AC2）
        await ensureGroupUse(roomId)

        // 切房后旧响应不得写回新房间（设计 §4.1）
        if (currentSessionState.value.roomId !== roomId) return undefined

        const currentMembers = userListMap.value[roomId] || []
        updateMemberCache(roomId, currentMembers)
        currentSessionState.value.lastLoadedRoomId = roomId

        // 返回处理后的数据
        return {
          success: true,
          members: currentMembers,
          roomId
        }
      } catch (error) {
        console.error('切换会话失败:', error)
        currentSessionState.value.loading = false
        throw error
      } finally {
        if (currentSessionState.value.roomId === roomId) {
          currentSessionState.value.loading = false
        }
      }
    }

    // 获取当前房间的用户列表的计算属性
    const userList = computed(() => {
      if (!globalStore.currentSessionRoomId) return []
      return userListMap.value[globalStore.currentSessionRoomId] || []
    })

    const setGroupDetails = async () => {
      const data = await ImRequestUtils.groupList()
      groupDetails.value = data
    }

    const addGroupDetail = async (roomId: string, options?: { showError?: boolean }) => {
      if (groupDetails.value.find((item) => item.roomId === roomId)) {
        return
      }
      const data = await ImRequestUtils.getGroupDetail(roomId, options)
      groupDetails.value.push(data)
    }

    const userMapByRoomId = computed(() => {
      const map = new Map<string, Map<string, UserItem>>()
      Object.entries(userListMap.value).forEach(([roomId, list]) => {
        const roomMap = new Map<string, UserItem>()
        list.forEach((item) => {
          roomMap.set(item.uid, item)
        })
        map.set(roomId, roomMap)
      })
      return map
    })

    const allUserMap = computed(() => {
      const map = new Map<string, UserItem>()
      Object.values(userListMap.value)
        .flat()
        .forEach((item) => {
          map.set(item.uid, item)
        })
      return map
    })

    /** 独立好友信息缓存（不在任何群组中的好友） */
    const friendInfoCache = reactive(new Map<string, UserItem>())

    /** 将用户信息写入好友缓存（用于非群组好友） */
    const cacheFriendInfo = (uid: string, info: Partial<UserItem>) => {
      const existing = friendInfoCache.get(uid)
      friendInfoCache.set(uid, { ...(existing || {}), ...info, uid } as UserItem)
    }

    /**
     * 直接修补本地缓存中某用户的展示信息（REQ-015 #186：aiclaw 改名等场景）。
     * 只改已有缓存项（好友缓存 + 各群成员列表），不播种新条目、不发请求；
     * 与 updateUserItem 的整表重拉相比是轻量即时路径。
     */
    const patchCachedUserInfo = (uid: string, patch: Partial<Pick<UserItem, 'name' | 'avatar' | 'resume'>>) => {
      const key = String(uid)
      Object.values(userListMap.value).forEach((list) => {
        const item = list.find((user) => String(user.uid) === key)
        if (item) Object.assign(item, patch)
      })
      const cached = friendInfoCache.get(key)
      if (cached) Object.assign(cached, patch)
    }

    const getUserInfo = computed(() => (uid: string, roomId?: string) => {
      const targetRoomId = roomId ?? globalStore.currentSessionRoomId
      if (targetRoomId) {
        const userInRoom = userMapByRoomId.value.get(targetRoomId)?.get(uid)
        if (userInRoom) {
          return userInRoom
        }
      }

      return allUserMap.value.get(uid) || friendInfoCache.get(uid)
    })

    const userDisplayNameMap = computed(() => {
      const map = new Map<string, string>()
      userList.value.forEach((item) => {
        map.set(item.uid, item.myName || item.name || '')
      })
      return map
    })

    const getUserDisplayName = computed(() => (uid: string) => {
      return userDisplayNameMap.value.get(uid) || ''
    })

    const allUserInfo = computed(() => {
      const set = new Set<UserItem>()
      Object.values(userListMap.value)
        .flat()
        .forEach((user) => {
          set.add(user)
        })
      return Array.from(set)
    })

    const updateGroupDetail = async (roomId: string, detail: Partial<GroupDetailReq>) => {
      const targetGroup = groupDetails.value.find((item) => item.roomId === roomId)!
      const newData = {
        ...targetGroup,
        ...detail
      }
      Object.assign(targetGroup, newData)
    }

    const updateOnlineNum = (options: { uid?: string; roomId?: string; onlineNum?: number; isAdd?: boolean }) => {
      const { uid, roomId, onlineNum, isAdd } = options

      if (roomId) {
        // 如果传了 roomId，只修改该房间的 onlineNum
        const groupDetail = groupDetails.value.find((detail) => detail.roomId === roomId)
        if (groupDetail) {
          if (onlineNum) {
            groupDetail.onlineNum = onlineNum
          } else {
            if (isAdd) {
              groupDetail.onlineNum++
            } else {
              groupDetail.onlineNum--
            }
          }
        }
      } else {
        // 如果没有传 roomId, 说明是全局更新
        const roomIds = getRoomIdsByUid(uid!)

        // 遍历找到的所有房间ID，更新对应群组的在线人数
        roomIds.forEach((roomId) => {
          const groupDetail = groupDetails.value.find((detail) => detail.roomId === roomId)
          if (groupDetail) {
            if (isAdd) {
              groupDetail.onlineNum++
            } else {
              groupDetail.onlineNum--
            }
          }
        })
      }
    }

    /**
     * 获取当前群主ID
     * 从成员列表中筛选出角色为群主的用户
     */
    const currentLordId = computed(() => {
      const list = userList.value.filter((member: UserItem) => member.roleId === RoleEnum.LORD)
      if (list.length) {
        return list[0]?.uid
      }
      return -99
    })

    const isCurrentLord = computed(() => (uid: string) => {
      return chatStore.isGroup && currentLordId.value === uid
    })

    /**
     * 获取当前管理员ID列表
     * 从成员列表中筛选出所有管理员的uid
     */
    const adminUidList = computed(() => {
      return userList.value
        .filter((member: UserItem) => member.roleId === RoleEnum.ADMIN)
        .map((member: UserItem) => member.uid)
    })

    /**
     * 更新管理员状态
     * @param roomId 房间ID
     * @param uids 被设置、取消管理员的用户ID列表
     * @param isAdmin 是否为管理员
     */
    /**
     * #484：管理员变更提示——不再按旧载荷写 roleId（旧 grant 会盖回已撤销的权限）。
     */
    const updateAdminStatus = (roomId: string, _uids: string[], _isAdmin: boolean) => {
      if (!roomId) return
      invalidateGroupUse(roomId, 'admin-change')
    }

    /**
     * 检查用户是否为管理员
     * @param uid 用户ID
     * @returns 是否为管理员
     */
    const isAdmin = computed(() => (uid: string) => {
      return chatStore.isGroup && adminUidList.value.includes(uid)
    })

    /**
     * 获取管理员基本信息列表
     * 根据管理员ID列表获取详细信息
     */
    const adminList = computed<UserItem[]>(() => {
      return userList.value.filter((member: UserItem) => adminUidList.value.includes(member.uid))
    })

    const getCurrentUser = (): UserItem => {
      return userList.value.find((member: UserItem) => member.uid === userStore.userInfo!.uid)!
    }

    const removeGroupDetail = (roomId: string) => {
      groupDetails.value = groupDetails.value.filter((item) => item.roomId !== roomId)
    }

    const isAdminOrLord = () => {
      const currentUser = getCurrentUser()
      return isAdmin.value(currentUser.uid) || isCurrentLord.value(currentUser.uid)
    }

    /**
     * 获取所有成员的基本信息列表
     * 包含角色信息（群主/管理员/普通成员）
     */
    const memberList = computed(() => {
      const memberInfoList = userList.value
      return memberInfoList.map((member: UserItem) => {
        if (adminUidList.value.includes(member.uid)) {
          return {
            ...member,
            account: member.account,
            roleId: RoleEnum.ADMIN
          }
        } else if (member.uid === currentLordId.value) {
          return {
            ...member,
            account: member.account,
            roleId: RoleEnum.LORD
          }
        }
        return member
      })
    })

    // 群组基本信息
    const countInfo = computed(() => {
      return groupDetails.value.find((item: GroupDetailReq) => item.roomId === globalStore.currentSessionRoomId)
    })

    const getGroupDetailByRoomId = computed(() => (roomId: string) => {
      return groupDetails.value.find((item: GroupDetailReq) => item.roomId === roomId)
    })

    // 状态定义：添加一个用于管理正在进行的请求的Map
    const fetchPromisesMap = ref<Record<string, Promise<GroupDetailReq>>>({})

    /**
     * 智能获取群组详情：如果本地有则直接返回，如果没有则从远程获取并缓存
     * @param roomId 群组ID
     */
    const fetchGroupDetailSafely = async (roomId: string, forceRefresh: boolean = false): Promise<GroupDetailReq> => {
      // 1. 检查本地缓存（除非强制刷新）
      const existingDetail = getGroupDetailByRoomId.value(roomId)
      if (existingDetail && !forceRefresh) {
        return existingDetail
      }

      // 2. 防止并发重复请求
      try {
        // 3. 创建新的请求Promise并缓存
        fetchPromisesMap.value[roomId] = (async () => {
          try {
            // 调用你已有的远程获取方法
            await addGroupDetail(roomId)

            const finalDetail = getGroupDetailByRoomId.value(roomId)
            if (!finalDetail) {
              throw new Error(`群组 ${roomId} 数据获取失败`)
            }
            return finalDetail
          } finally {
            // 清理当前请求的缓存
            delete fetchPromisesMap.value[roomId]
          }
        })()

        // 4. 等待请求完成并返回结果
        return await fetchPromisesMap.value[roomId]
      } catch (error) {
        console.error(`获取群组 ${roomId} 详情失败:`, error)
        throw error
      }
    }

    /**
     * 本地获取房间信息
     */
    const getGroupDetail = computed(() => (roomId: string) => {
      return groupDetailsCache.value[roomId] || getGroupDetailByRoomId.value(roomId)
    })

    const loadGroupDetails = async (roomIds: string[]) => {
      const uniqueRoomIds = [...new Set(roomIds.filter((id) => id))]

      for (const roomId of uniqueRoomIds) {
        if (groupDetailsCache.value[roomId] || loadingGroups.value.has(roomId)) {
          continue
        }

        loadingGroups.value.add(roomId)
        try {
          const detail = await fetchGroupDetailSafely(roomId)
          groupDetailsCache.value[roomId] = detail
        } catch (_error) {
        } finally {
          loadingGroups.value.delete(roomId)
        }
      }
    }

    /**
     * #484：人数/在线数只作提示——WS 载荷可能晚于更新事实，不能直接覆盖。
     * 活跃房间由当前读（memberCount 用 DB 口径）接管；这里仅作失效提示。
     */
    const updateGroupNumber = (roomId: string, _totalNum: number, _onlineNum: number) => {
      if (!roomId) return
      invalidateGroupUse(roomId, 'member-count')
    }

    /**
     * 获取群成员列表
     * @param roomId 群聊房间ID
     * @param forceRefresh 是否强制刷新,默认false
     */
    const getGroupUserList = async (roomId: string, forceRefresh = false) => {
      if (!roomId) {
        console.warn('[group] skip member refresh, invalid room id:', roomId)
        return []
      }

      // 已确认解散的房间不再发起成员拉取，杜绝迟到请求弹网络错误
      if (dissolvedRoomIds.has(roomId)) {
        return []
      }

      const session = chatStore.getSession(roomId)
      if (session && session.type !== RoomTypeEnum.GROUP) {
        console.warn('[group] skip member refresh, room is not group:', roomId)
        return []
      }

      const cachedList = userListMap.value[roomId]

      if (!forceRefresh && Array.isArray(cachedList) && cachedList.length > 0) {
        return cachedList
      }

      if (!Array.isArray(cachedList)) {
        setRoomMemberList(roomId, [])
      }

      const data = await ImRequestUtils.groupListMember(roomId, {
        showError: !isRoomErrorToastSuppressed(roomId)
      })
      if (!data) {
        userListOptions.value.loading = false
        return []
      }

      userListOptions.value.loading = false

      const list = Array.isArray(data) ? [...data] : []
      updateMemberCache(roomId, list)

      return userListMap.value[roomId]
    }

    const cleanupSession = () => {
      currentSessionState.value = {
        roomId: '',
        loading: false,
        lastLoadedRoomId: ''
      }
    }

    /**
     * 加载更多群成员
     * 分页加载，防止重复加载
     */
    const loadMoreGroupMembers = async () => {
      if (userListOptions.value.isLast || userListOptions.value.loading) return
      userListOptions.value.loading = true
      await getGroupUserList(globalStore.currentSessionRoomId)
      userListOptions.value.loading = false
    }

    /**
     * 更新 userListMap 中某个用户的信息
     * @param uid 用户ID
     * @param updates 要更新的用户信息（部分字段）
     * @param roomId 群聊房间ID，可选，默认使用当前房间；如果传入 'all' 则更新所有房间中的该用户
     * @returns 是否成功更新
     */
    const updateUserItem = (uid: string, updates: Partial<UserItem>, roomId: string | 'all' = 'all'): boolean => {
      if (!uid || typeof uid !== 'string') {
        console.warn('[updateUserItem] invalid uid:', uid)
        return false
      }

      if (!updates || typeof updates !== 'object') {
        console.warn('[updateUserItem] invalid update payload:', updates)
        return false
      }

      const refreshTargets = new Set<string>()

      if (roomId === 'all') {
        getRoomIdsByUid(uid).forEach((room) => {
          refreshTargets.add(room)
        })
      } else {
        const targetRoomId = roomId || globalStore.currentSessionRoomId
        if (!targetRoomId) {
          return false
        }
        refreshTargets.add(targetRoomId)
      }

      if (refreshTargets.size === 0) {
        return false
      }

      refreshTargets.forEach((validRoomId) => {
        const session = chatStore.getSession(validRoomId)
        if (session && session.type === RoomTypeEnum.GROUP) {
          getGroupUserList(validRoomId, true).catch((error) => {
            console.error('[group] refresh members failed:', error)
          })
        }
      })

      return true
    }

    /**
     * 向 userListMap 中添加新的用户
     * @param userItem 要添加的用户信息
     * @param roomId 群聊房间ID，可选，默认使用当前房间；如果传入 'all' 则添加到所有房间中
     * @param allowDuplicate 是否允许重复添加，默认为 false
     * @returns 是否成功添加
     */
    const addUserItem = (userItem: UserItem, roomId?: string): boolean => {
      if (!userItem || typeof userItem !== 'object' || !userItem.uid) {
        console.warn('[addUserItem] invalid user info:', userItem)
        return false
      }

      const targetRoomId = roomId || globalStore.currentSessionRoomId
      if (!targetRoomId) {
        console.warn('[addUserItem] cannot determine target room id')
        return false
      }

      const session = chatStore.getSession(targetRoomId)
      if (!session || session.type !== RoomTypeEnum.GROUP) {
        console.warn('[addUserItem] skip, room is not group:', targetRoomId)
        return false
      }

      getGroupUserList(targetRoomId, true).catch((error) => {
        console.error('[group] refresh members failed:', error)
      })

      return true
    }

    /**
     * 从 userListMap 中移除指定用户
     * @param uid 要移除的用户ID
     * @param roomId 群聊房间ID，可选，默认使用当前房间；如果传入 'all' 则从所有房间中移除
     * @returns 是否成功移除
     */
    const removeUserItem = (uid: string, roomId?: string): boolean => {
      if (!uid || typeof uid !== 'string') {
        console.warn('[removeUserItem] invalid uid:', uid)
        return false
      }

      const targetRoomId = roomId || globalStore.currentSessionRoomId
      if (!targetRoomId) {
        console.warn('[removeUserItem] cannot determine target room id')
        return false
      }

      const session = chatStore.getSession(targetRoomId)
      if (!session || session.type !== RoomTypeEnum.GROUP) {
        console.warn('[removeUserItem] skip, room is not group:', targetRoomId)
        return false
      }

      getGroupUserList(targetRoomId, true).catch((error) => {
        console.error('[group] refresh members failed:', error)
      })

      return true
    }

    /**
     * 移除 某个房间中的所有user 数据（REQ-017 #208：整键清除，含派生缓存）
     *
     * 房间生命周期终点（退群/解散/被踢）必须整键删除而非置空数组——
     * 残留的 userListMap[roomId] 会让 getRoomIdsByUid 继续返回陈旧 roomId，
     * 驱动 aiclaw 群配置遍历等下游打到 server 必炸（#196 治标/#202 审计定性）。
     * @param roomId
     */
    const removeAllUsers = (roomId: string) => {
      delete userListMap.value[roomId]
      delete memberOrderCounters[roomId]
      delete onlineCountMap.value[roomId]
    }

    /**
     * 添加群管理员
     * @param uidList 要添加为管理员的用户ID列表
     */
    const addAdmin = async (uidList: string[]) => {
      // #484：冻结发起时的房间，await 之后不得再读 currentSessionRoomId（会把结果写进新房间）
      const targetRoomId = globalStore.currentSessionRoomId
      // REQ-017 #200：showError:false 静默底层 network_error——调用方（右键设管理）有领域失败 toast
      const result = await ImRequestUtils.addAdmin({ roomId: targetRoomId, uidList }, { showError: false })
      if (!targetRoomId) return result

      // 业务已提交：结果以服务端当前事实为准，旧在飞响应不得把角色改回去（设计 §4.2）
      invalidateGroupUse(targetRoomId, 'admin-set')
      await ensureGroupUse(targetRoomId)
      return result
    }

    /**
     * 撤销群管理员身份
     * @param uidList 要撤销的管理员ID列表
     */
    const revokeAdmin = async (uidList: string[]) => {
      const targetRoomId = globalStore.currentSessionRoomId
      // REQ-017 #200：showError:false 静默底层 network_error——调用方（右键撤管理）有领域失败 toast
      const result = await ImRequestUtils.revokeAdmin({ roomId: targetRoomId, uidList }, { showError: false })
      if (!targetRoomId) return result

      invalidateGroupUse(targetRoomId, 'admin-revoke')
      await ensureGroupUse(targetRoomId)
      return result
    }

    /**
     * 踢出群成员
     * @param uidList 要踢出的成员ID列表
     * @param roomId 群聊房间ID，可选，默认使用当前房间
     */
    const removeGroupMembers = async (uidList: string[], roomId?: string) => {
      const targetRoomId = roomId || globalStore.currentSessionRoomId
      if (!targetRoomId) {
        throw new Error('无法确定目标房间ID')
      }

      // 调用踢人接口（REQ-017 #200：showError:false 静默底层——踢人弹窗有领域失败 toast）
      await ImRequestUtils.removeGroupMember({ roomId: targetRoomId, uidList }, { showError: false })

      // #484：踢人已提交，成员事实以服务端当前读为准（旧 WS 载荷不得再写回）
      invalidateGroupUse(targetRoomId, 'member-remove')
      await ensureGroupUse(targetRoomId)
    }

    /**
     * 退出群聊 / 解散群聊
     * @param roomId 要退出的群聊ID
     */
    const exitGroup = async (roomId: string) => {
      if (!roomId) return

      // REQ-017 #200：showError:false 静默底层 network_error——解散（dissolve_failed）/
      // 退出（exit_failed / leave_failed）均有领域 toast，底层直出 = 双 toast（本 issue 报障场景）
      await ImRequestUtils.exitGroup({ roomId }, { showError: false })

      // REQ-017 #208：退群/解散后整键清除本房间成员缓存（治本）——
      // 旧逻辑只过滤自己，其他成员（含 aiclaw）残留导致 getRoomIdsByUid 返回陈旧 roomId
      removeAllUsers(roomId)

      // 删除对应的群详情缓存
      removeGroupDetail(roomId)

      // 更新会话列表，使用传入的 roomId
      chatStore.removeSession(roomId)

      // 如果退出的是当前选中的会话，则切换到新的当前会话
      if (globalStore.currentSessionRoomId === roomId) {
        const fallbackSession = chatStore.sessionList[0]
        globalStore.updateCurrentSessionRoomId(fallbackSession ? fallbackSession.roomId : '')
      }
    }

    /**
     * 用于处理在线状态变更时的群成员列表刷新
     */
    const refreshGroupMembers = async () => {
      // 始终刷新频道成员列表
      await getGroupUserList('1', true)

      // 如果当前选中的是群聊且不是频道，则同时刷新当前群聊的成员列表
      if (globalStore.currentSession?.type === RoomTypeEnum.GROUP && globalStore.currentSessionRoomId !== '1') {
        await getGroupUserList(globalStore.currentSessionRoomId, true)
      }
    }

    /**
     * 重置群组数据
     * 用于切换会话时清空当前群组的数据
     * @param roomId 可选，指定要清理的房间ID，不传则清理所有
     */
    const resetGroupData = () => {
      userListOptions.value.cursor = ''
      userListOptions.value.isLast = false
      userListOptions.value.loading = false
    }

    /**
     * 获取指定房间的用户列表
     * @param roomId 房间ID
     * @returns 用户列表
     */
    const getUserListByRoomId = (roomId: string): UserItem[] => {
      return userListMap.value[roomId] || []
    }

    const getUser = (roomId: string, uid: string): UserItem | undefined => {
      const roomUserList = userListMap.value[roomId]
      if (!roomUserList) {
        return undefined
      }
      return roomUserList.find((item) => item.uid === uid)
    }

    /**
     * 根据用户ID查找该用户所在的所有房间ID
     * @param uid 用户ID
     * @returns 包含该用户的所有房间ID数组
     */
    const getRoomIdsByUid = (uid: string): string[] => {
      const roomIds: string[] = []

      // 遍历所有房间的用户列表
      Object.keys(userListMap.value).forEach((roomId) => {
        const userList = userListMap.value[roomId]
        if (!Array.isArray(userList) || userList.length === 0) {
          return
        }
        // 检查当前房间是否包含指定的用户
        const hasUser = userList.some((user) => user.uid === uid)
        if (hasUser) {
          roomIds.push(roomId)
        }
      })

      return roomIds
    }

    watch(
      sessionBinding,
      () => {
        groupDetailsCache.value = {}
        loadingGroups.value.clear()
        dissolvedRoomIds.clear()
        friendInfoCache.clear()
        // #484：账号/后端代次变化，旧群事实与在飞请求全部作废（设计 §4.1）
        resetGroupUseState()
        for (const key of Object.keys(memberOrderCounters)) delete memberOrderCounters[key]
      },
      { flush: 'sync' }
    )

    return {
      userList,
      userListMap,
      userListOptions,
      loadMoreGroupMembers,
      getGroupUserList,
      updateUserItem,
      addUserItem,
      removeUserItem,
      currentLordId,
      adminUidList,
      adminList,
      memberList,
      addAdmin,
      revokeAdmin,
      removeGroupMembers,
      exitGroup,
      refreshGroupMembers,
      resetGroupData,
      getUserListByRoomId,
      countInfo,
      getUser,
      getRoomIdsByUid,
      onlineCountMap,
      updateOnlineNum,
      removeAllUsers,
      getCurrentUser,
      myNameInCurrentGroup,
      myRoleIdInCurrentGroup,
      setGroupDetails,
      updateGroupDetail,
      groupDetails,
      getGroupDetailByRoomId,
      getGroupDetail,
      loadGroupDetails,
      updateGroupNumber,
      removeGroupDetail,
      addGroupDetail,
      updateAdminStatus,
      switchSession,
      getCurrentSessionState,
      getCachedMembers,
      updateMemberCache,
      getUserInfo,
      cacheFriendInfo,
      patchCachedUserInfo,
      allUserInfo,
      getUserDisplayName,
      isCurrentLord,
      isAdmin,
      isAdminOrLord,
      cleanupSession,
      suppressMemberFetchError,
      releaseMemberFetchError,
      markRoomDissolved,
      isRoomDissolved,
      groupUseStates,
      ensureGroupUse,
      invalidateGroupUse,
      applyGroupUseResult
    }
  },
  {
    // #239：B 类 Map/Set 键 omit——序列化恒 {}（探针 P3 固化），跨窗只走既有事件路径（#237 终裁第 2 条）。
    // 这两键当前是 setup 闭包内部状态（未 return、不在 $state，本就不参与广播）；
    // omit 是前向防御——防未来被 return 暴露时静默开始广播 {} 损坏收方。
    share: {
      enable: true,
      initialize: true,
      // cast：两键非状态键、不在 keyof 州类型内——保留前向防御值（插件运行期按字符串 includes 判定）
      omit: ['dissolvedRoomIds', 'friendInfoCache'] as never
    },
    // #239：只主窗持久化，辅窗 noop——防多窗 last-writer-wins 快照倒退（#237 终裁第 4 条）
    persist: { storage: scopedChatStorage() }
  }
)
