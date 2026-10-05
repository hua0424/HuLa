use crate::command::database_command::{bind_user_database, prepare_scoped_database};
use crate::session::{SessionBinding, SessionIdentity, normalize_backend_key};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{
    AppData,
    command::message_command::check_user_init_and_fetch_messages,
    command::token_helper::capture_token_snapshot_direct,
    im_request_client::{ImRequest, ImUrl},
    repository::im_user_repository,
    vo::vo::{LoginReq, LoginResp},
};

#[tauri::command]
pub async fn login_command(
    data: LoginReq,
    state: State<'_, AppData>,
    app_handle: AppHandle,
) -> Result<Option<LoginResp>, String> {
    let epoch = state.session.invalidate().await;
    if data.is_auto_login {
        // 自动登录逻辑
        if let Some(uid) = &data.uid {
            // Read only the new backend+UID scope before authenticating; never claim a legacy UID file.
            let configuration = state.config.lock().await.clone();
            let backend_key = normalize_backend_key(&configuration.backend.base_url)?;
            let db = configuration
                .database
                .scoped_connection_string(&app_handle, &backend_key, uid)
                .await
                .map_err(|e| e.to_string())?;
            let gate = state.session.prepare(epoch).await?;
            prepare_scoped_database(&db, &backend_key, uid).await?;
            drop(gate);
            let db_result = im_user_repository::get_user_tokens(&db, uid).await;
            match db_result {
                Ok(Some((token, refresh_token))) => {
                    if refresh_token.is_empty() {
                        let check_result: Result<Option<serde_json::Value>, anyhow::Error> = {
                            let mut rc = state.rc.lock().await;
                            if !state.session.is_epoch(epoch) {
                                return Err("认证任务代次已失效".into());
                            }
                            rc.token = Some(token.clone());
                            rc.refresh_token = None;
                            rc.im_request(
                                ImUrl::CheckToken,
                                None::<serde_json::Value>,
                                None::<serde_json::Value>,
                            )
                            .await
                        };

                        if check_result.is_ok() {
                            let mut rc = state.rc.lock().await;
                            if !state.session.is_epoch(epoch) {
                                return Err("认证任务代次已失效".into());
                            }
                            authenticated_uid(&mut rc, Some(uid)).await?;
                            drop(rc);
                            let login_resp = LoginResp {
                                token,
                                client: "".to_string(),
                                refresh_token: refresh_token.clone(),
                                expire: "".to_string(),
                                uid: uid.clone(),
                            };
                            let binding =
                                bind_user_database(&state, &app_handle, uid, epoch).await?;
                            handle_login_success(&login_resp, &state, &binding, data.async_data)
                                .await?;
                            return Ok(Some(login_resp));
                        }
                    }

                    // 使用 start_refresh_token 刷新登录（不会添加 token 头，适合自动登录场景）
                    let refresh_result = {
                        let mut rc = state.rc.lock().await;
                        if !state.session.is_epoch(epoch) {
                            return Err("认证任务代次已失效".into());
                        }
                        // 设置 ImRequestClient 内部的 refresh_token
                        rc.refresh_token = Some(refresh_token.clone());
                        rc.start_refresh_token().await
                    };

                    match refresh_result {
                        Ok(()) => {
                            // 从 ImRequestClient 中获取刷新后的 token
                            let mut rc = state.rc.lock().await;
                            if !state.session.is_epoch(epoch) {
                                return Err("认证任务代次已失效".into());
                            }
                            authenticated_uid(&mut rc, Some(uid)).await?;
                            let new_token = rc.token.clone().unwrap_or_default();
                            let new_refresh_token = rc.refresh_token.clone().unwrap_or_default();
                            drop(rc);

                            // 转换为 LoginResp 格式返回
                            let login_resp = LoginResp {
                                token: new_token,
                                client: "".to_string(),
                                refresh_token: new_refresh_token,
                                expire: "".to_string(),
                                uid: uid.clone(),
                            };

                            let binding =
                                bind_user_database(&state, &app_handle, uid, epoch).await?;
                            handle_login_success(&login_resp, &state, &binding, data.async_data)
                                .await?;

                            return Ok(Some(login_resp));
                        }
                        Err(e) => {
                            let err_str = e.to_string();
                            if err_str.contains("network_error") {
                                return Err("网络连接失败，请检查网络后重试".to_string());
                            }
                        }
                    }
                }
                Ok(None) => {}
                Err(_) => {}
            };
            // 自动登录失败，返回错误让前端切换到手动登录
            return Err("自动登录失败，请手动登录".to_string());
        } else {
            return Err("自动登录缺少用户ID".to_string());
        }
    } else {
        // 手动登录逻辑
        let async_data = data.async_data;
        let res = {
            let mut rc = state.rc.lock().await;
            if !state.session.is_epoch(epoch) {
                return Err("认证任务代次已失效".into());
            }
            rc.login(data).await.map_err(|e| e.to_string())?
        }; // 锁在这里被释放

        // 登录成功后处理用户信息和token保存
        if let Some(login_resp) = &res {
            let binding = bind_user_database(&state, &app_handle, &login_resp.uid, epoch).await?;
            handle_login_success(login_resp, &state, &binding, async_data).await?;
        }

        Ok(res)
    }
}

