// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use dotenv::dotenv;

#[cfg(target_os = "linux")]
use hula_app_lib::utils::linux_runtime_guard as runtime_guard;
#[cfg(target_os = "macos")]
use hula_app_lib::utils::macos_runtime_guard as runtime_guard;
#[cfg(target_os = "windows")]
use hula_app_lib::utils::win_runtime_guard as runtime_guard;

fn main() -> std::io::Result<()> {
    dotenv().ok();
    // 仅 debug 构建开启 WebView2 远程调试端口（CDP），供 playwright-cli attach；release 绝不携带
    #[cfg(debug_assertions)]
    {
        if std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_err() {
            // edition 2024 下 set_var 为 unsafe；此处在 WebView 创建前的单线程启动阶段调用，安全。
            unsafe {
                std::env::set_var(
                    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                    "--remote-debugging-port=9222",
                );
            }
        }
    }
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        runtime_guard::apply_runtime_guards();
    }
    hula_app_lib::run();
    Ok(())
}
