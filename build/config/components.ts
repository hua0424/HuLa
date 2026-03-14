/** 需要加载移动端 UI 组件的平台（包含 web，因为 web 模式复用移动端界面） */
const MOBILE_UI_PLATFORMS = new Set(['android', 'ios', 'web'])

/** 标准化平台标识，确保比较逻辑一致 */
const normalizePlatform = (platform?: string) => {
  return platform?.trim().toLowerCase()
}

/** 判断该平台是否需要加载移动端 UI 组件（非"是否为移动设备"） */
export const isMobileUIPlatform = (platform?: string) => {
  return MOBILE_UI_PLATFORMS.has(normalizePlatform(platform) ?? '')
}

/** 根据平台返回自动导入插件需要扫描的组件目录 */
export const getComponentsDirs = (platform?: string) => {
  if (isMobileUIPlatform(platform)) {
    return ['src/components/**', 'src/mobile/components/**']
  }
  return ['src/components/**']
}

/** 按平台选择对应的组件类型声明文件路径 */
export const getComponentsDtsPath = (platform?: string) => {
  return isMobileUIPlatform(platform) ? 'src/typings/components.mobile.d.ts' : 'src/typings/components.pc.d.ts'
}
