use crate::AppData;
use crate::session::{SessionBinding, SessionIdentity, SessionStore};

use super::{client::WebSocketClient, types::*};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, State};
use tokio::sync::RwLock;
use tracing::{error, info};

// 全局 WebSocket 客户端实例
static GLOBAL_WS_CLIENT: OnceLock<Arc<RwLock<Option<WebSocketClient>>>> = OnceLock::new();

/// 获取全局 WebSocket 客户端容器
pub fn get_websocket_client_container() -> &'static Arc<RwLock<Option<WebSocketClient>>> {
    GLOBAL_WS_CLIENT.get_or_init(|| {
        info!("Creating global WebSocket client container");
        Arc::new(RwLock::new(None))
    })
}

// The closure is the synchronous owner decision used by the actual init command.
pub(super) async fn commit_ws_owner<T, R>(
    container: &RwLock<Option<T>>,
    sessions: &SessionStore,
    binding: &SessionBinding,
    commit: impl FnOnce(&mut Option<T>) -> Result<R, String>,
) -> Result<R, String> {
    // GLOBAL -> session gate. Existing gate holders never acquire GLOBAL.
    // Both guards cover only this synchronous decision, never stop/join or network IO.
    let mut owner = container.write().await;
    let _session = sessions.commit(binding).await?;
    commit(&mut owner)
}

/// WebSocket 初始化参数
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitWsParams {
    pub client_id: String,
}

/// WebSocket 消息发送参数
#[derive(Debug, Deserialize)]
pub struct SendMessageParams {
    pub data: serde_json::Value,
}

/// WebSocket 配置更新参数
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConfigParams {
    pub heartbeat_interval: Option<u64>,
    pub heartbeat_timeout: Option<u64>,
    pub max_reconnect_attempts: Option<u32>,
    pub reconnect_delay_ms: Option<u64>,
}

/// 成功响应结构
#[derive(Debug, Serialize)]
pub struct SuccessResponse {
    pub success: bool,
    pub message: Option<String>,
}

impl SuccessResponse {
    pub fn new() -> Self {
        Self {
            success: true,
            message: None,
        }
    }
}

/// 初始化 WebSocket 连接
#[tauri::command]
pub async fn ws_init_connection(
    app_handle: AppHandle,
    params: InitWsParams,
    state: State<'_, AppData>,
    binding: SessionIdentity,
) -> Result<SuccessResponse, String> {
    let binding = state.session.capture_identity(&binding)?;
    info!("Received WebSocket initialization request");

    let client_container = get_websocket_client_container();
    let rc = state.rc.lock().await;

    let config = WebSocketConfig {
        server_url: state.config.lock().await.backend.ws_url.clone(),
        client_id: params.client_id,
        token: rc.token.clone(),
        ..Default::default()
    };
    drop(rc);
    // Keep an old owner visible until all its resources have actually stopped.
    // No GLOBAL guard may cross control/join: receivers acquire it to send ACKs.
    let (existing, replace) =
        commit_ws_owner(client_container, &state.session, &binding, |owner| {
            if owner.is_none() {
                *owner = Some(WebSocketClient::new(
                    app_handle.clone(),
                    binding.clone(),
                    config.clone(),
                ));
            }
            let existing = owner.as_ref().unwrap().clone();
            let replace = existing.binding.identity != binding.identity || existing.is_retired();
            if replace {
                existing.retire();
            }
            Ok((existing, replace))
        })
        .await?;
    let client = if !replace {
        existing
    } else {
        existing.disconnect().await;
        commit_ws_owner(client_container, &state.session, &binding, |owner| {
            if !owner
                .as_ref()
                .is_some_and(|current| current.same_owner(&existing))
            {
                return Err("WS初始化已被另一控制请求取代".into());
            }
            let client = WebSocketClient::new(app_handle, binding.clone(), config.clone());
            *owner = Some(client.clone());
            Ok(client)
        })
        .await?
    };

    client
        .connect(config)
        .await
        .map_err(|error| error.to_string())?;
    info!("WebSocket connection scheduled");

    Ok(SuccessResponse::new())
}

/// 断开 WebSocket 连接
#[tauri::command]
pub async fn ws_disconnect(
    _app_handle: AppHandle,
    binding: SessionIdentity,
) -> Result<SuccessResponse, String> {
    info!("Received WebSocket disconnect request");

    let client_container = get_websocket_client_container();
    let client = {
        let guard = client_container.read().await;
        if guard
            .as_ref()
            .is_some_and(|client| client.binding.identity != binding)
        {
            return Err("拒绝旧账号任务断开新连接".into());
        }
        guard.clone()
    };
    if let Some(client) = client {
        client.disconnect().await;
        let mut guard = client_container.write().await;
        if guard
            .as_ref()
            .is_some_and(|current| current.same_owner(&client))
        {
            *guard = None;
        }
    }

    info!("WebSocket connection disconnected");
    Ok(SuccessResponse::new())
}

