use crate::AppData;
use crate::repository::local_cache_repository::{
    self as cache, ThinkingCacheWindow, ThinkingMetadata,
};
use crate::session::SessionIdentity;
use tauri::State;

#[tauri::command]
pub async fn read_thinking_cache(
    binding: SessionIdentity,
    room_id: String,
    trigger_msg_ids: Vec<String>,
    state: State<'_, AppData>,
) -> Result<ThinkingCacheWindow, String> {
    let session = state.session.capture_identity(&binding)?;
    let _gate = state.session.commit(&session).await?;
    cache::read_thinking_window(&session.db, &binding.uid, &room_id, &trigger_msg_ids).await
}

#[tauri::command]
pub async fn cache_thinking_metadata(
    binding: SessionIdentity,
    room_id: String,
    trigger_msg_ids: Vec<String>,
    items: Vec<ThinkingMetadata>,
    window: tauri::Window,
    state: State<'_, AppData>,
) -> Result<Vec<String>, String> {
    require_chat_owner(&window)?;
    let session = state.session.capture_identity(&binding)?;
    let _gate = state.session.commit(&session).await?;
    cache::save_thinking_metadata(
        &session.db,
        &binding.uid,
        &room_id,
        &trigger_msg_ids,
        &items,
    )
    .await
}

#[tauri::command]
pub async fn cache_thinking_body(
    binding: SessionIdentity,
    room_id: String,
    trigger_msg_id: String,
    aiclaw_uid: String,
    thinking_id: String,
    content: String,
    body_etag: Option<String>,
    window: tauri::Window,
    state: State<'_, AppData>,
) -> Result<(), String> {
    require_chat_owner(&window)?;
    let session = state.session.capture_identity(&binding)?;
    let _gate = state.session.commit(&session).await?;
    cache::save_thinking_body(
        &session.db,
        &binding.uid,
        &room_id,
        &trigger_msg_id,
        &aiclaw_uid,
        &thinking_id,
        &content,
        body_etag.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn read_local_snapshot(
    binding: SessionIdentity,
    name: String,
    state: State<'_, AppData>,
) -> Result<Option<serde_json::Value>, String> {
    let session = state.session.capture_identity(&binding)?;
    let _gate = state.session.commit(&session).await?;
    cache::read_snapshot(&session.db, &name).await
}

#[tauri::command]
pub async fn cache_local_snapshot(
    binding: SessionIdentity,
    name: String,
    payload: serde_json::Value,
    window: tauri::Window,
    state: State<'_, AppData>,
) -> Result<(), String> {
    require_chat_owner(&window)?;
    let session = state.session.capture_identity(&binding)?;
    let _gate = state.session.commit(&session).await?;
    cache::save_snapshot(&session.db, &name, &payload).await
}

/// aichatoverview#393：逻辑聊天主窗拥有账号缓存写权——桌面 `home`，移动 `mobile-home`。
/// 桌面其他窗口（辅窗）仍只读；不得把移动窗重命名 home，也不得放开任意原生窗口写入。
fn require_chat_owner(window: &tauri::Window) -> Result<(), String> {
    match window.label() {
        "home" | "mobile-home" => Ok(()),
        _ => Err("只有聊天主窗可持久化账号缓存".into()),
    }
}
