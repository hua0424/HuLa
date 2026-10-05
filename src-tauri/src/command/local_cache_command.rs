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
    require_home(&window)?;
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
    require_home(&window)?;
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
    require_home(&window)?;
    let session = state.session.capture_identity(&binding)?;
    let _gate = state.session.commit(&session).await?;
    cache::save_snapshot(&session.db, &name, &payload).await
}

fn require_home(window: &tauri::Window) -> Result<(), String> {
    if window.label() != "home" {
        return Err("只有聊天主窗可持久化账号缓存".into());
    }
    Ok(())
}