/// 发送 WebSocket 消息
#[tauri::command]
pub async fn ws_send_message(
    _app_handle: AppHandle,
    params: SendMessageParams,
    binding: SessionIdentity,
) -> Result<SuccessResponse, String> {
    let client_container = get_websocket_client_container();
    let client_guard = client_container.read().await;

    if let Some(client) = client_guard.as_ref() {
        if client.binding.identity != binding {
            return Err("WS发送账号代次失效".into());
        }
        match client.send_message(params.data).await {
            Ok(_) => Ok(SuccessResponse::new()),
            Err(e) => {
                error!(" Failed to send message: {}", e);
                Err(format!("发送失败: {}", e))
            }
        }
    } else {
        error!(" WebSocket not initialized");
        Err("WebSocket 未初始化".to_string())
    }
}

/// 获取连接状态
#[tauri::command]
pub async fn ws_get_state(_app_handle: AppHandle) -> Result<ConnectionState, String> {
    let client_container = get_websocket_client_container();
    let client_guard = client_container.read().await;

    if let Some(client) = client_guard.as_ref() {
        Ok(client.get_state().await)
    } else {
        Ok(ConnectionState::Disconnected)
    }
}

/// 获取连接健康状态
#[tauri::command]
pub async fn ws_get_health(_app_handle: AppHandle) -> Result<ConnectionHealth, String> {
    let client_container = get_websocket_client_container();
    let client_guard = client_container.read().await;

    if let Some(client) = client_guard.as_ref() {
        Ok(client.get_health_status().await)
    } else {
        Err("WebSocket 未初始化".to_string())
    }
}

/// 强制重连
#[tauri::command]
pub async fn ws_force_reconnect(
    _app_handle: AppHandle,
    binding: SessionIdentity,
) -> Result<SuccessResponse, String> {
    info!("Received force reconnect request");

    let client_container = get_websocket_client_container();
    let client = client_container.read().await.clone();

    if let Some(client) = client {
        if client.binding.identity != binding {
            return Err("WS重连账号代次失效".into());
        }
        match client.force_reconnect().await {
            Ok(_) => {
                info!("WebSocket reconnection scheduled");
                Ok(SuccessResponse::new())
            }
            Err(e) => {
                error!(" WebSocket reconnection failed: {}", e);
                Err(format!("重连失败: {}", e))
            }
        }
    } else {
        error!(" WebSocket not initialized, cannot reconnect");
        Err("WebSocket 未初始化".to_string())
    }
}

/// 更新 WebSocket 配置
#[tauri::command]
pub async fn ws_update_config(
    _app_handle: AppHandle,
    params: UpdateConfigParams,
) -> Result<SuccessResponse, String> {
    info!("Updating WebSocket configuration");

    let client_container = get_websocket_client_container();
    let client_guard = client_container.read().await;

    if let Some(client) = client_guard.as_ref() {
        // 获取当前配置（这里需要添加获取当前配置的方法）
        let mut config = WebSocketConfig::default();

        // 更新配置
        if let Some(interval) = params.heartbeat_interval {
            config.heartbeat_interval = interval;
        }
        if let Some(timeout) = params.heartbeat_timeout {
            config.heartbeat_timeout = timeout;
        }
        if let Some(attempts) = params.max_reconnect_attempts {
            config.max_reconnect_attempts = attempts;
        }
        if let Some(delay) = params.reconnect_delay_ms {
            config.reconnect_delay_ms = delay;
        }

        client.update_config(config).await;
        info!("WebSocket configuration updated successfully");
        Ok(SuccessResponse::new())
    } else {
        error!(" WebSocket not initialized, cannot update configuration");
        Err("WebSocket 未初始化".to_string())
    }
}

/// 检查连接状态
#[tauri::command]
pub async fn ws_is_connected(_app_handle: AppHandle) -> Result<bool, String> {
    let client_container = get_websocket_client_container();
    let client_guard = client_container.read().await;

    if let Some(client) = client_guard.as_ref() {
        Ok(client.is_connected())
    } else {
        Ok(false)
    }
}

/// 设置应用后台状态
#[tauri::command]
pub async fn ws_set_app_background_state(
    _app_handle: AppHandle,
    is_background: bool,
) -> Result<SuccessResponse, String> {
    info!(
        "收到应用状态变更请求: {}",
        if is_background { "后台" } else { "前台" }
    );

    let client_container = get_websocket_client_container();
    let client_guard = client_container.read().await;

    if let Some(client) = client_guard.as_ref() {
        client.set_app_background_state(is_background);
    }

    Ok(SuccessResponse::new())
}

/// 获取应用后台状态
#[tauri::command]
pub async fn ws_get_app_background_state(_app_handle: AppHandle) -> Result<bool, String> {
    let client_container = get_websocket_client_container();
    let client_guard = client_container.read().await;

    if let Some(client) = client_guard.as_ref() {
        Ok(client.is_app_in_background())
    } else {
        Ok(false)
    }
}