pub async fn authenticated_uid(
    client: &mut crate::im_request_client::ImRequestClient,
    expected: Option<&str>,
) -> Result<String, String> {
    let detail: serde_json::Value = client
        .im_request(
            ImUrl::GetUserInfoDetail,
            None::<serde_json::Value>,
            None::<serde_json::Value>,
        )
        .await
        .map_err(|e| e.to_string())?
        .ok_or("认证用户响应为空")?;
    let uid = detail
        .get("uid")
        .or_else(|| detail.get("id"))
        .and_then(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .or_else(|| value.as_u64().map(|id| id.to_string()))
        })
        .ok_or("认证用户缺少UID")?;
    if expected.is_some_and(|expected| expected != uid) {
        return Err("认证用户UID不匹配".into());
    }
    Ok(uid)
}

async fn handle_login_success(
    login_resp: &LoginResp,
    state: &State<'_, AppData>,
    binding: &SessionBinding,
    async_data: bool,
) -> Result<(), String> {
    // 从登录响应中获取用户标识，这里使用 uid 作为 uid
    let uid = &login_resp.uid;

    let gate = state.session.commit(binding).await?;
    // 设置用户信息
    let mut user_info = state.user_info.lock().await;
    user_info.uid = login_resp.uid.clone();
    user_info.token = login_resp.token.clone();
    user_info.refresh_token = login_resp.refresh_token.clone();
    // 保存 token 信息到数据库
    im_user_repository::save_user_tokens(
        &binding.db,
        uid,
        &login_resp.token,
        &login_resp.refresh_token,
    )
    .await
    .map_err(|e| e.to_string())?;

    drop(user_info);
    drop(gate);
    let mut client = state.rc.lock().await;
    check_user_init_and_fetch_messages(
        &mut client,
        binding,
        &state.session,
        uid,
        async_data,
        false,
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
#[cfg_attr(mobile, allow(unused_variables))]
pub async fn im_request_command(
    state: State<'_, AppData>,
    url: String,
    body: Option<serde_json::Value>,
    params: Option<serde_json::Value>,
    app_handle: tauri::AppHandle,
    binding: Option<SessionIdentity>,
) -> Result<Option<serde_json::Value>, String> {
    let parsed = url.parse::<ImUrl>().map_err(|_| "无效HTTP路由")?;
    let public = matches!(
        parsed,
        ImUrl::Login
            | ImUrl::Register
            | ImUrl::ForgetPassword
            | ImUrl::SendCaptcha
            | ImUrl::GetCaptcha
            | ImUrl::CheckEmail
            | ImUrl::GenerateQRCode
            | ImUrl::CheckQRStatus
            | ImUrl::InitConfig
    );
    let binding = match binding {
        Some(identity) => Some(state.session.capture_identity(&identity)?),
        None if public => None,
        None => return Err("认证HTTP请求必须携带原账号绑定".into()),
    };
    let request_epoch = state.session.epoch();
    let user_uid = binding
        .as_ref()
        .map(|b| b.identity.uid.clone())
        .unwrap_or_default();
    let mut rc = state.rc.lock().await;
    if !state.session.is_epoch(request_epoch) {
        return Err("预认证请求代次已失效".into());
    }
    if binding
        .as_ref()
        .is_some_and(|b| !state.session.is_current(b))
    {
        return Err("HTTP请求账号代次已失效".into());
    }

    // 记录请求前的 token，用于检测是否被刷新
    let old_tokens = capture_token_snapshot_direct(&rc);

    if let Ok(parsed_url) = url.parse::<ImUrl>() {
        let (method, base_path) = parsed_url.get_url();

        // 支持路径变量替换（如 {uid}、{friendUid}）
        let mut resolved_path = base_path.to_string();
        let mut clean_params = params.clone();
        if let Some(serde_json::Value::Object(ref mut map)) = clean_params {
            let mut keys_to_remove = Vec::new();
            for (key, value) in map.iter() {
                let placeholder = format!("{{{}}}", key);
                if resolved_path.contains(&placeholder) {
                    let replacement = value
                        .as_str()
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| value.to_string().trim_matches('"').to_string());
                    resolved_path = resolved_path.replace(&placeholder, &replacement);
                    keys_to_remove.push(key.clone());
                }
            }
            for key in keys_to_remove {
                map.remove(&key);
            }
        }

        let result: Result<Option<serde_json::Value>, anyhow::Error> = if resolved_path != base_path
        {
            // 路径有变量替换，直接使用 request 方法
            match rc
                .request::<serde_json::Value, _, _>(method, &resolved_path, body, clean_params)
                .await
            {
                Ok(api_result) => Ok(api_result.data),
                Err(e) => Err(e),
            }
        } else {
            rc.im_request(parsed_url, body, params).await
        };

        if !state.session.is_epoch(request_epoch) {
            return Err("预认证响应代次已失效".into());
        }
        let _response_gate = match &binding {
            Some(binding) => Some(state.session.commit(binding).await?),
            None => None,
        };
        // 无论请求成功还是失败，都检查 token 是否被刷新，如果是则保存到数据库
        // 这确保了即使请求重试后失败，刷新后的 token 也能被持久化
        if let (Some(new_token), Some(new_refresh_token)) =
            (rc.token.clone(), rc.refresh_token.clone())
        {
            if old_tokens.token != rc.token || old_tokens.refresh_token != rc.refresh_token {
                if let Some(binding) = &binding {
                    im_user_repository::save_user_tokens(
                        &binding.db,
                        &user_uid,
                        &new_token,
                        &new_refresh_token,
                    )
                    .await
                    .ok();
                }
            }
        }

        match result {
            Ok(data) => {
                return Ok(data);
            }
            Err(e) => {
                if e.to_string().contains("请重新登录") {
                    if user_uid.is_empty() {
                    } else {
                        if app_handle.get_webview_window("home").is_some() {
                            if let Err(err) = app_handle.emit_to("home", "relogin", ()) {
                                let _ = err;
                            }
                        } else if app_handle.get_webview_window("mobile-home").is_some() {
                            if let Err(err) = app_handle.emit_to("mobile-home", "relogin", ()) {
                                let _ = err;
                            }
                        } else {
                            if let Err(err) = app_handle.emit("relogin", ()) {
                                let _ = err;
                            }
                        }
                    }
                }
                return Err(e.to_string());
            }
        }
    } else {
        return Err(format!("Invalid URL: {}", url));
    }
}
