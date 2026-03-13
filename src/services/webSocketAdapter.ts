/**
 * WebSocket 适配器
 *
 * 根据运行环境自动选择 Web 原生 WebSocket 实现或 Rust WebSocket 实现
 */

import { isWeb } from '@/utils/PlatformConstants'

const webSocketService: any = isWeb()
  ? import('./webSocketWeb').then((m) => m.default)
  : import('./webSocketRust').then((m) => m.default)

export default webSocketService
