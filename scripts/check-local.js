import chalk from 'chalk'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// 用于检查和创建 src-tauri/configuration/local.yaml 配置文件
const configDir = join(process.cwd(), 'src-tauri', 'configuration')
const localConfigPath = join(configDir, 'local.yaml')
const productionConfigPath = join(configDir, 'production.yaml')

try {
  if (existsSync(localConfigPath)) {
    console.log(chalk.green('✅ 检测到 local.yaml 已存在，跳过创建'))
    process.exit(0)
  }

  let content = ''

  // 优先使用 production.yaml 作为模板，因为它包含更完整的配置
  if (existsSync(productionConfigPath)) {
    content = readFileSync(productionConfigPath, 'utf8')
    console.log(chalk.blue('📋 使用 production.yaml 作为模板'))
  } else {
    console.log(chalk.red('❌ 未找到任何配置文件模板'))
    process.exit(1)
  }

  // aichatoverview#249：production.yaml 现在指向真实生产环境，直接拷贝会让
  // debug 构建（tauri:dev 默认读 local.yaml）静默连上生产。生成时把 backend
  // 地址替换为本机回环占位，强制开发者显式改成本机/团队开发节点（fail-closed）。
  content = content
    .replace(/^(\s*base_url:\s*).+$/m, '$1http://127.0.0.1:18080/api')
    .replace(/^(\s*ws_url:\s*).+$/m, '$1ws://127.0.0.1:18080/api/ws/ws')

  // fail-closed：两处替换必须都命中（模板格式漂移时宁可报错，
  // 也绝不把生产地址静默拷进 local.yaml）
  if (
    !content.includes('base_url: http://127.0.0.1:18080/api') ||
    !content.includes('ws_url: ws://127.0.0.1:18080/api/ws/ws')
  ) {
    console.log(chalk.red('❌ production.yaml 模板格式已漂移，backend 占位替换未命中，请检查模板后重试'))
    process.exit(1)
  }

  content =
    '# local.yaml —— 本机开发配置（gitignored，不进仓库）\n' +
    '# 本文件由 check-local.js 自动生成：backend 已占位为本机回环，\n' +
    '# 请改成你的开发节点地址（如 http://192.168.x.x:18080/api 与对应 ws:// .../api/ws/ws）。\n' +
    content

  writeFileSync(localConfigPath, content, 'utf8')
  console.log(chalk.green('✨ 已创建 local.yaml 配置文件'))
  console.log(chalk.yellow('⚠️  backend 地址为回环占位，请编辑 src-tauri/configuration/local.yaml 指向你的开发节点'))
} catch (error) {
  console.log(chalk.red('\n❌ 处理 local.yaml 文件失败：'), error.message)
  process.exit(1)
}
