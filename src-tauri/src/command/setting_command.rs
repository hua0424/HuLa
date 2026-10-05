use serde::{Deserialize, Serialize};
use tauri::State;
use tracing::info;

use crate::{AppData, configuration::Settings};

#[tauri::command]
pub async fn get_settings(state: State<'_, AppData>) -> Result<Settings, String> {
    Ok(state.config.lock().await.clone())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsParams {
    base_url: String,
    ws_url: String,
}

#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppData>,
    settings: UpdateSettingsParams,
) -> Result<(), String> {
    let new_key = crate::session::normalize_backend_key(&settings.base_url)?;
    let old_key =
        crate::session::normalize_backend_key(&state.config.lock().await.backend.base_url)?;
    let epoch = if new_key != old_key {
        Some(state.session.invalidate().await)
    } else {
        None
    };
    let mut client = state.rc.lock().await;
    if epoch.is_some_and(|epoch| !state.session.is_epoch(epoch)) {
        return Err("后端切换已被新的身份意图取代".into());
    }
    {
        let mut config = state.config.lock().await;
        config.backend.base_url = settings.base_url.clone();
        config.backend.ws_url = settings.ws_url;
    }
    if new_key != old_key {
        client.token = None;
        client.refresh_token = None;
        let mut user = state.user_info.lock().await;
        user.uid.clear();
        user.token.clear();
        user.refresh_token.clear();
    }
    client.set_base_url(settings.base_url);
    info!("Backend settings updated; key={new_key}");
    Ok(())
}
