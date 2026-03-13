import { ImUrlEnum } from '@/enums'
import { webImRequest } from '@/utils/webImRequest'
import { useLogin } from '@/hooks/useLogin'
import { useLoginHistoriesStore } from '@/stores/loginHistory'
import { useSettingStore } from '@/stores/setting'
import { useUserStore } from '@/stores/user'
import { useUserStatusStore } from '@/stores/userStatus'
import { getAllUserState, getUserDetail } from '@/utils/ImRequestUtils'
import { getEnhancedFingerprint } from '@/services/fingerprint'
import webSocketWebClient from '@/services/webSocketWeb'
import type { UserInfoType } from '@/services/types'

interface LoginResponse {
  token: string
  refreshToken: string
  client: string
  expire?: string
  uid?: string
}

export const webLoginCommand = async (
  info: Partial<{
    account: string
    password: string
    avatar: string
    name: string
    uid: string
  }>,
  auto: boolean = false
) => {
  const userStore = useUserStore()
  const settingStore = useSettingStore()

  const loginInfo = settingStore.login.autoLogin ? (userStore.userInfo as UserInfoType) : info
  const clientId = await getEnhancedFingerprint()

  const res = await webImRequest<LoginResponse>(ImUrlEnum.LOGIN, {
    account: loginInfo.account ?? '',
    password: loginInfo.password ?? '',
    deviceType: 'PC',
    systemType: 2,
    clientId,
    grantType: 'PASSWORD'
  })

  if (!res?.token) {
    throw new Error('[webLoginCommand] 登录失败：未获取到 token')
  }

  // 先将 token 存入 userStore，后续 webImRequest 和 WS 连接都依赖它
  userStore.userInfo = {
    ...(userStore.userInfo ?? {}),
    token: res.token,
    refreshToken: res.refreshToken,
    client: res.client
  } as any

  // 连接 WebSocket（initConnect 内部从 userStore 读取 token）
  await webSocketWebClient.initConnect()

  // 后续登录处理（getAllUserState/getUserDetail 也依赖 userStore.token）
  await webLoginProcess(res.token, res.refreshToken, res.client)
}

const webLoginProcess = async (token: string, refreshToken: string, client: string) => {
  const userStatusStore = useUserStatusStore()
  const userStore = useUserStore()
  const loginHistoriesStore = useLoginHistoriesStore()
  const { setLoginState } = useLogin()

  userStatusStore.stateList = await getAllUserState()

  const userDetail: any = await getUserDetail()
  userStatusStore.stateId = userDetail.userStateId

  const account = {
    ...userDetail,
    token,
    refreshToken,
    client
  }
  userStore.userInfo = account
  loginHistoriesStore.addLoginHistory(account)

  // Web 模式跳过 SQLite 存储，直接依赖 Pinia 持久化
  await setLoginState()

  // 跳转到移动端主页（替代 openHomeWindow 创建 Tauri 窗口）
  const router = await import('@/router')
  await router.default.push('/mobile/home')
}
