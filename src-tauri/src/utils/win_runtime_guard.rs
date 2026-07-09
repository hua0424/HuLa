use windows::{
    Win32::System::{
        Diagnostics::Debug::{CheckRemoteDebuggerPresent, IsDebuggerPresent},
        Threading::GetCurrentProcess,
    },
    core::BOOL,
};

/// Windows 运行时防护：清理敏感环境变量 + 调试器检测
pub fn apply_runtime_guards() {
    sanitize_sensitive_env();
    enforce_debugger_policy();
}

fn sanitize_sensitive_env() {
    const BLOCKED_VARS: [&str; 4] = [
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
        "WEBVIEW2_USER_DATA_FOLDER",
        "WEBVIEW2_WAIT_FOR_SCRIPT_DEBUGGER",
    ];

    for key in BLOCKED_VARS {
        // WebView2 环境变量是注入向量。release 构建全部剥离；debug 构建放行
        // CDP 调试所需的三个变量，供开发/自动化测试使用（其中 BROWSER_EXECUTABLE_FOLDER
        // 用于锁定到固定版本 WebView2 Runtime，规避 Evergreen 更新导致 CDP 失效）。
        #[cfg(debug_assertions)]
        if matches!(
            key,
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"
                | "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER"
                | "WEBVIEW2_USER_DATA_FOLDER"
        ) {
            continue;
        }
        unsafe { std::env::remove_var(key) };
    }
}

fn enforce_debugger_policy() {
    if debugger_attached() {
        eprintln!("[HuLa] 检测到调试器或远程调试会话，出于安全考虑终止启动。");

        #[cfg(not(debug_assertions))]
        {
            std::process::exit(0);
        }
    }
}

fn debugger_attached() -> bool {
    unsafe {
        if IsDebuggerPresent().as_bool() {
            return true;
        }

        let mut remote = BOOL(0);
        if CheckRemoteDebuggerPresent(GetCurrentProcess(), &mut remote).is_ok() {
            return remote.as_bool();
        }

        false
    }
}
