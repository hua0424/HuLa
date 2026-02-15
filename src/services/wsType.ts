/**
 * HuLa WebSocket 类型定义
 * @deprecated 已被 OpenClaw 协议层替代
 */

export enum WsResponseMessageType {
  LOGIN_SUCCESS = 'loginSuccess',
  RECEIVE_MESSAGE = 'receiveMessage',
  ONLINE = 'online',
  TOKEN_EXPIRED = 'tokenExpired'
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
