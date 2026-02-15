export enum WsResponseMessageType {
  LOGIN_SUCCESS = 'loginSuccess',
  RECEIVE_MESSAGE = 'receiveMessage',
  ONLINE = 'online',
  OFFLINE = 'offline',
  TOKEN_EXPIRED = 'tokenExpired',
  USER_STATE_CHANGE = 'userStateChange',
  FEED_SEND_MSG = 'feedSendMsg',
  FEED_NOTIFY = 'feedNotify',
  MSG_RECALL = 'msgRecall',
  REQUEST_NEW_FRIEND = 'requestNewFriend'
}

export type LoginSuccessResType = {
  avatar: string
  name: string
  uid: string
  account: string
  token: string
}

export type OnStatusChangeType = {
  uid: string
  type: number
  roomId: string
  onlineNum: number
  lastOptTime: number
}

export type WsTokenExpire = {
  uid: string
  ip: string
  client: string
}
