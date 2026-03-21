import { ImUrlEnum } from '@/enums'
import { WsResponseMessageType } from '@/services/wsType'
import { useMitt } from '@/hooks/useMitt'

/** 与 Rust im_request_client.rs 保持一致的 HTTP 方法 + 路径映射 */
const URL_MAP: Record<string, { method: string; path: string }> = {
  // Token / 认证相关
  login: { method: 'POST', path: 'oauth/anyTenant/login' },
  refreshToken: { method: 'POST', path: 'oauth/anyTenant/refresh' },
  forgetPassword: { method: 'PUT', path: 'oauth/anyTenant/password' },
  checkToken: { method: 'POST', path: 'oauth/check' },
  logout: { method: 'POST', path: 'oauth/anyUser/logout' },
  register: { method: 'POST', path: 'oauth/anyTenant/registerByEmail' },
  sendCaptcha: { method: 'POST', path: 'oauth/anyTenant/sendEmailCode' },
  getCaptcha: { method: 'GET', path: 'oauth/anyTenant/captcha' },
  generateQRCode: { method: 'GET', path: 'oauth/anyTenant/qr/generate' },
  checkQRStatus: { method: 'GET', path: 'oauth/anyTenant/qr/status/query' },
  scanQRCode: { method: 'POST', path: 'oauth/qrcode/scan' },
  confirmQRCode: { method: 'POST', path: 'oauth/qrcode/confirm' },

  // 系统相关
  getQiniuToken: { method: 'GET', path: 'system/anyTenant/ossToken' },
  initConfig: { method: 'GET', path: 'system/anyTenant/config/init' },
  storageProvider: { method: 'GET', path: 'system/anyTenant/storage/provider' },
  mapCoordTranslate: { method: 'GET', path: 'system/anyTenant/map/coord/translate' },
  mapReverseGeocode: { method: 'GET', path: 'system/anyTenant/map/geocoder/reverse' },
  mapStatic: { method: 'GET', path: 'system/anyTenant/map/static' },
  getAssistantModelList: { method: 'GET', path: 'system/model/list' },

  // 群公告相关
  announcement: { method: 'GET', path: 'im/room/announcement' },
  editAnnouncement: { method: 'POST', path: 'im/room/announcement/edit' },
  deleteAnnouncement: { method: 'POST', path: 'im/room/announcement/delete' },
  pushAnnouncement: { method: 'POST', path: 'im/room/announcement/push' },
  getAnnouncementList: { method: 'GET', path: 'im/room/announcement/list' },

  // 群聊申请相关
  applyGroup: { method: 'POST', path: 'im/room/apply/group' },

  // 群聊搜索和管理
  searchGroup: { method: 'GET', path: 'im/room/search' },
  updateMyRoomInfo: { method: 'POST', path: 'im/room/updateMyRoomInfo' },
  updateRoomInfo: { method: 'POST', path: 'im/room/updateRoomInfo' },
  groupList: { method: 'GET', path: 'im/room/group/list' },
  groupListMember: { method: 'GET', path: 'im/room/group/listMember' },
  groupDetail: { method: 'GET', path: 'im/room/group/detail' },
  groupInfo: { method: 'GET', path: 'im/room/group/info' },

  // 群聊管理员
  revokeAdmin: { method: 'DELETE', path: 'im/room/group/admin' },
  addAdmin: { method: 'PUT', path: 'im/room/group/admin' },

  // 群聊成员管理
  exitGroup: { method: 'DELETE', path: 'im/room/group/member/exit' },
  acceptInvite: { method: 'POST', path: 'im/room/group/invite/accept' },
  inviteList: { method: 'GET', path: 'im/room/group/invite/list' },
  inviteGroupMember: { method: 'POST', path: 'im/room/group/member' },
  removeGroupMember: { method: 'DELETE', path: 'im/room/group/member' },
  createGroup: { method: 'POST', path: 'im/room/group' },

  // 聊天会话相关
  shield: { method: 'POST', path: 'im/chat/setShield' },
  notification: { method: 'POST', path: 'im/chat/notification' },
  deleteSession: { method: 'DELETE', path: 'im/chat/delete' },
  setSessionTop: { method: 'POST', path: 'im/chat/setTop' },
  sessionDetailWithFriends: { method: 'GET', path: 'im/chat/contact/detail/friend' },
  sessionDetail: { method: 'GET', path: 'im/chat/contact/detail' },
  setHide: { method: 'POST', path: 'im/chat/setHide' },

  // 消息已读未读
  getMsgReadCount: { method: 'GET', path: 'im/chat/msg/read' },
  markMsgRead: { method: 'PUT', path: 'im/chat/msg/read' },
  sendMsg: { method: 'POST', path: 'im/chat/msg' },
  getMsgReadList: { method: 'GET', path: 'im/chat/msg/read/page' },

  // 好友相关
  modifyFriendRemark: { method: 'POST', path: 'im/user/friend/updateRemark' },
  deleteFriend: { method: 'DELETE', path: 'im/user/friend' },
  sendAddFriendRequest: { method: 'POST', path: 'im/room/apply/apply' },
  handleInvite: { method: 'POST', path: 'im/room/apply/handler/apply' },
  noticeUnReadCount: { method: 'GET', path: 'im/room/notice/unread' },
  requestNoticePage: { method: 'GET', path: 'im/room/notice/page' },
  getFriendPage: { method: 'GET', path: 'im/user/friend/page' },
  getContactList: { method: 'GET', path: 'im/chat/contact/list' },
  searchFriend: { method: 'GET', path: 'im/user/friend/search' },

  // 用户状态相关
  changeUserState: { method: 'POST', path: 'im/user/state/changeState' },
  getAllUserState: { method: 'GET', path: 'im/user/state/list' },

  // 用户信息相关
  uploadAvatar: { method: 'POST', path: 'im/user/avatar' },
  getEmoji: { method: 'GET', path: 'im/user/emoji/list' },
  deleteEmoji: { method: 'DELETE', path: 'im/user/emoji' },
  addEmoji: { method: 'POST', path: 'im/user/emoji' },
  setUserBadge: { method: 'PUT', path: 'im/user/badge' },
  ModifyUserInfo: { method: 'PUT', path: 'im/user/info' },
  getUserInfoDetail: { method: 'GET', path: 'im/user/userInfo' },
  getBadgesBatch: { method: 'POST', path: 'im/user/badges/batch' },
  getBadgeList: { method: 'GET', path: 'im/user/badges' },
  blockUser: { method: 'PUT', path: 'im/user/black' },
  getUserByIds: { method: 'POST', path: 'im/user/getUserByIds' },

  // 消息相关
  recallMsg: { method: 'PUT', path: 'im/chat/msg/recall' },
  markMsg: { method: 'PUT', path: 'im/chat/msg/mark' },
  getMsgPage: { method: 'GET', path: 'im/chat/msg/page' },
  getMsgList: { method: 'POST', path: 'im/chat/msg/list' },
  getMemberStatistic: { method: 'GET', path: 'im/chat/member/statistic' },
  mergeMsg: { method: 'POST', path: 'im/room/mergeMessage' },

  // 朋友圈相关
  feedList: { method: 'POST', path: 'im/feed/list' },
  pushFeed: { method: 'POST', path: 'im/feed/pushFeed' },
  getFeedPermission: { method: 'GET', path: 'im/feed/getFeedPermission' },
  editFeed: { method: 'POST', path: 'im/feed/edit' },
  delFeed: { method: 'POST', path: 'im/feed/del' },
  feedDetail: { method: 'GET', path: 'im/feed/detail' },
  feedLikeToggle: { method: 'POST', path: 'im/feed/like/toggle' },
  feedLikeList: { method: 'GET', path: 'im/feed/like/list' },
  feedLikeCount: { method: 'GET', path: 'im/feed/like/count' },
  feedLikeHasLiked: { method: 'GET', path: 'im/feed/like/hasLiked' },
  feedCommentAdd: { method: 'POST', path: 'im/feed/comment/add' },
  feedCommentDelete: { method: 'POST', path: 'im/feed/comment/delete' },
  feedCommentList: { method: 'POST', path: 'im/feed/comment/list' },
  feedCommentAll: { method: 'GET', path: 'im/feed/comment/all' },
  feedCommentCount: { method: 'GET', path: 'im/feed/comment/count' },

  // AI 聊天消息
  messageSend: { method: 'POST', path: 'ai/chat/message/send' },
  messageSendStream: { method: 'POST', path: 'ai/chat/message/send-stream' },
  messageListByConversationId: { method: 'GET', path: 'ai/chat/message/list-by-conversation-id' },
  messageDelete: { method: 'DELETE', path: 'ai/chat/message/delete' },
  messageDeleteByConversationId: { method: 'DELETE', path: 'ai/chat/message/delete-by-conversation-id' },
  messagePage: { method: 'GET', path: 'ai/chat/message/page' },
  messageDeleteByAdmin: { method: 'DELETE', path: 'ai/chat/message/delete-by-admin' },
  messageSaveGeneratedContent: { method: 'POST', path: 'ai/chat/message/save-generated-content' },

  // AI 聊天对话
  conversationCreateMy: { method: 'POST', path: 'ai/chat/conversation/create-my' },
  conversationUpdateMy: { method: 'PUT', path: 'ai/chat/conversation/update-my' },
  conversationMyList: { method: 'GET', path: 'ai/chat/conversation/my-list' },
  conversationGetMy: { method: 'GET', path: 'ai/chat/conversation/get-my' },
  conversationDeleteMy: { method: 'DELETE', path: 'ai/chat/conversation/delete-my' },
  conversationPage: { method: 'GET', path: 'ai/chat/conversation/page' },

  // AI 模型相关
  modelCreate: { method: 'POST', path: 'ai/model/create' },
  modelUpdate: { method: 'PUT', path: 'ai/model/update' },
  modelDelete: { method: 'DELETE', path: 'ai/model/delete' },
  modelGet: { method: 'GET', path: 'ai/model/get' },
  modelRemainingUsage: { method: 'GET', path: 'ai/model/get-remaining-usage' },
  modelPage: { method: 'GET', path: 'ai/model/page' },
  modelSimpleList: { method: 'GET', path: 'ai/model/simple-list' },

  // 聊天角色相关
  chatRolePage: { method: 'GET', path: 'ai/chat-role/page' },
  chatRoleCategoryList: { method: 'GET', path: 'ai/chat-role/category-list' },
  chatRoleCreate: { method: 'POST', path: 'ai/chat-role/create' },
  chatRoleUpdate: { method: 'PUT', path: 'ai/chat-role/update' },
  chatRoleDelete: { method: 'DELETE', path: 'ai/chat-role/delete' },

  // API 密钥相关
  apiKeyPage: { method: 'GET', path: 'ai/api-key/page' },
  apiKeySimpleList: { method: 'GET', path: 'ai/api-key/simple-list' },
  apiKeyCreate: { method: 'POST', path: 'ai/api-key/create' },
  apiKeyUpdate: { method: 'PUT', path: 'ai/api-key/update' },
  apiKeyDelete: { method: 'DELETE', path: 'ai/api-key/delete' },
  apiKeyBalance: { method: 'GET', path: 'ai/api-key/balance' },

  // 平台相关
  platformList: { method: 'GET', path: 'ai/platform/list' },
  platformAddModel: { method: 'POST', path: 'ai/platform/add-model' },

  // AI 绘画
  imageMyPage: { method: 'GET', path: 'ai/image/my-page' },
  imageGet: { method: 'GET', path: 'ai/image/get-my' },
  imageDraw: { method: 'POST', path: 'ai/image/draw' },
  imageMyListByIds: { method: 'GET', path: 'ai/image/my-list-by-ids' },
  imageDeleteMy: { method: 'DELETE', path: 'ai/image/delete-my' },

  // AI 视频生成
  videoMyPage: { method: 'GET', path: 'ai/video/my-page' },
  videoGet: { method: 'GET', path: 'ai/video/get' },
  videoMyListByIds: { method: 'GET', path: 'ai/video/my-list-by-ids' },
  videoGenerate: { method: 'POST', path: 'ai/video/generate' },
  videoDeleteMy: { method: 'DELETE', path: 'ai/video/delete-my' },

  // AI 音频生成
  audioMyPage: { method: 'GET', path: 'ai/audio/my-page' },
  audioGetMy: { method: 'GET', path: 'ai/audio/get-my' },
  audioMyListByIds: { method: 'GET', path: 'ai/audio/my-list-by-ids' },
  audioGenerate: { method: 'POST', path: 'ai/audio/generate' },
  audioDeleteMy: { method: 'DELETE', path: 'ai/audio/delete-my' },
  audioVoices: { method: 'GET', path: 'ai/audio/voices' },

  // AIclaw AI 助理（固定路径）
  aiclawCreate: { method: 'POST', path: 'im/aiclaw/create' },
  aiclawList: { method: 'GET', path: 'im/aiclaw/list' },
  // 以下接口为动态路径，需要调用方通过 params._pathUid 传入 uid 替换 {uid}
  aiclawProfile: { method: 'PUT', path: 'im/aiclaw/{uid}/profile' },
  aiclawActivationToken: { method: 'GET', path: 'im/aiclaw/{uid}/activation-token' },
  aiclawRefreshActivation: { method: 'POST', path: 'im/aiclaw/{uid}/refresh-activation' },
  aiclawDeactivate: { method: 'POST', path: 'im/aiclaw/{uid}/deactivate' },
  aiclawRestore: { method: 'POST', path: 'im/aiclaw/{uid}/restore' },
  aiclawAuthConfirm: { method: 'POST', path: 'im/aiclaw/{uid}/auth-confirm' }
}

