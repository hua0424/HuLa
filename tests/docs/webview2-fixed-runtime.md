# WebView2 固定运行时（测试环境）

## 问题背景

WebView2 Evergreen Runtime 自 **150.0.4078.48** 起，不再读取 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境变量，也不再读取注册表 `AdditionalBrowserArguments`。这导致 HuLa 桌面端自动化测试依赖的 CDP（`--remote-debugging-port=9222`）无法开启，playwright-cli 无法 attach。

当前解决方案：**锁定到已知可用的 Fixed Version Runtime 149.0.4022.80**。

## 快速使用

在 `frontend/` 目录的 PowerShell 中执行：

```powershell
# 准备固定运行时并设置环境变量
. .\scripts\setup-webview2-runtime.ps1

# 然后按原有方式启动客户端或运行 launch_app.ps1
. .\tests\scripts\launch_app.ps1
```

脚本会：
1. 下载 `Microsoft.WebView2.FixedVersionRuntime.x64.cab`（约 280MB，仅首次）。
2. **校验 SHA256**（哈希锁定 `2C9CB91FCC8B46295BE9E2D8959518A0D4A56D9B2B75DE1A046309462599616A`，与官方 149.0.4022.80 x64 二进制一致），校验失败会删除文件并报错。
3. 解压到 `%LOCALAPPDATA%\HuLa\WebView2FixedRuntime\149.0.4022.80`。
4. 在当前 PowerShell 进程中设置：
   - `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` → 固定运行时目录
   - `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` → `--remote-debugging-port=9222`
   - `WEBVIEW2_USER_DATA_FOLDER` → **每个测试进程独立的临时目录**（GUID 命名，避免与日常 `%APPDATA%\com.hula.pc` 抢锁/污染）

## 验证

启动客户端后：

```powershell
netstat -an | findstr :9222
# 应看到 127.0.0.1:9222 LISTENING

Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
  Select-Object ProcessId, @{N='Path';E={$_.ExecutablePath}}
# 路径应包含 Microsoft.WebView2.FixedVersionRuntime.149...
```

## 与日常 HuLa 的关系

脚本设置的 `WEBVIEW2_USER_DATA_FOLDER` 是每个测试进程独立的临时目录，不会污染日常 `%APPDATA%\com.hula.pc` 数据。固定运行时仅在当前 PowerShell 进程中生效，不影响系统 Evergreen WebView2。

下载的 CAB 来自 Microsoft 官方 WebView2 Fixed Version Runtime 二进制（社区镜像托管），脚本通过固定 SHA256 哈希校验，确保解压执行的是预期版本。如需换源，可传 `-DownloadUrl` 与 `-ExpectedSha256`。

## 代码侧配合

`src-tauri/src/utils/win_runtime_guard.rs` 在 debug 构建中放行以下三个 WebView2 环境变量：

- `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`
- `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`
- `WEBVIEW2_USER_DATA_FOLDER`

release 构建仍会剥离它们，保证发布产物安全。

## 回滚

删除固定运行时目录即可恢复系统 Evergreen：

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\HuLa\WebView2FixedRuntime"
```

## 长期方向

Tauri v2 的 `WebviewWindow` JavaScript API 不暴露 `additionalBrowserArgs`（参见 tauri-apps/tauri#13092）。若要彻底摆脱对固定运行时/环境变量的依赖，需将窗口创建迁移到 Rust 侧并显式调用 `WebviewWindowBuilder::additional_browser_args`。该改动面较大，不在本单处理。
