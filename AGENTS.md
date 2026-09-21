# HuLa 项目规范

HuLa 是 Tauri v2 / Rust + Vue 3 / TypeScript 客户端。此仓作为 AIChat 子模块时，遵守伞仓项目规范及 `../docs/agents/verification.md`；当前 checkout 分支不代表其他仓的目标版本。

## 编码与安全

- 2 空格缩进、LF；Biome 检查，Vue 模板使用现有 Prettier 配置。组件用 PascalCase，composable 用 useXxx，优先 `<script setup>` 与 UnoCSS。
- Pinia 使用 setup store；解构状态用 `storeToRefs`，业务动作放 actions，依赖 store 在 action 中实例化，持久化按需启用。
- 主题优先使用局部 UnoCSS；跨组件复用的语义色放 `src/styles/scss/global/variable.scss`，保持 light/dark 规则。
- 自动化使用的控件保持稳定 kebab-case `data-testid` 和 `aria-label`；更名时同步测试选择器。完整钩子参考按需读取。
- 删除未使用变量，不以 `_` 掩盖；提交、日志、文档不加 emoji。提交遵循 Conventional Commits。
- 凭据留在 ignored 本地配置；SQLite 当前未加密，不能按加密存储假定安全。未经用户要求不改 `.rules`，也不要求三份文档全文同步。
- 保护已有工作树，只修改和暂存本任务路径。

## 验证与按需参考

- 以当前 `package.json`、Cargo 配置和测试输出确定命令与范围；常用检查为 `pnpm check`、`pnpm test:run` 和适用平台的 Rust 编译检查。跳过、失败与未覆盖平台须单列。
- 客户端运行结论须有对应版本的真实 Tauri 实例证据；自检与独立验证分别记录，不能互相冒充。
- 构建/平台适配、Pinia/主题、UI testid 或 Vitest 故障：读 [技术参考](docs/agent-reference.md) 相应章节。
- Windows 客户端自动化：读伞仓 `.codex/skills/aichat-test-skill/SKILL.md`；先核实本次实例归属与版本，同机只能一个驱动者。
- 命令行构建或启动失败时核实当前依赖检查脚本；浏览器打开 Vite 页面不能代替 Tauri 真机验证，Linux cargo check 不覆盖 Windows 专属代码。
