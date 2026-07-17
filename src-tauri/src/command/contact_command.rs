use crate::AppData;
use crate::command::token_helper::{capture_token_snapshot_arc, persist_token_if_refreshed_arc};
use crate::error::CommonError;
use crate::im_request_client::{ImRequestClient, ImUrl};
use crate::repository::im_contact_repository::{
    list_contact, save_contact_batch, update_contact_hide,
};

use entity::im_contact;
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{Mutex, RwLock};
use tracing::{error, info};

#[tauri::command]
pub async fn list_contacts_command(
    app_handle: AppHandle,
    state: State<'_, AppData>,
) -> Result<Vec<im_contact::Model>, String> {
    info!("Querying all conversation list:");
    let result: Result<Vec<im_contact::Model>, CommonError> = async {
        // 获取当前登录用户的 uid
        let login_uid = {
            let user_info = state.user_info.lock().await;
            user_info.uid.clone()
        };

        // 先尝试从本地 SQLite 读取（即时返回）
        let local_data = list_contact(&*state.db_conn.read().await, &login_uid).await;

        if let Ok(local_contacts) = &local_data {
            if !local_contacts.is_empty() {
                info!(
                    "Returning {} contacts from local SQLite",
                    local_contacts.len()
                );
                // 后台异步更新网络数据
                let db_conn = state.db_conn.clone();
                let rc = state.rc.clone();
                let uid = login_uid.clone();
                let app_handle = app_handle.clone();
                tokio::spawn(async move {
                    if let Err(e) = fetch_and_update_contacts(app_handle, db_conn, rc, uid).await {
                        error!("Background contact sync failed: {:?}", e);
                    }
                });
                return Ok(local_contacts.clone());
            }
        }

        // 本地无数据，从网络获取
        info!("No local contacts, fetching from network");
        let data = fetch_and_update_contacts(
            app_handle,
            state.db_conn.clone(),
            state.rc.clone(),
            login_uid.clone(),
        )
        .await?;
        return Ok(data);
    }
    .await;

    match result {
        Ok(contacts) => Ok(contacts),
        Err(e) => {
            error!("Failed to get contact list: {:?}", e);
            Err(e.to_string())
        }
    }
}

/// 获取并更新联系人数据
async fn fetch_and_update_contacts(
    app_handle: AppHandle,
    db_conn: Arc<RwLock<DatabaseConnection>>,
    request_client: Arc<Mutex<ImRequestClient>>,
    login_uid: String,
) -> Result<Vec<im_contact::Model>, CommonError> {
    // 进入时先读取本地列表，用于后续 diff；列表无变化时不 emit，避免自激环（P1-2）
    let local_contacts = list_contact(&*db_conn.read().await, &login_uid)
        .await
        .unwrap_or_default();
    let local_rooms: HashSet<String> = local_contacts.into_iter().map(|c| c.room_id).collect();

    let old_tokens = capture_token_snapshot_arc(&request_client).await;

    let resp: Option<Vec<im_contact::Model>> = request_client
        .lock()
        .await
        .im_request(
            ImUrl::GetContactList,
            None::<serde_json::Value>,
            None::<serde_json::Value>,
        )
        .await?;

    persist_token_if_refreshed_arc(&old_tokens, &request_client, &db_conn, &login_uid).await;

    if let Some(data) = resp {
        let remote_rooms: HashSet<String> = data.iter().map(|c| c.room_id.clone()).collect();
        let changed = remote_rooms != local_rooms;

        if changed {
            // 保存到本地数据库
            save_contact_batch(&*db_conn.read().await, data.clone(), &login_uid)
                .await
                .map_err(|e| {
                    anyhow::anyhow!(
                        "[{}:{}] Failed to save contact data to local database: {}",
                        file!(),
                        line!(),
                        e
                    )
                })?;

            // 同步完成后通知前端刷新会话列表（离线错过群解散推送的兜底刷新）
            if let Err(e) = app_handle.emit("contacts-synced", ()) {
                error!("Failed to emit contacts-synced event: {}", e);
            }
        }

        Ok(data)
    } else {
        Err(CommonError::UnexpectedError(anyhow::anyhow!(
            "Failed to get contact data"
        )))
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HideContactRequest {
    room_id: String,
    hide: bool,
}

#[tauri::command]
pub async fn hide_contact_command(
    state: State<'_, AppData>,
    data: HideContactRequest,
) -> Result<(), String> {
    info!("Hide contact: room_id={}, hide={}", data.room_id, data.hide);
    let result: Result<(), CommonError> = async {
        // 获取当前登录用户的 uid
        let login_uid = {
            let user_info = state.user_info.lock().await;
            user_info.uid.clone()
        };

        let old_tokens = capture_token_snapshot_arc(&state.rc).await;

        let resp: Option<bool> = state
            .rc
            .lock()
            .await
            .im_request(
                ImUrl::SetHide,
                Some(data.clone()),
                None::<serde_json::Value>,
            )
            .await?;

        persist_token_if_refreshed_arc(&old_tokens, &state.rc, &state.db_conn, &login_uid).await;

        if let Some(_) = resp {
            // 更新本地数据库
            update_contact_hide(
                &*state.db_conn.read().await,
                &data.room_id.clone(),
                data.hide,
                &login_uid,
            )
            .await?;
            Ok(())
        } else {
            Err(CommonError::UnexpectedError(anyhow::anyhow!(
                "Failed to hide contact"
            )))
        }
    }
    .await;

    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            error!("Failed to hide contact: {:?}", e);
            Err(e.to_string())
        }
    }
}
