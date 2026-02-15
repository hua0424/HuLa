# OpenClaw Client 任务计划

> 基于 HuLa Client 改造 · 分支 `client_direct`

---

## Phase 1：基础框架（✅ 已完成）

代码清理、重构 Store、路由改造

---

## Phase 2：核心聊天（✅ 已完成）

### 协议层
- `services/openclaw/types.ts` - 协议类型
- `services/openclaw/connection.ts` - 连接管理
- `services/openclaw/request.ts` - 请求响应
- `services/openclaw/events.ts` - 事件分发
- `services/openclaw/agent.ts` - Agent 流式

### 消息渲染
- `MessageBubble.vue` - 消息气泡
- `MarkdownRenderer.vue` - Markdown 渲染
- `CommandPalette.vue` - 斜杠命令

### 工具
- `ToolPanel.vue` - 工具面板
- `ExecApproval.vue` - Exec 审批

---

## Phase 3：体验完善（✅ 已完成）

- 模型选择面板 ✅
- 斜杠命令 ✅
- /stop /reset /clear ✅
- 状态栏 ✅
- 深色主题 ✅

---

## Phase 4：测试与发布（⏳ 待开始）

- 端到端测试
- 跨平台构建
- README