// 与联调契约一致：Authorization 头直接使用 base64 值（无 "Basic " 前缀）
// 客户端凭证：luohuo_web:luohuo_web_secret（来自数据库 def_client 表）
const BASIC_AUTH = btoa('luohuo_web:luohuo_web_secret')

/**
 * Web 模式 IM HTTP 请求工具，替代 invoke('im_request_command')
 */
export async function webImRequest<T = any>(
  url: ImUrlEnum,
  body?: any,
  params?: Record<string, any>
): Promise<T> {
  const baseUrl = import.meta.env.VITE_WEB_API_URL
  if (!baseUrl) {
    throw new Error('[webImRequest] VITE_WEB_API_URL 未配置')
  }

  const mapping = URL_MAP[url as string]
  if (!mapping) {
    throw new Error(`[webImRequest] 未找到 URL 映射: ${url}`)
  }

  const { method } = mapping
  // 支持路径变量替换（如 {uid}）
  let resolvedPath = mapping.path
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      const placeholder = `{${k}}`
      if (resolvedPath.includes(placeholder)) {
        resolvedPath = resolvedPath.replace(placeholder, String(v))
        delete params[k]
      }
    }
  }

  // 构建完整 URL，附加查询参数
  let fullUrl = `${baseUrl}/${resolvedPath}`
  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        if (Array.isArray(v)) {
          v.forEach((item) => searchParams.append(k, String(item)))
        } else {
          searchParams.set(k, String(v))
        }
      }
    }
    const qs = searchParams.toString()
    if (qs) fullUrl += `?${qs}`
  }

  // 获取用户 token
  const { useUserStore } = await import('@/stores/user')
  const userStore = useUserStore()
  const token = (userStore.userInfo as any)?.token

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: BASIC_AUTH
  }
  if (token) {
    headers['Token'] = token
  }

  const fetchOptions: RequestInit = {
    method,
    headers
  }

  // GET 不带 body，其他方法（含 DELETE）有 body 时携带
  if (method !== 'GET' && body !== undefined && body !== null) {
    fetchOptions.body = JSON.stringify(body)
  }

  const response = await fetch(fullUrl, fetchOptions)

  if (!response.ok) {
    throw new Error(`[webImRequest] HTTP ${response.status}: ${response.statusText}`)
  }

  const result = await response.json()

  // 后端统一响应格式: { code, success, data, msg }
  // code 406 = Token 已过期（HTTP 状态码仍为 200，需判断 code 字段）
  if (result && typeof result === 'object' && 'code' in result) {
    if (result.code === 406) {
      useMitt.emit(WsResponseMessageType.TOKEN_EXPIRED, { uid: userStore.userInfo?.uid })
      throw new Error('[webImRequest] Token 已过期 (code 406)')
    }
    if (result.code !== 200 && result.code !== 0) {
      throw new Error(`[webImRequest] 业务错误 ${result.code}: ${result.msg || '未知错误'}`)
    }
    return result.data as T
  }

  return result as T
}
