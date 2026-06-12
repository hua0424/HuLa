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
        // WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 是注入向量（可向 WebView2 注入任意启动参数），
        // sanitize 默认无条件剥离它。仅 debug 构建放行这一个变量，供 TEST-A 注入
        // --remote-debugging-port 开启 CDP，让自动化测试 attach；release 构建 cfg 关闭、
        // 不放行，该变量与其余三个一并被剥离（注入向量在发布产物中始终清除，语义不变）。
        #[cfg(debug_assertions)]
        if key == "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS" {
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
