use crate::AppData;
use crate::repository::im_user_repository;
use crate::session::SessionIdentity;
use chrono::Local;
use entity::im_user;
use entity::prelude::ImUserEntity;
use sea_orm::ActiveValue::Set;
use sea_orm::ColumnTrait;
use sea_orm::EntityTrait;
use sea_orm::IntoActiveModel;
use sea_orm::QueryFilter;
use serde::{Deserialize, Serialize};
use tauri::State;
use tracing::{debug, info};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveUserInfoRequest {
    uid: String,
    /// aichatoverview#47: 当前登录用户类型，入库供 send_msg 等场景使用。
    user_type: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTokenRequest {
    token: String,
    refresh_token: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TokenResponse {
    token: Option<String>,
    refresh_token: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserTokenRequest {
    uid: String,
    token: String,
    refresh_token: String,
}

#[tauri::command]
pub async fn save_user_info(
    user_info: SaveUserInfoRequest,
    state: State<'_, AppData>,
    binding: SessionIdentity,
) -> Result<(), String> {
    let binding = state.session.capture_identity(&binding)?;
    if user_info.uid != binding.identity.uid {
        return Err("用户信息UID与认证归属不匹配".into());
    }
    let _gate = state.session.commit(&binding).await?;
    let db = &binding.db;

    // 检查用户是否存在
    let exists = ImUserEntity::find()
        .filter(im_user::Column::Id.eq(&user_info.uid))
        .one(&*db)
        .await
        .map_err(|err| format!("Failed to query user: {}", err))?;

    if exists.is_none() {
        info!("User does not exist, preparing to insert new user");

        let user = im_user::ActiveModel {
            id: Set(user_info.uid.clone()),
            // TODO 这里先设置为 true，后续需要根据配置调整
            is_init: Set(true),
            // aichatoverview#47: 保存当前用户类型，供发送消息时填充 userType。
            user_type: Set(user_info.user_type),
            ..Default::default()
        };

        im_user::Entity::insert(user)
            .exec(&*db)
            .await
            .map_err(|err| format!("Failed to insert user: {}", err))?;
    } else {
        // aichatoverview#47: 用户已存在也要更新 user_type，确保换号/升级后字段不滞后。
        debug!("User already exists, updating user_type");
        if let Some(user) = exists {
            let mut active_model = user.into_active_model();
            active_model.user_type = Set(user_info.user_type);
            ImUserEntity::update(active_model)
                .exec(&*db)
                .await
                .map_err(|err| format!("Failed to update user_type: {}", err))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn update_user_last_opt_time(
    state: State<'_, AppData>,
    binding: SessionIdentity,
) -> Result<(), String> {
    let binding = state.session.capture_identity(&binding)?;
    let _gate = state.session.commit(&binding).await?;
    let db = &binding.db;
    let uid = binding.identity.uid.clone();

    // 检查用户是否存在
    let user = ImUserEntity::find()
        .filter(im_user::Column::Id.eq(uid.clone()))
        .one(&*db)
        .await
        .map_err(|err| format!("Failed to query user: {}", err))?;

    if let Some(user) = user {
        let mut active_model = user.into_active_model();
        active_model.last_opt_time = Set(Some(Local::now().timestamp_millis()));

        ImUserEntity::update(active_model)
            .exec(&*db)
            .await
            .map_err(|err| format!("Failed to update user last operation time: {}", err))?;
    }

    Ok(())
}

/// 获取用户的 token 和 refreshToken
#[tauri::command]
pub async fn get_user_tokens(
    state: State<'_, AppData>,
    binding: SessionIdentity,
) -> Result<TokenResponse, String> {
    let binding = state.session.capture_identity(&binding)?;
    let _gate = state.session.commit(&binding).await?;
    let tokens = im_user_repository::get_user_tokens(&binding.db, &binding.identity.uid)
        .await
        .map_err(|e| e.to_string())?;
    Ok(match tokens {
        Some((token, refresh_token)) => TokenResponse {
            token: Some(token),
            refresh_token: Some(refresh_token),
        },
        None => TokenResponse {
            token: None,
            refresh_token: None,
        },
    })
}

#[tauri::command]
pub async fn remove_tokens(
    state: State<'_, AppData>,
    binding: SessionIdentity,
) -> Result<(), String> {
    let epoch = state.session.invalidate_identity(&binding).await?;
    let mut rc = state.rc.lock().await;
    if !state.session.is_epoch(epoch) {
        return Err("退出任务已被新登录取代".into());
    }
    info!("Removing user token info");
    {
        let mut user = state.user_info.lock().await;
        user.uid.clear();
        user.token.clear();
        user.refresh_token.clear();
    }
    rc.token = None;
    rc.refresh_token = None;

    info!("Successfully removed user token info");
    Ok(())
}

#[tauri::command]
pub async fn update_token(
    req: UpdateUserTokenRequest,
    state: State<'_, AppData>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    use crate::command::database_command::bind_user_database;
    let epoch = state.session.invalidate().await;
    // OAuth without UID must resolve the identity of this token, never reuse the previous account.
    let uid = {
        let mut rc = state.rc.lock().await;
        if !state.session.is_epoch(epoch) {
            return Err("认证任务已被取代".into());
        }
        rc.token = Some(req.token.clone());
        rc.refresh_token = if req.refresh_token.is_empty() {
            None
        } else {
            Some(req.refresh_token.clone())
        };
        crate::command::request_command::authenticated_uid(
            &mut rc,
            if req.uid.is_empty() {
                None
            } else {
                Some(&req.uid)
            },
        )
        .await?
    };
    let binding = bind_user_database(&state, &app_handle, &uid, epoch).await?;
    let _gate = state.session.commit(&binding).await?;
    im_user_repository::save_user_tokens(&binding.db, &uid, &req.token, &req.refresh_token)
        .await
        .map_err(|e| e.to_string())?;
    let mut user_info = state.user_info.lock().await;
    user_info.uid = uid;
    user_info.token = req.token;
    user_info.refresh_token = req.refresh_token;
    Ok(())
}
