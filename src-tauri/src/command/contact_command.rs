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

/// 比较本地与远程联系人列表是否相等。
/// 远程数据不含 `login_uid`（serde skip），比较前将其归一化为本地 uid，避免恒不相等。
fn contacts_equal(
    local: &[im_contact::Model],
    remote: &[im_contact::Model],
    login_uid: &str,
) -> bool {
    let mut local_sorted = local.to_vec();
    local_sorted.sort_by(|a, b| a.room_id.cmp(&b.room_id));

    let mut remote_sorted: Vec<im_contact::Model> = remote
        .iter()
        .map(|c| {
            let mut clone = c.clone();
            clone.login_uid = login_uid.to_string();
            clone
        })
        .collect();
    remote_sorted.sort_by(|a, b| a.room_id.cmp(&b.room_id));

    local_sorted == remote_sorted
}

/// 获取并更新联系人数据
async fn fetch_and_update_contacts(
    app_handle: AppHandle,
    db_conn: Arc<RwLock<DatabaseConnection>>,
    request_client: Arc<Mutex<ImRequestClient>>,
    login_uid: String,
) -> Result<Vec<im_contact::Model>, CommonError> {
    // 进入时先读取本地列表，用于后续 diff；全字段无变化时不 emit，避免自激环（P1-2）
    let local_contacts = list_contact(&*db_conn.read().await, &login_uid)
        .await
        .unwrap_or_default();

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
        // 无条件落库，保持原语义：字段变化（群名/头像/最后消息等）需要持久化
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

        // 全字段 diff 有变化时才 emit，避免 getSessionList -> list_contacts -> emit 的自持环
        let changed = !contacts_equal(&local_contacts, &data, &login_uid);
        if changed {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_contact(
        id: &str,
        room_id: &str,
        login_uid: &str,
        name: Option<&str>,
    ) -> im_contact::Model {
        im_contact::Model {
            id: id.to_string(),
            detail_id: format!("detail-{id}"),
            room_id: room_id.to_string(),
            contact_type: Some(1),
            hot_flag: Some(0),
            top: Some(false),
            account: None,
            operate: Some(0),
            remark: None,
            my_name: None,
            mute_notification: Some(0),
            hide: Some(false),
            active_time: Some(1),
            shield: Some(false),
            avatar: None,
            contact_name: name.map(|s| s.to_string()),
            text: None,
            unread_count: Some(0),
            create_time: Some(1),
            update_time: Some(1),
            login_uid: login_uid.to_string(),
        }
    }

    #[test]
    fn same_contacts_equal_after_login_uid_normalization() {
        let local = vec![
            make_contact("1", "room-a", "uid-1", Some("A")),
            make_contact("2", "room-b", "uid-1", Some("B")),
        ];
        let mut remote = local.clone();
        for c in &mut remote {
            c.login_uid = String::new();
        }
        assert!(contacts_equal(&local, &remote, "uid-1"));
    }

    #[test]
    fn same_contacts_equal_despite_different_order() {
        let local = vec![
            make_contact("1", "room-a", "uid-1", Some("A")),
            make_contact("2", "room-b", "uid-1", Some("B")),
        ];
        let remote = vec![
            make_contact("2", "room-b", "", Some("B")),
            make_contact("1", "room-a", "", Some("A")),
        ];
        assert!(contacts_equal(&local, &remote, "uid-1"));
    }

    #[test]
    fn different_contacts_not_equal() {
        let local = vec![make_contact("1", "room-a", "uid-1", Some("A"))];
        let remote = vec![make_contact("1", "room-a", "", Some("B"))];
        assert!(!contacts_equal(&local, &remote, "uid-1"));
    }

    #[test]
    fn room_id_diff_not_equal() {
        let local = vec![make_contact("1", "room-a", "uid-1", Some("A"))];
        let remote = vec![make_contact("1", "room-b", "", Some("A"))];
        assert!(!contacts_equal(&local, &remote, "uid-1"));
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
