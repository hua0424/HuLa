import { isMobile, isWeb } from '@/utils/PlatformConstants'

/**
 * REQ-017 #198：WS 鉴权失败（server 4001 关闭码 + token 刷新自愈失败 / web 直连 4001）后的跳登录重鉴流程。
 *
 * 与 TOKEN_EXPIRED（异地登录）的区别：
 * - 语义是「登录状态已失效」而非「账号在其他设备登录」，登录窗弹窗文案不同（sessionExpired 载荷）；
 * - 无 uid/client 匹配（4001 就是本连接自身 token 失效，不存在他端歧义）。
 *
 * 桌面端：先把 sessionExpired 载荷递交给登录窗（登录窗 mount 时读 pending payload 弹失效提示），
 * 再走标准登出序列（logout 会拉起登录窗）；移动/web：重置登录态 → 登出 → 跳登录页。
 *
 * 重入安全：4001 与 HTTP 406 等链路可能并发触发，模块级守卫保证登出序列只执行一次。
 */
let handling = false

export const handleSessionExpired = async (): Promise<void> => {
  if (handling) return
  handling = true
  try {
    const { useLogin } = await import('@/hooks/useLogin')
    const { resetLoginState, logout } = useLogin()
    const { useSettingStore } = await import('@/stores/setting')
    const settingStore = useSettingStore()

    if (isMobile() || isWeb()) {
      // 1. 先重置登录状态（不请求接口，只清理本地）
      await resetLoginState()
      // 2. 调用登出方法
      await logout()

      settingStore.toggleLogin(false, false)

      // 3. 立即跳转到登录页，使用 replace 替换当前路由
      const router = (await import('@/router')).default
      await router.replace('/mobile/login')

      // 4. 跳转后再显示弹窗提示（仅在移动原生端，web 端跳转即可）
      if (isMobile()) {
        const { showDialog } = await import('vant')
        await import('vant/es/dialog/style')

        showDialog({
          title: '登录失效',
          message: '登录状态已失效，请重新登录',
          confirmButtonText: '我知道了',
          showCancelButton: false,
          closeOnClickOverlay: false,
          closeOnPopstate: false,
          allowHtml: false
        })
      }
    } else {
      // 桌面端：先递交 sessionExpired 载荷（登录窗 mount 时读取并弹「登录状态已失效」），再走登出序列
      const { useWindow } = await import('@/hooks/useWindow.ts')
      const { sendWindowPayload } = useWindow()
      const ImRequestUtils = await import('@/utils/ImRequestUtils')

      await sendWindowPayload('login', {
        sessionExpired: {
          timestamp: Date.now()
        }
      })
      await ImRequestUtils.logout({ autoLogin: settingStore.login.autoLogin })
      await resetLoginState()
      await logout()
    }
  } catch (error) {
    console.error('处理登录失效失败：', error)
  } finally {
    handling = false
  }
}
