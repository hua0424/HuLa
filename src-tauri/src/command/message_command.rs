use crate::AppData;
use crate::command::token_helper::{
    capture_token_snapshot_direct, persist_captured_tokens, request_bound,
};
use crate::error::CommonError;
use crate::im_request_client::{ImRequestClient, ImUrl};
use crate::pojo::common::{CursorPageParam, CursorPageResp};
use crate::repository::im_message_repository::MessageWithThumbnail;
use crate::repository::{im_message_repository, im_user_repository};
use crate::session::{SessionBinding, SessionIdentity, SessionStore};
use crate::vo::vo::ChatMessageReq;

use entity::im_user::Entity as ImUserEntity;
use entity::{im_message, im_user};
use once_cell::sync::Lazy;
use sea_orm::TransactionTrait;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::HashSet;
use std::future::Future;
use std::sync::Arc;
use tauri::{State, ipc::Channel};
use tokio::time::{Duration, sleep};
use tracing::{debug, error, info, warn};

const WRITE_RETRY_LIMIT: usize = 3; // 写操作最多重试 3 次
const WRITE_RETRY_DELAY_MS: u64 = 80; // 重试基础延迟 80ms

async fn run_with_write_lock<T, F, Fut>(
    sessions: Arc<SessionStore>,
    binding: SessionBinding,
    op_name: &str,    // 当前操作名用于日志
    mut operation: F, // 实际写入逻辑
) -> Result<T, String>
where
    F: FnMut() -> Fut,                            // 返回异步写入 Future 的闭包
    Fut: Future<Output = Result<T, CommonError>>, // 写入结果类型
{
    let mut attempt: usize = 0; // 当前已重试次数
    loop {
        let guard = sessions.commit(&binding).await?; // 每次重试也在提交门禁内核对代次
        let result = operation().await; // 执行实际写入
        drop(guard); // 释放写锁

        match result {
            Ok(val) => return Ok(val), // 成功直接返回
            Err(err) => {
                let err_msg = err.to_string(); // 记录错误信息
                let lowered = err_msg.to_lowercase(); // 统一大小写方便匹配
                let is_locked =
                    lowered.contains("database is locked") || lowered.contains("database is busy"); // 检测是否锁冲突

                if is_locked && attempt + 1 < WRITE_RETRY_LIMIT {
                    let delay = WRITE_RETRY_DELAY_MS * (attempt as u64 + 1); // 递增延迟
                    warn!(
                        target: "tauri_db",
                        "[{}] database locked (attempt {}), retrying in {}ms",
                        op_name,
                        attempt + 1,
                        delay
                    );
                    attempt += 1; // 记录本次重试
                    sleep(Duration::from_millis(delay)).await; // 延迟后再试
                    continue;
                }

                error!(target: "tauri_db", "[{}] database write failed: {}", op_name, err_msg);
                return Err(err_msg);
            }
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MessageResp {
    pub create_id: Option<String>,
    pub create_time: Option<i64>,
    pub update_id: Option<String>,
    pub update_time: Option<i64>,
    pub from_user: FromUser,
    pub message: Message,
    pub old_msg_id: Option<String>,
    pub time_block: Option<i64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FromUser {
    pub uid: String,
    pub nickname: Option<String>,
    /// 发送者用户类型（1系统 2机器人 3普通用户 4AI助理），来自服务端 fromUser.userType。
    /// aichatoverview#47: 透传入本地 SQLite，使重载后 :data-user-type 绑定仍有效。
    pub user_type: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: Option<String>,
    /// aichatoverview#42: 服务端回显的客户端临时消息 id，用于精确 reconcile 乐观气泡。
    pub client_msg_id: Option<String>,
    pub room_id: Option<String>,
    #[serde(rename = "type")]
    pub message_type: Option<u8>,
    pub body: Option<serde_json::Value>,
    pub message_marks: Option<HashMap<String, MessageMark>>,
    pub send_time: Option<i64>,
    /// aichatoverview#34: 消息发送状态（"pending"|"sending"|"success"|"failed"），从本地 DB
    /// im_message.send_status 映射。重载（page_msg/chat_history）必须携带它，否则前端重载会把
    /// #33 内存里短暂置的 FAILED 覆盖成无状态 → retry-button 消失（值须与前端 MessageStatusEnum 一致）。
    pub status: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UrlInfo {
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MergeMessage {
    pub content: Option<String>,
    pub created_time: Option<i64>,
    pub name: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReplyMsg {
    pub id: Option<String>,
    pub uid: Option<String>,
    pub username: Option<String>,
    #[serde(rename = "type")]
    pub msg_type: Option<u8>,
    pub body: Option<Box<serde_json::Value>>,
    pub can_callback: u8,
    pub gap_count: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MessageMark {
    pub count: u32,
    pub user_marked: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CursorPageMessageParam {
    room_id: String,
    /// aichatoverview#285: 'local'（缺省）只读 SQLite；'remote' 拉远端一页并回填。
    /// 不要从既有 `async` 推导：预热与 loadMore 都传过 `async=true`，无网络语义。
    #[serde(default)]
    source: Option<String>,
    #[serde(flatten)]
    cursor_page_param: CursorPageParam,
}

fn is_remote_source(source: &Option<String>) -> bool {
    matches!(source.as_deref(), Some("remote"))
}

#[tauri::command]
pub async fn page_msg(
    param: CursorPageMessageParam,
    state: State<'_, AppData>,

    binding: SessionIdentity,
) -> Result<CursorPageResp<Vec<MessageResp>>, String> {
    let binding = state.session.capture_identity(&binding)?;
    if is_remote_source(&param.source) {
        return page_msg_remote(param, state, binding).await;
    }
    page_msg_local(param, state, binding).await
}

async fn page_msg_local(
    param: CursorPageMessageParam,
    state: State<'_, AppData>,
    binding: SessionBinding,
) -> Result<CursorPageResp<Vec<MessageResp>>, String> {
    let _gate = state.session.commit(&binding).await?;
    let login_uid = binding.identity.uid.clone();

    // 从数据库查询消息
    let db_result = im_message_repository::cursor_page_messages(
        &binding.db,
        param.room_id,
        param.cursor_page_param,
        &login_uid,
    )
    .await
    .map_err(|e| e.to_string())?;

    // 转换数据库模型为响应模型
    let mut raw_list = db_result.list.unwrap_or_default();
    raw_list.sort_by(|a, b| {
        let a_time = a.message.send_time.unwrap_or(0);
        let b_time = b.message.send_time.unwrap_or(0);
        a_time.cmp(&b_time)
    });

    // 计算每条消息的 time_block
    let mut message_resps: Vec<MessageResp> = Vec::new();
    for (index, msg) in raw_list.into_iter().enumerate() {
        let mut resp = convert_message_to_resp(msg.clone(), None);

        // 第一条消息始终显示时间
        if index == 0 {
            resp.time_block = Some(1);
        } else if let Some(send_time) = msg.message.send_time {
            // 使用统一的 time_block 计算函数
            resp.time_block = im_message_repository::calculate_time_block(
                &binding.db,
                &msg.message.room_id,
                &msg.message.id,
                send_time,
                &login_uid,
            )
            .await
            .map_err(|e| e.to_string())?;
        }

        message_resps.push(resp);
    }

    Ok(CursorPageResp {
        cursor: db_result.cursor,
        is_last: db_result.is_last,
        list: Some(message_resps),
        total: db_result.total,
    })
}

/// aichatoverview#285: 服务端 total 为字符串（"total":"233"），数字/缺失/空亦须兼容。
fn de_total_str_or_u64<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    let v = serde_json::Value::deserialize(deserializer)?;
    match v {
        serde_json::Value::Number(n) => n
            .as_u64()
            .ok_or_else(|| serde::de::Error::custom(format!("total 非法数字: {n}"))),
        serde_json::Value::String(s) => s
            .parse::<u64>()
            .map_err(|_| serde::de::Error::custom(format!("total 非法字符串: {s:?}"))),
        serde_json::Value::Null => Ok(0),
        _ => Err(serde::de::Error::custom("total 类型非法")),
    }
}

/// aichatoverview#285: 远端历史分页 DTO。
///
/// 服务端最终空页返回 `cursor=null`，`CursorPageResp.cursor: String` 不能直接反序列化；
/// `list` 为空但 `isLast=false` 是合法过滤空页（黑名单/墓碑/整页重复），不得结束。
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct RemoteMsgPageDto {
    #[serde(default)]
    list: Option<Vec<MessageResp>>,
    #[serde(default)]
    records: Option<Vec<MessageResp>>,
    #[serde(default)]
    cursor: Option<String>,
    #[serde(default)]
    is_last: bool,
    #[serde(default, deserialize_with = "de_total_str_or_u64")]
    total: u64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct RemoteMsgPageParams {
    room_id: String,
    page_size: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    cursor: Option<String>,
    skip: bool,
}

/// aichatoverview#285: 远端历史回填一页（`source=remote`）。
///
/// 1. 网络等待期间不持有 SQLite 写锁；2. 提交前重核登录身份，退出/切账号使旧请求失效；
/// 3. 同一写锁/事务内按墓碑规则只插缺失、已有保留；4. 返回本批 ID 的本地可见记录
/// （本地较新版本），不直接返回 HTTP 旧对象；5. 事务失败不推进游标，重试幂等。
/// ponytail: 无房间历史代次计数器， ceilings 为 uid 重核 + 同事务墓碑保护；切房竞态由 TS 浏览代次兜底。
async fn page_msg_remote(
    param: CursorPageMessageParam,
    state: State<'_, AppData>,
    binding: SessionBinding,
) -> Result<CursorPageResp<Vec<MessageResp>>, String> {
    let room_id = param.room_id.clone();
    let page_size = param.cursor_page_param.page_size.clamp(1, 100);
    let request_cursor = param.cursor_page_param.cursor.clone();
    if room_id.is_empty() {
        return Err("roomId 不能为空".to_string());
    }

    // 网络请求前捕获登录身份
    let login_uid = binding.identity.uid.clone();
    if login_uid.is_empty() {
        return Err("未登录，无法回填历史消息".to_string());
    }

    let remote_params = RemoteMsgPageParams {
        room_id: room_id.clone(),
        page_size,
        cursor: if request_cursor.is_empty() {
            None
        } else {
            Some(request_cursor.clone())
        },
        skip: false,
    };

    // 不在网络等待期间持有 SQLite 写锁，复用现有认证请求及 token 更新处理
    let fetch_result: Result<Option<RemoteMsgPageDto>, CommonError> = request_bound(
        &state.rc,
        &state.session,
        &binding,
        ImUrl::GetMsgPage,
        None::<serde_json::Value>,
        Some(remote_params),
    )
    .await;
    let dto = fetch_result
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "远端历史返回空响应".to_string())?;

    let mut remote_list = dto.list.or(dto.records).unwrap_or_default();
    // ID 不转 JS Number；服务端按 id DESC、id < cursor 翻页，本地 send_time:id 不得传给远端
    remote_list.retain(|m| m.message.room_id.as_deref() == Some(room_id.as_str()));
    let remote_ids: Vec<String> = remote_list
        .iter()
        .filter_map(|m| m.message.id.clone())
        .collect();
    let returned = remote_ids.len();

    let remote_cursor = im_message_repository::normalize_remote_page(
        &request_cursor,
        dto.cursor.clone(),
        dto.is_last,
    )
    .map_err(|e| e.to_string())?;

    let db_conn = binding.db.clone();
    let room_for_save = room_id.clone();
    let uid_for_save = login_uid.clone();
    let stats = run_with_write_lock(
        state.session.clone(),
        binding.clone(),
        "save_history_page",
        || {
            let db_conn = db_conn.clone();
            let room_for_save = room_for_save.clone();
            let uid_for_save = uid_for_save.clone();
            let mut records: Vec<MessageWithThumbnail> = remote_list
                .clone()
                .into_iter()
                .map(|msg_resp| convert_resp_to_record_for_fetch(msg_resp, uid_for_save.clone()))
                .collect();
            // 回填页的 time_block 按批次内顺序预填，查询时已有值则保留
            records.sort_by(|a, b| {
                let a_time = a.message.send_time.unwrap_or(0);
                let b_time = b.message.send_time.unwrap_or(0);
                a_time.cmp(&b_time)
            });
            async move {
                let tx = db_conn.begin().await.map_err(CommonError::DatabaseError)?;
                // The retry helper holds the shared identity/commit gate for this transaction.
                let stats = im_message_repository::save_history_page(
                    &tx,
                    records,
                    &uid_for_save,
                    &room_for_save,
                )
                .await?;
                tx.commit().await.map_err(CommonError::DatabaseError)?;
                Ok(stats)
            }
        },
    )
    .await?;

    // Read only the captured database, and reject responses invalidated before publication.
    let response_gate = state.session.commit(&binding).await?;
    let db = &binding.db;
    let visible =
        im_message_repository::find_visible_by_ids(&*db, &remote_ids, &room_id, &login_uid)
            .await
            .map_err(|e| e.to_string())?;

    let mut sorted = visible;
    sorted.sort_by(|a, b| {
        let a_time = a.message.send_time.unwrap_or(0);
        let b_time = b.message.send_time.unwrap_or(0);
        a_time
            .cmp(&b_time)
            .then_with(|| a.message.id.cmp(&b.message.id))
    });

    let db2 = &binding.db;
    let mut message_resps: Vec<MessageResp> = Vec::with_capacity(sorted.len());
    for (index, msg) in sorted.into_iter().enumerate() {
        let mut resp = convert_message_to_resp(msg.clone(), None);
        if index == 0 {
            resp.time_block = Some(1);
        } else if let Some(send_time) = msg.message.send_time {
            resp.time_block = im_message_repository::calculate_time_block(
                &*db2,
                &msg.message.room_id,
                &msg.message.id,
                send_time,
                &login_uid,
            )
            .await
            .map_err(|e| e.to_string())?;
        }
        message_resps.push(resp);
    }
    drop(response_gate);

    info!(
        target: "tauri_db",
        "[history-backfill] source=remote roomId={} pageSize={} reqCursor={} respCursor={} returned={} inserted={} existing={} tombstone={} roomMismatch={} isLast={}",
        room_id,
        page_size,
        request_cursor,
        remote_cursor,
        returned,
        stats.inserted,
        stats.skipped_existing,
        stats.skipped_tombstone,
        stats.skipped_room_mismatch,
        dto.is_last,
    );

    Ok(CursorPageResp {
        cursor: remote_cursor,
        is_last: dto.is_last,
        list: Some(message_resps),
        total: dto.total,
    })
}

/// aichatoverview#350：当前阅读窗口校准参数（TS 侧组装可见窗口 + 已知 ID）。
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalibrateWindowParam {
    room_id: String,
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    from_time_ms: Option<i64>,
    #[serde(default)]
    from_id: Option<String>,
    #[serde(default)]
    to_time_ms: Option<i64>,
    #[serde(default)]
    to_id: Option<String>,
    #[serde(default)]
    known_msg_ids: Vec<String>,
    #[serde(default)]
    page_size: Option<u32>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct WindowRequestBody {
    room_id: String,
    request_id: String,
    mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    from_time_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    from_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    to_time_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    to_id: Option<String>,
    known_msg_ids: Vec<String>,
    page_size: u32,
}

/// aichatoverview#350 wire-compat：服务端 Long 全局转字符串，WindowBound.timeMs
/// 实为字符串（"1791070187188"），而 sendTime（LocalDateTime→时间戳）为数字；
/// 两形态都接受，缺失/空为 None（与 #285 total 双形态同口径）。
fn de_opt_i64_str_or_num<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    let v = serde_json::Value::deserialize(deserializer)?;
    match v {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::Number(n) => n
            .as_i64()
            .map(Some)
            .ok_or_else(|| serde::de::Error::custom(format!("timeMs 非法数字: {n}"))),
        serde_json::Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                return Ok(None);
            }
            t.parse::<i64>()
                .map(Some)
                .map_err(|_| serde::de::Error::custom(format!("timeMs 非法字符串: {s:?}")))
        }
        _ => Err(serde::de::Error::custom("timeMs 类型非法")),
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WindowBoundDto {
    #[serde(default, deserialize_with = "de_opt_i64_str_or_num")]
    time_ms: Option<i64>,
    #[serde(default)]
    id: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct KnownReceiptDto {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    available: Option<bool>,
    #[serde(default)]
    message: Option<MessageResp>,
}

/// aichatoverview#350：窗口 envelope 全部字段 Option——缺字段必须能解析出来再判
/// unsupported，绝不能反序列化失败就当成功空或失权。
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct WindowCalibrateDto {
    #[serde(default)]
    schema_version: Option<String>,
    #[serde(default)]
    capabilities: Option<Vec<String>>,
    #[serde(default)]
    #[allow(dead_code)]
    request_id: Option<String>,
    #[serde(default)]
    items: Option<Vec<MessageResp>>,
    #[serde(default)]
    covered_lower: Option<WindowBoundDto>,
    #[serde(default)]
    covered_upper: Option<WindowBoundDto>,
    #[serde(default)]
    complete: Option<bool>,
    #[serde(default)]
    known_receipts: Option<Vec<KnownReceiptDto>>,
    #[serde(default)]
    known_complete: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalibrateWindowResult {
    pub room_id: String,
    pub request_id: String,
    pub complete: bool,
    pub known_complete: bool,
    pub inserted: usize,
    pub recalled: usize,
    pub hidden: usize,
    pub unhidden: usize,
    pub unconfirmed: usize,
    pub items: Vec<MessageResp>,
    pub unavailable_ids: Vec<String>,
    pub covered_lower: Option<WindowBoundDto>,
    pub covered_upper: Option<WindowBoundDto>,
}

#[derive(Debug)]
struct ValidatedWindow {
    items: Vec<MessageResp>,
    receipts: Vec<(String, bool, Option<MessageResp>)>,
    complete: bool,
    known_complete: bool,
    covered_lower: Option<WindowBoundDto>,
    covered_upper: Option<WindowBoundDto>,
}

/// aichatoverview#350：envelope 严格校验（纯函数，可单测）。
///
/// schema_version/能力/字段缺失一律判 unsupported（保持缓存、未校准、可重试），
/// 不当成功空，不当失权；回执必须与请求 ID 一一对应且顺序一致。
fn validate_window_dto(
    dto: WindowCalibrateDto,
    requested_known: &[String],
) -> Result<ValidatedWindow, String> {
    let unsupported = |why: String| format!("window_unsupported: {}", why);
    match dto.schema_version.as_deref() {
        Some("msg-window-v1") => {}
        other => {
            return Err(unsupported(format!(
                "schema_version 不是 msg-window-v1: {:?}",
                other
            )));
        }
    }
    let caps = dto.capabilities.unwrap_or_default();
    for need in ["messages", "known-receipts"] {
        if !caps.iter().any(|c| c == need) {
            return Err(unsupported(format!("缺能力 {}", need)));
        }
    }
    let items = dto
        .items
        .ok_or_else(|| unsupported("缺 items".to_string()))?;
    let complete = dto
        .complete
        .ok_or_else(|| unsupported("缺 complete".to_string()))?;
    let receipts_raw = dto
        .known_receipts
        .ok_or_else(|| unsupported("缺 knownReceipts".to_string()))?;
    let known_complete = dto
        .known_complete
        .ok_or_else(|| unsupported("缺 knownComplete".to_string()))?;
    if receipts_raw.len() != requested_known.len() {
        return Err(unsupported(format!(
            "knownReceipts 数量 {} 与请求 {} 不一致",
            receipts_raw.len(),
            requested_known.len()
        )));
    }
    let mut receipts = Vec::with_capacity(receipts_raw.len());
    for (i, r) in receipts_raw.into_iter().enumerate() {
        let id = r.id.ok_or_else(|| unsupported("回执缺 id".to_string()))?;
        if id != requested_known[i] {
            return Err(unsupported("回执顺序与请求不一致".to_string()));
        }
        let available = r
            .available
            .ok_or_else(|| unsupported("回执缺 available".to_string()))?;
        if available && r.message.is_none() {
            return Err(unsupported("available 回执缺 message".to_string()));
        }
        if !available && r.message.is_some() {
            return Err(unsupported("unavailable 回执不应带 message".to_string()));
        }
        receipts.push((id, available, r.message));
    }
    Ok(ValidatedWindow {
        items,
        receipts,
        complete,
        known_complete,
        covered_lower: dto.covered_lower,
        covered_upper: dto.covered_upper,
    })
}

/// aichatoverview#350：传输层错误分级（纯函数，可单测）。
///
/// 404 类文本（旧服务端无此路由）判 unsupported；鉴权失败原文透出（调用方转登录，
/// 不重试）；其余判 window_error（可重试）；任何失败都不当成功空、不当失权。
fn map_window_request_error(err: String) -> String {
    if err.contains("请重新登录") || err.contains("token过期") || err.contains("Token expired")
    {
        return err;
    }
    let lower = err.to_lowercase();
    // ponytail：文本启发而非状态码——request() 只透业务 code，HTTP 404 落在 anyhow 文本里；
    // 若服务端补窗口能力探针，用探针替换此处。
    if lower.contains("404")
        || lower.contains("not found")
        || lower.contains("no handler")
        || lower.contains("no static resource")
        || lower.contains("no such route")
        || lower.contains("unknown path")
    {
        return format!(
            "window_unsupported: 服务端无窗口校准接口（疑似旧版本）: {}",
            err
        );
    }
    format!("window_error: {}", err)
}

fn is_decimal_id(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// 服务端撤回类型（与服务端 MessageTypeEnum.RECALL=2、前端 MsgEnum.RECALL=2 同值）。
const RECALL_MESSAGE_TYPE: u8 = 2;

/// aichatoverview#350：当前阅读窗口校准。
///
/// 1. 网络等待不持写锁；2. 提交前重核账号代次与房间归属，迟到结果不串房不写新库；
/// 3. 同一写事务内按指纹门禁合并：缺失插入（墓碑/清空边界/已存在优先复用
/// save_history_page），已有行变更必须指纹未变，否则保留本地并计未确认；
/// 4. 撤回只做 NORMAL→RECALL 单向，终态不倒退；乐观 temp 行（T 前缀）与非 success
/// 行永不覆盖；5. 冲突未重查完不报 complete。
#[tauri::command]
pub async fn calibrate_window(
    param: CalibrateWindowParam,
    state: State<'_, AppData>,
    binding: SessionIdentity,
) -> Result<CalibrateWindowResult, String> {
    let binding = state.session.capture_identity(&binding)?;
    let room_id = param.room_id.trim().to_string();
    if room_id.is_empty() {
        return Err("roomId 不能为空".to_string());
    }
    let login_uid = binding.identity.uid.clone();
    if login_uid.is_empty() {
        return Err("未登录，无法校准窗口".to_string());
    }
    let page_size = param.page_size.unwrap_or(20).clamp(1, 100);
    // 服务端只收十进制 id：乐观 temp 行（T 前缀）不进 known/边界，避免整包 400。
    let known_msg_ids: Vec<String> = param
        .known_msg_ids
        .into_iter()
        .filter(|id| is_decimal_id(id))
        .take(100)
        .collect();
    let mode = match param.mode.as_deref().map(str::trim) {
        None | Some("") | Some("tail") => "tail".to_string(),
        Some("range") => "range".to_string(),
        Some(other) => return Err(format!("未知窗口模式: {}", other)),
    };
    let clean_id = |v: Option<String>| v.filter(|s| is_decimal_id(s));
    let request_id = param
        .request_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("wcal-{}-{}", chrono::Utc::now().timestamp_millis(), room_id));

    // 快照请求发起前的本地指纹：逐记录 touch 保护的比对基线（不持写锁）。
    let snapshot_gate = state.session.commit(&binding).await?;
    let snapshot =
        im_message_repository::find_fingerprints(&binding.db, &known_msg_ids, &room_id, &login_uid)
            .await
            .map_err(|e| e.to_string())?;
    drop(snapshot_gate);

    let body = WindowRequestBody {
        room_id: room_id.clone(),
        request_id: request_id.clone(),
        mode,
        from_time_ms: param.from_time_ms,
        from_id: clean_id(param.from_id),
        to_time_ms: param.to_time_ms,
        to_id: clean_id(param.to_id),
        known_msg_ids: known_msg_ids.clone(),
        page_size,
    };
    let dto_result: Result<Option<WindowCalibrateDto>, String> = request_bound(
        &state.rc,
        &state.session,
        &binding,
        ImUrl::GetMsgWindow,
        Some(body),
        None::<serde_json::Value>,
    )
    .await
    .map_err(|e| map_window_request_error(e.to_string()));
    let dto = match dto_result {
        Err(e) => {
            // 失败保持可读缓存：只记 outcome，不清空、不谎报已校准。
            warn!(
                target: "tauri_db",
                "[window-calibrate] roomId={} requestId={} outcome=request-failed detail={}",
                room_id,
                request_id,
                e
            );
            return Err(e);
        }
        Ok(None) => {
            warn!(
                target: "tauri_db",
                "[window-calibrate] roomId={} requestId={} outcome=request-failed detail=window_error: 空响应",
                room_id, request_id
            );
            return Err("window_error: 窗口校准返回空响应".to_string());
        }
        Ok(Some(dto)) => dto,
    };
    let window = match validate_window_dto(dto, &known_msg_ids) {
        Err(e) => {
            warn!(
                target: "tauri_db",
                "[window-calibrate] roomId={} requestId={} outcome=validate-failed detail={}",
                room_id,
                request_id,
                e
            );
            return Err(e);
        }
        Ok(w) => w,
    };

    // 权威集合 = 范围 items ∪ 可用回执内容（去重）；串房行丢弃。
    let mut authoritative: Vec<MessageResp> = window.items;
    {
        let mut seen: HashSet<String> = authoritative
            .iter()
            .filter_map(|m| m.message.id.clone())
            .collect();
        for (_, available, content) in &window.receipts {
            if *available {
                if let Some(msg) = content {
                    if let Some(id) = msg.message.id.clone() {
                        if seen.insert(id) {
                            authoritative.push(msg.clone());
                        }
                    }
                }
            }
        }
    }
    authoritative.retain(|m| m.message.room_id.as_deref() == Some(room_id.as_str()));

    let room_for_save = room_id.clone();
    let uid_for_save = login_uid.clone();
    let snapshot_for_save = snapshot.clone();
    let stats = run_with_write_lock(
        state.session.clone(),
        binding.clone(),
        "calibrate_window",
        || {
            let db_conn = binding.db.clone();
            let room_for_save = room_for_save.clone();
            let uid_for_save = uid_for_save.clone();
            let snapshot_for_save = snapshot_for_save.clone();
            let authoritative = authoritative.clone();
            let receipts: Vec<(String, bool)> = window
                .receipts
                .iter()
                .map(|(id, available, _)| (id.clone(), *available))
                .collect();
            async move {
                let tx = db_conn.begin().await.map_err(CommonError::DatabaseError)?;
                // 提交时重读：快照有记录且不一致 = 在途被 WS/本地触及，保留本地。
                let mut watch: Vec<String> = authoritative
                    .iter()
                    .filter_map(|m| m.message.id.clone())
                    .collect();
                watch.extend(receipts.iter().map(|(id, _)| id.clone()));
                watch.sort();
                watch.dedup();
                let current = im_message_repository::find_fingerprints(
                    &tx,
                    &watch,
                    &room_for_save,
                    &uid_for_save,
                )
                .await?;
                let touched = |id: &str| {
                    snapshot_for_save
                        .get(id)
                        .is_some_and(|fp| current.get(id) != Some(fp))
                };

                // 缺失插入：墓碑/清空边界/已存在/串房由 save_history_page 统一守护。
                let records: Vec<MessageWithThumbnail> = authoritative
                    .iter()
                    .cloned()
                    .map(|msg_resp| {
                        convert_resp_to_record_for_fetch(msg_resp, uid_for_save.clone())
                    })
                    .collect();
                let save_stats = im_message_repository::save_history_page(
                    &tx,
                    records,
                    &uid_for_save,
                    &room_for_save,
                )
                .await?;

                let mut recalled = 0usize;
                let mut unconfirmed = 0usize;
                // 已有行的权威变更：指纹门禁 + 撤回单向 + 乐观保护。
                for msg_resp in &authoritative {
                    let Some(id) = msg_resp.message.id.clone() else {
                        continue;
                    };
                    if id.starts_with('T') {
                        continue;
                    }
                    if current.get(&id).is_none() {
                        continue; // 刚插入或仍缺失，无需变更
                    }
                    if touched(&id) {
                        // 在途被触及的行若权威仍有意见则记未确认（插入已由上一步完成）。
                        unconfirmed += 1;
                        continue;
                    }
                    let (_, _, send_status) = &current[&id];
                    if send_status != "success" {
                        continue;
                    }
                    let (local_type, _, _) = &current[&id];
                    if msg_resp.message.message_type == Some(RECALL_MESSAGE_TYPE)
                        && *local_type != Some(RECALL_MESSAGE_TYPE)
                    {
                        let body_str = msg_resp
                            .message
                            .body
                            .as_ref()
                            .map(|b| serde_json::to_string(b).unwrap_or_default())
                            .unwrap_or_default();
                        im_message_repository::update_message_recall_status(
                            &tx,
                            &id,
                            RECALL_MESSAGE_TYPE,
                            &body_str,
                            &uid_for_save,
                        )
                        .await?;
                        recalled += 1;
                    }
                }

                // 权威不可用：本地存在、未被触及、已发送成功才标隐藏；缺失即确认。
                let mut hidden = 0usize;
                let mut unavailable_effective: Vec<String> = Vec::new();
                for (id, available) in &receipts {
                    if *available || id.starts_with('T') {
                        continue;
                    }
                    if current.get(id).is_none() {
                        continue;
                    }
                    if touched(id) {
                        unconfirmed += 1;
                        continue;
                    }
                    let (_, _, send_status) = &current[id];
                    if send_status != "success" {
                        continue;
                    }
                    im_message_repository::mark_remote_hidden(
                        &tx,
                        id,
                        &room_for_save,
                        &uid_for_save,
                    )
                    .await?;
                    hidden += 1;
                    unavailable_effective.push(id.clone());
                }

                // 权威可用：清除历史隐藏标记（重新确认可见），计实际复活数。
                let available_ids: Vec<String> = authoritative
                    .iter()
                    .filter_map(|m| m.message.id.clone())
                    .collect();
                let was_hidden =
                    im_message_repository::remote_hidden_ids(&tx, &available_ids, &uid_for_save)
                        .await?;
                im_message_repository::clear_remote_hidden(&tx, &available_ids, &uid_for_save)
                    .await?;
                let unhidden = available_ids
                    .iter()
                    .filter(|id| was_hidden.contains(*id))
                    .count();

                tx.commit().await.map_err(CommonError::DatabaseError)?;
                Ok((
                    save_stats,
                    recalled,
                    hidden,
                    unhidden,
                    unconfirmed,
                    unavailable_effective,
                ))
            }
        },
    )
    .await?;
    let (save_stats, recalled, hidden, unhidden, unconfirmed, unavailable_effective) = stats;

    // 回读本地较新版本返回（不直接返 HTTP 旧对象），顺带重算 time_block。
    let response_gate = state.session.commit(&binding).await?;
    let db = &binding.db;
    let auth_ids: Vec<String> = authoritative
        .iter()
        .filter_map(|m| m.message.id.clone())
        .collect();
    let mut sorted =
        im_message_repository::find_visible_by_ids(&*db, &auth_ids, &room_id, &login_uid)
            .await
            .map_err(|e| e.to_string())?;
    sorted.sort_by(|a, b| {
        let a_time = a.message.send_time.unwrap_or(0);
        let b_time = b.message.send_time.unwrap_or(0);
        a_time
            .cmp(&b_time)
            .then_with(|| a.message.id.cmp(&b.message.id))
    });

    let db2 = &binding.db;
    let mut message_resps: Vec<MessageResp> = Vec::with_capacity(sorted.len());
    for (index, msg) in sorted.into_iter().enumerate() {
        let mut resp = convert_message_to_resp(msg.clone(), None);
        if index == 0 {
            resp.time_block = Some(1);
        } else if let Some(send_time) = msg.message.send_time {
            resp.time_block = im_message_repository::calculate_time_block(
                &*db2,
                &msg.message.room_id,
                &msg.message.id,
                send_time,
                &login_uid,
            )
            .await
            .map_err(|e| e.to_string())?;
        }
        message_resps.push(resp);
    }
    drop(response_gate);

    info!(
        target: "tauri_db",
        "[window-calibrate] roomId={} requestId={} complete={} knownComplete={} inserted={} existing={} tombstone={} recalled={} hidden={} unhidden={} unconfirmed={}",
        room_id,
        request_id,
        window.complete,
        window.known_complete,
        save_stats.inserted,
        save_stats.skipped_existing,
        save_stats.skipped_tombstone,
        recalled,
        hidden,
        unhidden,
        unconfirmed,
    );

    Ok(CalibrateWindowResult {
        room_id,
        request_id,
        complete: window.complete && window.known_complete && unconfirmed == 0,
        known_complete: window.known_complete,
        inserted: save_stats.inserted,
        recalled,
        hidden,
        unhidden,
        unconfirmed,
        items: message_resps,
        unavailable_ids: unavailable_effective,
        covered_lower: window.covered_lower,
        covered_upper: window.covered_upper,
    })
}

/// 将数据库消息模型转换为响应模型
pub fn convert_message_to_resp(
    record: MessageWithThumbnail,
    old_msg_id: Option<String>,
) -> MessageResp {
    let MessageWithThumbnail {
        message: msg,
        thumbnail_path,
    } = record;

    // 解析消息体 - 安全地处理 JSON 解析
    let mut body = msg.body.as_ref().and_then(|body_str| {
        if body_str.trim().is_empty() {
            None
        } else {
            match serde_json::from_str(body_str) {
                Ok(parsed) => Some(parsed),
                Err(e) => {
                    debug!(
                        "Failed to parse message body JSON for message {}: {}",
                        msg.id, e
                    );
                    // 如果解析失败，将原始字符串作为文本消息处理
                    Some(serde_json::json!({
                        "content": body_str
                    }))
                }
            }
        }
    });

    inject_thumbnail_path(&mut body, thumbnail_path.as_deref());

    // 解析消息标记 - 支持从 message_marks 字段解析
    let message_marks = msg.message_marks.as_ref().and_then(|marks_str| {
        if marks_str.trim().is_empty() {
            return None;
        }

        match serde_json::from_str::<HashMap<String, MessageMark>>(marks_str) {
            Ok(parsed_marks) => {
                if parsed_marks.is_empty() {
                    None
                } else {
                    Some(parsed_marks)
                }
            }
            Err(e) => {
                debug!(
                    "Failed to parse message marks JSON for message {}: {}",
                    msg.id, e
                );
                None
            }
        }
    });

    // 构建响应对象
    MessageResp {
        create_id: Some(msg.id.clone()),
        create_time: msg.send_time,
        update_id: None,
        update_time: None,
        from_user: FromUser {
            uid: msg.uid,
            nickname: msg.nickname,
            // aichatoverview#47: 从本地 DB 回放 userType，reload 后模板 :data-user-type 仍能命中。
            user_type: msg.user_type,
        },
        message: Message {
            id: Some(msg.id),
            room_id: Some(msg.room_id),
            message_type: msg.message_type,
            body,
            message_marks,
            send_time: msg.send_time,
            // aichatoverview#34: 透传本地 DB 的发送状态，让重载后的消息持久保留 FAILED/SUCCESS 等。
            status: Some(msg.send_status),
            // aichatoverview#42: 本地 DB 回放不携带 client_msg_id，保持 None。
            client_msg_id: None,
        },
        old_msg_id: old_msg_id,
        time_block: msg.time_block,
    }
}

/// 检查用户初始化状态并获取消息
pub async fn check_user_init_and_fetch_messages(
    client: &mut ImRequestClient,
    binding: &SessionBinding,
    sessions: &SessionStore,
    uid: &str,
    async_data: bool,
    force_full: bool,
) -> Result<(), CommonError> {
    if uid != binding.identity.uid || !sessions.is_current(binding) {
        return Err(CommonError::RequestError("同步账号代次已失效".into()));
    }
    let db_conn = &binding.db;
    // 防止高频同步，10秒内只允许一次同步(比如弱网、网络不好情况下会重复重连)
    static MESSAGE_SYNC_LOCK: Lazy<tokio::sync::Mutex<()>> =
        Lazy::new(|| tokio::sync::Mutex::new(()));
    static LAST_MESSAGE_SYNC: Lazy<std::sync::Mutex<Option<(SessionIdentity, i64)>>> =
        Lazy::new(|| std::sync::Mutex::new(None));
    const MESSAGE_SYNC_COOLDOWN_MS: i64 = 10_000;

    info!(
        "Checking user initialization status and fetching messages, uid: {}",
        uid
    );

    let now_ms = chrono::Utc::now().timestamp_millis();
    if !force_full {
        let last = LAST_MESSAGE_SYNC
            .lock()
            .expect("sync clock poisoned")
            .as_ref()
            .filter(|(identity, _)| identity == &binding.identity)
            .map(|(_, time)| *time)
            .unwrap_or(0);
        if now_ms - last < MESSAGE_SYNC_COOLDOWN_MS {
            info!(
                "Skip message sync due to cooldown (last={}ms, now={}ms, uid={})",
                last, now_ms, uid
            );
            return Ok(());
        }
    }

    let guard = match MESSAGE_SYNC_LOCK.try_lock() {
        Ok(g) => g,
        Err(_) => {
            info!(
                "Skip message sync because another sync is in progress, uid={}",
                uid
            );
            return Ok(());
        }
    };

    // 检查用户的 is_init 状态
    if let Ok(user) = ImUserEntity::find()
        .filter(im_user::Column::Id.eq(uid))
        .one(db_conn)
        .await
    {
        if let Some(user_model) = user {
            let should_full_sync = force_full || user_model.is_init;
            // 如果 is_init 为 true，调用后端接口获取所有消息；否则按增量模式同步
            if should_full_sync {
                info!(
                    "User {} needs initialization, starting to fetch all messages",
                    uid
                );
                // 传递用户的 async_data 参数
                if let Err(e) = fetch_all_messages(client, binding, sessions, uid, async_data).await
                {
                    error!("Failed to fetch all messages: {}", e);
                    return Err(e);
                }
            } else {
                info!(
                    "User {} incremental/offline message update, async_data: {:?}",
                    uid, async_data
                );
                fetch_all_messages(client, binding, sessions, uid, async_data)
                    .await
                    .map_err(|e| {
                        error!("Failed to update offline messages: {}", e);
                        e
                    })?;
            }
        }
    }
    *LAST_MESSAGE_SYNC.lock().expect("sync clock poisoned") =
        Some((binding.identity.clone(), now_ms));
    drop(guard);
    Ok(())
}

// 获取所有消息并保存到数据库
pub async fn fetch_all_messages(
    client: &mut ImRequestClient,
    binding: &SessionBinding,
    sessions: &SessionStore,
    uid: &str,
    async_data: bool,
) -> Result<(), CommonError> {
    if !sessions.is_current(binding) {
        return Err(CommonError::RequestError("同步代次失效".into()));
    }
    let db_conn = &binding.db;
    info!(
        "Starting to fetch all messages, uid: {}, async_data: {:?}",
        uid, async_data
    );
    // 调用后端接口 /chat/msg/list 获取所有消息，传递 async_data 参数
    let body = match async_data {
        true => Some(serde_json::json!({ "async": async_data })),
        false => None,
    };

    let old_tokens = capture_token_snapshot_direct(client);

    let messages: Option<Vec<MessageResp>> = client
        .im_request(ImUrl::GetMsgList, body, None::<serde_json::Value>)
        .await?;

    persist_captured_tokens(
        &old_tokens,
        &capture_token_snapshot_direct(client),
        binding,
        sessions,
    )
    .await
    .map_err(CommonError::RequestError)?;

    let mut messages =
        messages.ok_or_else(|| CommonError::RequestError("同步消息响应为空，未完成同步".into()))?;
    {
        // 排序消息（按发送时间）
        messages.sort_by(|a, b| {
            let a_time = a.message.send_time.unwrap_or(0);
            let b_time = b.message.send_time.unwrap_or(0);
            a_time.cmp(&b_time)
        });

        // 批量计算 time_block（先计算，再一次性写库）
        // 以 DB 中最后一条消息的 send_time 作为起点，批次内逐条递进
        const TIME_BLOCK_THRESHOLD_MS: i64 = 1000 * 60 * 10;
        let mut last_send_time_map: HashMap<String, Option<i64>> = HashMap::new();

        for (_index, msg_resp) in messages.iter_mut().enumerate() {
            let room_id = match &msg_resp.message.room_id {
                Some(v) => v.clone(),
                None => continue,
            };
            let send_time = match msg_resp.message.send_time {
                Some(v) => v,
                None => continue,
            };

            // 获取该房间的上一条 send_time（优先使用批次内最新值，否则从 DB 取一次）
            let prev_send_time = match last_send_time_map.get(&room_id) {
                Some(value) => *value,
                None => {
                    let last_time = im_message::Entity::find()
                        .filter(im_message::Column::RoomId.eq(&room_id))
                        .filter(im_message::Column::LoginUid.eq(uid))
                        .order_by_desc(im_message::Column::SendTime)
                        .select_only()
                        .column(im_message::Column::SendTime)
                        .into_tuple::<Option<i64>>()
                        .one(db_conn)
                        .await
                        .map_err(|e| anyhow::anyhow!("Failed to query last send_time: {}", e))?
                        .flatten();
                    last_send_time_map.insert(room_id.clone(), last_time);
                    last_time
                }
            };

            msg_resp.time_block = if let Some(prev) = prev_send_time {
                let gap = send_time - prev;
                if gap >= TIME_BLOCK_THRESHOLD_MS {
                    Some(gap)
                } else {
                    None
                }
            } else {
                // 房间第一条消息始终显示时间
                Some(1)
            };

            // 当前消息成为下一条的参考
            last_send_time_map.insert(room_id, Some(send_time));
        }

        // Preserve temp-ID reconciliation within the same bounded transaction as each saved batch.
        // ponytail: 20 rows per commit gate; tune only with measured SQLite commit latency.
        for batch in messages.chunks(20) {
            let client_msg_ids: Vec<String> = batch
                .iter()
                .filter_map(|message| message.message.client_msg_id.clone())
                .filter(|id| !id.is_empty())
                .collect();
            let records = batch
                .iter()
                .cloned()
                .map(|message| convert_resp_to_record_for_fetch(message, uid.to_owned()))
                .collect();
            let gate = sessions
                .commit(binding)
                .await
                .map_err(CommonError::RequestError)?;
            let tx = db_conn.begin().await?;
            im_message_repository::delete_temp_messages_by_client_msg_id(&tx, uid, &client_msg_ids)
                .await?;
            im_message_repository::save_all(&tx, records).await?;
            tx.commit().await?;
            drop(gate);
            tokio::task::yield_now().await;
        }
        let _gate = sessions
            .commit(binding)
            .await
            .map_err(CommonError::RequestError)?;
        let tx = db_conn.begin().await?;
        im_user_repository::update_user_init_status(&tx, uid, false).await?;
        tx.commit().await?;
    }

    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncMessagesParam {
    pub async_data: Option<bool>,
    pub full_sync: Option<bool>,
    pub uid: Option<String>,
}

#[tauri::command]
pub async fn sync_messages(
    param: Option<SyncMessagesParam>,
    state: State<'_, AppData>,

    binding: SessionIdentity,
) -> Result<(), String> {
    let async_data = param.as_ref().and_then(|p| p.async_data).unwrap_or(true);
    let full_sync = param.as_ref().and_then(|p| p.full_sync).unwrap_or(false);
    let uid = match param.as_ref().and_then(|p| p.uid.clone()) {
        Some(v) if !v.is_empty() => v,
        _ => state.user_info.lock().await.uid.clone(),
    };

    let binding = state.session.capture_identity(&binding)?;
    let mut client = state.rc.lock().await;
    check_user_init_and_fetch_messages(
        &mut client,
        &binding,
        &state.session,
        &uid,
        async_data,
        full_sync,
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 将 MessageResp 转换为数据库模型（用于 fetch_all_messages）
fn convert_resp_to_record_for_fetch(msg_resp: MessageResp, uid: String) -> MessageWithThumbnail {
    use serde_json;

    // 序列化消息体为 JSON 字符串
    let body_json = msg_resp
        .message
        .body
        .as_ref()
        .and_then(|body| serde_json::to_string(body).ok());

    // 序列化消息标记为 JSON 字符串
    let marks_json = msg_resp
        .message
        .message_marks
        .as_ref()
        .and_then(|marks| serde_json::to_string(marks).ok());

    let model = im_message::Model {
        id: msg_resp.message.id.unwrap_or_default(),
        uid: msg_resp.from_user.uid,
        nickname: msg_resp.from_user.nickname,
        room_id: msg_resp.message.room_id.unwrap_or_default(),
        message_type: msg_resp.message.message_type,
        body: body_json,
        message_marks: marks_json,
        send_time: msg_resp.message.send_time,
        create_time: msg_resp.create_time,
        update_time: msg_resp.update_time,
        login_uid: uid.to_string(),
        // aichatoverview#35: sync 拉下来的都是服务端已持久化的消息，等价于发送成功；
        // 服务端不返回发送状态字段，故硬编码 success 是正确行为（详见 issue #35 诊断结论）。
        send_status: "success".to_string(),
        // aichatoverview#47: 透传服务端 fromUser.userType，供重载后 :data-user-type 使用。
        user_type: msg_resp.from_user.user_type,
        time_block: msg_resp.time_block,
    };

    let thumbnail_path = extract_thumbnail_path_from_body(&msg_resp.message.body);
    MessageWithThumbnail::new(model, thumbnail_path)
}

fn extract_thumbnail_path_from_body(body: &Option<serde_json::Value>) -> Option<String> {
    body.as_ref().and_then(|value| {
        value.as_object().and_then(|obj| {
            obj.get("thumbnailPath")
                .or_else(|| obj.get("thumbnail_path"))
                .and_then(|v| v.as_str().map(|s| s.to_string()))
        })
    })
}

fn inject_thumbnail_path(body: &mut Option<serde_json::Value>, path: Option<&str>) {
    let Some(path) = path else {
        return;
    };

    if path.is_empty() {
        return;
    }

    if let Some(val) = body {
        if let Some(map) = val.as_object_mut() {
            let exists = map
                .get("thumbnailPath")
                .and_then(|v| v.as_str())
                .map(|s| !s.is_empty())
                .unwrap_or(false);
            if !exists {
                map.insert(
                    "thumbnailPath".to_string(),
                    serde_json::Value::String(path.to_string()),
                );
            }
        }
    }
}

#[tauri::command]
pub async fn send_msg(
    data: ChatMessageReq,
    state: State<'_, AppData>,
    success_channel: Channel<MessageResp>,
    error_channel: Channel<serde_json::Value>,

    binding: SessionIdentity,
) -> Result<(), String> {
    let binding = state.session.capture_identity(&binding)?;
    // 获取当前登录用户信息（数据库与UID来自同一不可变归属）
    let (login_uid, nickname, current_user_type) = {
        let user_type = ImUserEntity::find()
            .filter(im_user::Column::Id.eq(&binding.identity.uid))
            .select_only()
            .column(im_user::Column::UserType)
            .into_tuple::<Option<i32>>()
            .one(&binding.db)
            .await
            .unwrap_or(None)
            .flatten();
        (binding.identity.uid.clone(), None, user_type) // UserInfo只有uid和token字段，nickname暂时设为None
    };

    // 生成消息ID
    let current_time = chrono::Utc::now().timestamp_millis();

    // 先克隆data以避免所有权问题
    let send_data = data.clone();

    // 序列化消息体
    let body_json = data
        .body
        .as_ref()
        .and_then(|body| serde_json::to_string(body).ok());
    let thumbnail_path = extract_thumbnail_path_from_body(&data.body);

    // 创建消息模型
    let message_model = im_message::Model {
        id: data.id.clone(),
        uid: login_uid.clone(),
        nickname,
        room_id: data.room_id.unwrap_or_default(),
        message_type: data.msg_type,
        body: body_json,
        message_marks: None,
        send_time: Some(current_time),
        create_time: Some(current_time),
        update_time: Some(current_time),
        login_uid: login_uid.clone(),
        send_status: "pending".to_string(), // 初始状态为pending
        // aichatoverview#47: Outgoing optimistic 消息也带当前用户 userType，与 incoming 消息保持一致。
        user_type: current_user_type,
        time_block: None,
    };

    let mut message_record = MessageWithThumbnail::new(message_model, thumbnail_path);

    message_record =
        run_with_write_lock(state.session.clone(), binding.clone(), "send_msg", || {
            let db_conn = binding.db.clone(); // 捕获具体连接，不能读取可变当前库
            let mut record = message_record.clone(); // 拷贝消息记录以便闭包内可变
            async move {
                let tx = db_conn.begin().await.map_err(CommonError::DatabaseError)?; // 开启事务
                record = im_message_repository::save_message(&tx, record).await?; // 保存消息
                tx.commit().await.map_err(CommonError::DatabaseError)?; // 提交事务
                Ok(record)
            }
        })
        .await?;

    info!(
        "Message saved to local database, ID: {}",
        message_record.message.id.clone()
    );

    let msg_id = message_record.message.id.clone();

    // 异步发送到后端接口
    let db_conn = binding.db.clone();
    let sessions = state.session.clone();
    let request_client = state.rc.clone();
    let mut record_for_send = message_record.clone();

    tokio::spawn(async move {
        let result: Result<Option<MessageResp>, CommonError> = request_bound(
            &request_client,
            &sessions,
            &binding,
            ImUrl::SendMsg,
            Some(send_data),
            None::<serde_json::Value>,
        )
        .await;
        let Ok(_gate) = sessions.commit(&binding).await else {
            return;
        };

        let mut id = None;

        // 根据发送结果更新消息状态，同时保留可读错误信息供前端展示
        let (status, error_msg) = match result {
            Ok(Some(mut resp)) => {
                resp.old_msg_id = Some(msg_id.clone());
                id = resp.message.id.clone();
                record_for_send.message.body = resp.message.body.as_ref().and_then(|body| {
                    if body.is_null() {
                        None
                    } else {
                        serde_json::to_string(body).ok()
                    }
                });
                if let Some(path) = extract_thumbnail_path_from_body(&resp.message.body) {
                    record_for_send.thumbnail_path = Some(path);
                }
                ("success", String::new())
            }
            Ok(None) => ("failed", "服务端返回空响应".to_string()),
            Err(e) => ("failed", e.to_string()),
        };

        // 更新消息状态
        let model = im_message_repository::update_message_status(
            &db_conn,
            record_for_send,
            status,
            id,
            login_uid.clone(),
        )
        .await;

        // aichatoverview#33: channel 选择必须按「发送结果 status」而非 DB-update 结果。
        // 发送失败时 status="failed" 也会被成功写进本地 DB（model 为 Ok），旧代码一律走
        // success_channel，导致前端把失败消息标成 SUCCESS、FAILED 状态永不可达
        // （#19 的 retry-button v-if=FAILED 因此端到端失效）。
        match model {
            // 发送成功且本地状态已更新 → 推成功结果给前端（onSuccess → SUCCESS）。
            Ok(model) if status == "success" => {
                let resp = convert_message_to_resp(model, Some(msg_id));
                success_channel.send(resp).unwrap();
            }
            // 发送失败（status="failed"，DB 已记 failed）→ 通知前端回写 FAILED，触发 retry-button。
            Ok(_) => {
                error_channel
                    .send(serde_json::json!({
                        "msgId": msg_id,
                        "error": error_msg
                    }))
                    .unwrap();
            }
            // 本地 DB 更新本身失败 → 同样按失败处理，让前端进入 FAILED。
            Err(e) => {
                error!("{:?}", e);
                error_channel
                    .send(serde_json::json!({
                        "msgId": msg_id,
                        "error": e.to_string()
                    }))
                    .unwrap();
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn save_msg(
    data: MessageResp,
    state: State<'_, AppData>,
    binding: SessionIdentity,
    reconciled_temp_id: Option<String>,
) -> Result<bool, String> {
    let binding = state.session.capture_identity(&binding)?;
    let client_id = data.message.client_msg_id.clone();
    let mut record = convert_resp_to_record_for_fetch(data, binding.identity.uid.clone());
    let _gate = state.session.commit(&binding).await?;
    // A late WS echo with an official ID must also respect a deleted optimistic client ID.
    for id in [
        Some(&record.message.id),
        client_id.as_ref(),
        reconciled_temp_id.as_ref(),
    ]
    .into_iter()
    .flatten()
    {
        if im_message_repository::should_skip_message_insert(
            &binding.db,
            id,
            &record.message.room_id,
            &binding.identity.uid,
            record.message.send_time,
        )
        .await
        .map_err(|error| error.to_string())?
        {
            let tx = binding
                .db
                .begin()
                .await
                .map_err(|error| error.to_string())?;
            im_message_repository::record_deleted_message(
                &tx,
                &record.message.id,
                &record.message.room_id,
                &binding.identity.uid,
            )
            .await
            .map_err(|error| error.to_string())?;
            im_message_repository::delete_message_by_id(
                &tx,
                &record.message.id,
                &binding.identity.uid,
            )
            .await
            .map_err(|error| error.to_string())?;
            tx.commit().await.map_err(|error| error.to_string())?;
            return Ok(false);
        }
    }
    if let Some(temp_id) = reconciled_temp_id {
        if !temp_id.starts_with('T') || temp_id == record.message.id {
            return Err("Invalid optimistic message ID".to_string());
        }
        let server_id = record.message.id.clone();
        record.message.id = temp_id;
        im_message_repository::update_message_status(
            &binding.db,
            record,
            "success",
            Some(server_id),
            binding.identity.uid.clone(),
        )
        .await
        .map_err(|error| error.to_string())?;
        return Ok(true);
    }
    let tx = binding
        .db
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    im_message_repository::save_message(&tx, record)
        .await
        .map_err(|error| error.to_string())?;
    tx.commit().await.map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn update_message_recall_status(
    message_id: String,
    message_type: u8,
    message_body: String,
    state: State<'_, AppData>,

    binding: SessionIdentity,
) -> Result<(), String> {
    let binding = state.session.capture_identity(&binding)?;
    let _gate = state.session.commit(&binding).await?;
    let login_uid = binding.identity.uid.clone();

    im_message_repository::update_message_recall_status(
        &binding.db,
        &message_id,
        message_type,
        &message_body,
        &login_uid,
    )
    .await
    .map_err(|e| {
        error!("❌ [RECALL] Failed to update message recall status: {}", e);
        e.to_string()
    })?;

    Ok(())
}
#[tauri::command]
pub async fn delete_message(
    message_id: String,
    room_id: Option<String>,
    state: State<'_, AppData>,

    binding: SessionIdentity,
) -> Result<(), String> {
    let binding = state.session.capture_identity(&binding)?;
    let _gate = state.session.commit(&binding).await?;
    let login_uid = binding.identity.uid.clone();

    let tx = binding
        .db
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    let db = &tx;
    let resolved_room_id = if let Some(room) = room_id {
        room
    } else {
        im_message_repository::get_room_id_by_message_id(&*db, &message_id, &login_uid)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "消息不存在或房间信息缺失".to_string())?
    };

    let deleted_rows = im_message_repository::delete_message_by_id(&*db, &message_id, &login_uid)
        .await
        .map_err(|e| {
            error!("Failed to delete message {}: {}", message_id, e);
            e.to_string()
        })?;

    im_message_repository::record_deleted_message(&*db, &message_id, &resolved_room_id, &login_uid)
        .await
        .map_err(|e| {
            error!(
                "Failed to record deletion for message {} in room {}: {}",
                message_id, resolved_room_id, e
            );
            e.to_string()
        })?;

    tx.commit().await.map_err(|error| error.to_string())?;

    // #38: 记录 rows_affected 以坐实 reconcile 路径删 temp 行是否真生效（=1 真删 / =0 调用了但没匹配到行）
    info!(
        "Deleted message {} (room {}) for current user {} from local database, rows_affected={}",
        message_id, resolved_room_id, login_uid, deleted_rows
    );

    Ok(())
}

#[tauri::command]
pub async fn delete_room_messages(
    room_id: String,
    state: State<'_, AppData>,

    binding: SessionIdentity,
) -> Result<u64, String> {
    let binding = state.session.capture_identity(&binding)?;
    let _gate = state.session.commit(&binding).await?;
    let login_uid = binding.identity.uid.clone();
    let tx = binding
        .db
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    let db = &tx;

    let last_msg_id = im_message_repository::get_room_max_message_id(&*db, &room_id, &login_uid)
        .await
        .map_err(|e| {
            error!(
                "Failed to query last message id for room {}: {}",
                room_id, e
            );
            e.to_string()
        })?;

    let affected_rows = im_message_repository::delete_messages_by_room(&*db, &room_id, &login_uid)
        .await
        .map_err(|e| {
            error!("Failed to delete messages for room {}: {}", room_id, e);
            e.to_string()
        })?;

    im_message_repository::record_room_clear(&*db, &room_id, &login_uid, last_msg_id)
        .await
        .map_err(|e| {
            error!(
                "Failed to record room clear for room {} (user {}): {}",
                room_id, login_uid, e
            );
            e.to_string()
        })?;

    tx.commit().await.map_err(|error| error.to_string())?;
    info!(
        "Deleted {} messages for room {} (user {})",
        affected_rows, room_id, login_uid
    );

    Ok(affected_rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn convert_resp_to_record_for_fetch_preserves_user_type() {
        let msg_resp = MessageResp {
            create_id: Some("1".to_string()),
            create_time: Some(1000),
            update_id: None,
            update_time: None,
            from_user: FromUser {
                uid: "u1".to_string(),
                nickname: Some("nick".to_string()),
                user_type: Some(4),
            },
            message: Message {
                id: Some("m1".to_string()),
                client_msg_id: None,
                room_id: Some("r1".to_string()),
                message_type: Some(1),
                body: Some(json!({"content": "hello"})),
                message_marks: None,
                send_time: Some(1000),
                status: None,
            },
            old_msg_id: None,
            time_block: None,
        };

        let record = convert_resp_to_record_for_fetch(msg_resp, "login".to_string());
        assert_eq!(record.message.user_type, Some(4));
        assert_eq!(record.message.uid, "u1");
    }

    #[test]
    fn convert_message_to_resp_preserves_user_type() {
        let model = im_message::Model {
            id: "m1".to_string(),
            uid: "u1".to_string(),
            nickname: Some("nick".to_string()),
            room_id: "r1".to_string(),
            send_time: Some(1000),
            message_type: Some(1),
            body: Some(r#"{"content":"hello"}"#.to_string()),
            message_marks: None,
            create_time: Some(1000),
            update_time: None,
            login_uid: "login".to_string(),
            send_status: "success".to_string(),
            user_type: Some(4),
            time_block: None,
        };
        let record = MessageWithThumbnail::new(model, None);
        let resp = convert_message_to_resp(record, None);
        assert_eq!(resp.from_user.user_type, Some(4));
        assert_eq!(resp.from_user.uid, "u1");
    }

    #[test]
    fn deserializes_message_with_client_msg_id() {
        let json = json!({
            "id": "srv-1",
            "clientMsgId": "T123456789",
            "roomId": "r1",
            "type": 1,
            "body": {"content": "hi"},
            "sendTime": 1000
        });
        let msg: Message = serde_json::from_value(json).unwrap();
        assert_eq!(msg.id, Some("srv-1".to_string()));
        assert_eq!(msg.client_msg_id, Some("T123456789".to_string()));
    }

    #[test]
    fn remote_page_dto_accepts_null_cursor_on_last_page() {
        // aichatoverview#285: 服务端最终空页 cursor=null，必须能反序列化
        let dto: RemoteMsgPageDto = serde_json::from_value(json!({
            "list": [],
            "cursor": null,
            "isLast": true,
            "total": 233
        }))
        .unwrap();
        assert!(dto.cursor.is_none());
        assert!(dto.is_last);
        assert_eq!(dto.total, 233);
    }

    #[test]
    fn remote_page_dto_accepts_string_total() {
        // aichatoverview#285 回归：服务端 total 序列化为字符串（"total":"233"）
        let dto: RemoteMsgPageDto = serde_json::from_value(json!({
            "list": [],
            "cursor": "192021986630144",
            "isLast": false,
            "total": "233"
        }))
        .unwrap();
        assert_eq!(dto.total, 233);
    }

    #[test]
    fn remote_page_dto_accepts_missing_or_null_total() {
        // aichatoverview#285: total 缺失/空亦兼容，缺省为 0
        let missing: RemoteMsgPageDto = serde_json::from_value(json!({
            "list": [],
            "cursor": "143651494275072",
            "isLast": false
        }))
        .unwrap();
        assert_eq!(missing.total, 0);
        let null: RemoteMsgPageDto = serde_json::from_value(json!({
            "list": [],
            "cursor": "143651494275072",
            "isLast": false,
            "total": null
        }))
        .unwrap();
        assert_eq!(null.total, 0);
    }

    #[test]
    fn remote_page_dto_accepts_empty_list_with_more() {
        // aichatoverview#285: list=[] && isLast=false 是合法过滤空页，不得结束
        let dto: RemoteMsgPageDto = serde_json::from_value(json!({
            "list": [],
            "cursor": "143651494275072",
            "isLast": false
        }))
        .unwrap();
        assert!(!dto.is_last);
        assert_eq!(dto.cursor.as_deref(), Some("143651494275072"));
        assert!(dto.list.unwrap().is_empty());
    }

    #[test]
    fn remote_page_dto_keeps_cursor_as_string() {
        // aichatoverview#285: 服务端游标是 ID 字符串，不得转 JS Number 精度丢失
        let dto: RemoteMsgPageDto = serde_json::from_value(json!({
            "list": [],
            "cursor": "9007199254740993",
            "isLast": false
        }))
        .unwrap();
        assert_eq!(dto.cursor.as_deref(), Some("9007199254740993"));
    }

    #[test]
    fn remote_page_params_carry_cursor_for_advancing() {
        // aichatoverview#285 D1 回归：翻页请求必须把游标发给服务端（query 参数名对齐
        // 服务端 CursorPageBaseReq），否则服务端回首页、深历史翻不动；首页请求省略 cursor
        let next = serde_json::to_value(RemoteMsgPageParams {
            room_id: "143651494275072".to_string(),
            page_size: 20,
            cursor: Some("181387987295232".to_string()),
            skip: false,
        })
        .unwrap();
        assert_eq!(
            next.get("cursor").and_then(|c| c.as_str()),
            Some("181387987295232")
        );
        assert_eq!(
            next.get("roomId").and_then(|c| c.as_str()),
            Some("143651494275072")
        );
        let first = serde_json::to_value(RemoteMsgPageParams {
            room_id: "143651494275072".to_string(),
            page_size: 20,
            cursor: None,
            skip: false,
        })
        .unwrap();
        assert!(
            first.get("cursor").is_none(),
            "homepage fetch must omit cursor"
        );
    }

    fn window_dto_fixture() -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": "msg-window-v1",
            "capabilities": ["messages", "known-receipts"],
            "requestId": "wcal-1",
            "items": [],
            "coveredLower": null,
            "coveredUpper": null,
            "complete": true,
            "knownReceipts": [
                {"id": "100", "available": true, "message": {
                    "createId": "100",
                    "fromUser": {"uid": "4", "nickname": null, "userType": 3},
                    "message": {"id": "100", "clientMsgId": null, "roomId": "10",
                        "type": 1, "body": {"content": "hi"}, "messageMarks": null,
                        "sendTime": 1000, "status": "success"},
                    "oldMsgId": null, "timeBlock": null
                }},
                {"id": "999", "available": false, "message": null}
            ],
            "knownComplete": true
        })
    }

    #[test]
    fn window_dto_validates_ok_and_receipts_align() {
        let dto: WindowCalibrateDto =
            serde_json::from_value(window_dto_fixture()).expect("fixture parses");
        let known = vec!["100".to_string(), "999".to_string()];
        let validated = validate_window_dto(dto, &known).expect("valid envelope");
        assert!(validated.complete && validated.known_complete);
        assert_eq!(validated.receipts.len(), 2);
        assert!(validated.receipts[0].1);
        assert!(!validated.receipts[1].1);
    }

    #[test]
    fn window_dto_missing_fields_is_unsupported_not_empty() {
        // 缺字段/旧版本形状：必须判 unsupported（保持缓存、可重试），不当成功空。
        for patch in [
            serde_json::json!({"schemaVersion": null}),
            serde_json::json!({"schemaVersion": "msg-window-v0"}),
            serde_json::json!({"capabilities": ["messages"]}),
            serde_json::json!({"complete": null}),
            serde_json::json!({"knownReceipts": null}),
            serde_json::json!({"knownComplete": null}),
        ] {
            let mut v = window_dto_fixture();
            for (k, val) in patch.as_object().unwrap() {
                v[k] = val.clone();
            }
            let dto: WindowCalibrateDto =
                serde_json::from_value(v).expect("tolerant parse keeps missing fields");
            let err = validate_window_dto(dto, &["100".to_string(), "999".to_string()])
                .expect_err("must be unsupported");
            assert!(err.starts_with("window_unsupported:"), "got: {}", err);
        }
    }

    #[test]
    fn window_dto_receipt_mismatch_is_unsupported() {
        let dto: WindowCalibrateDto =
            serde_json::from_value(window_dto_fixture()).expect("fixture parses");
        // 回执缺一条
        let err = validate_window_dto(dto.clone(), &["100".to_string()]).expect_err("count");
        assert!(err.starts_with("window_unsupported:"), "got: {}", err);
        // available 带 message 缺失
        let mut v = window_dto_fixture();
        v["knownReceipts"][0]["message"] = serde_json::Value::Null;
        let dto2: WindowCalibrateDto = serde_json::from_value(v).unwrap();
        let err2 = validate_window_dto(dto2, &["100".to_string(), "999".to_string()])
            .expect_err("content");
        assert!(err2.starts_with("window_unsupported:"), "got: {}", err2);
    }

    #[test]
    fn window_error_mapping_grades_404_auth_and_retryable() {
        assert!(
            map_window_request_error("请求失败，状态码: 404".to_string())
                .starts_with("window_unsupported:")
        );
        assert!(
            map_window_request_error("Request error: 404 Not Found".to_string())
                .starts_with("window_unsupported:")
        );
        // 鉴权失败原文透出，不吞成可重试
        assert_eq!(
            map_window_request_error("请重新登录".to_string()),
            "请重新登录"
        );
        // 泛化失败可重试，但不是成功空也不是失权
        let other = map_window_request_error("network_error: timeout".to_string());
        assert!(other.starts_with("window_error:"), "got: {}", other);
    }

    #[test]
    fn window_bound_accepts_string_time_ms_from_wire() {
        // aichatoverview#350 回归：真实包体 coveredLower/Upper.timeMs 为字符串
        //（LuohuoJacksonModule Long→String），此前 Option<i64> 直接解码失败。
        let lower: WindowBoundDto = serde_json::from_value(json!({
            "timeMs": "1791070187188",
            "id": "212834869724672"
        }))
        .expect("string timeMs parses");
        assert_eq!(lower.time_ms, Some(1791070187188));
        assert_eq!(lower.id.as_deref(), Some("212834869724672"));
        let upper: WindowBoundDto = serde_json::from_value(json!({
            "timeMs": "1791112189184",
            "id": "213011038881280"
        }))
        .expect("string timeMs parses");
        assert_eq!(upper.time_ms, Some(1791112189184));
    }

    #[test]
    fn window_bound_accepts_numeric_time_ms_after_server_fix() {
        // 服务端改为数字输出后仍须通过（双形态兼容，不锁死任一形态）。
        let numeric: WindowBoundDto = serde_json::from_value(json!({
            "timeMs": 1791070187188i64,
            "id": "212834869724672"
        }))
        .expect("numeric timeMs parses");
        assert_eq!(numeric.time_ms, Some(1791070187188));
        let missing: WindowBoundDto =
            serde_json::from_value(json!({"id": "1"})).expect("missing timeMs");
        assert!(missing.time_ms.is_none());
        let null: WindowBoundDto = serde_json::from_value(json!({
            "timeMs": null,
            "id": "1"
        }))
        .expect("null timeMs");
        assert!(null.time_ms.is_none());
    }

    #[test]
    fn window_envelope_with_nonempty_bounds_validates() {
        // 非空 bounds 的完整 envelope 必须能解析并通过校验（此前 fixture 全为 null）。
        let dto: WindowCalibrateDto = serde_json::from_value(json!({
            "schemaVersion": "msg-window-v1",
            "capabilities": ["messages", "known-receipts"],
            "requestId": "wcal-wire3",
            "items": [],
            "coveredLower": {"timeMs": "1791070187188", "id": "212834869724672"},
            "coveredUpper": {"timeMs": "1791112189184", "id": "213011038881280"},
            "complete": false,
            "knownReceipts": [],
            "knownComplete": true
        }))
        .expect("nonempty bounds envelope parses");
        let validated = validate_window_dto(dto, &[]).expect("valid envelope");
        assert_eq!(
            validated.covered_lower.unwrap().time_ms,
            Some(1791070187188)
        );
        assert_eq!(
            validated.covered_upper.unwrap().time_ms,
            Some(1791112189184)
        );
        assert!(!validated.complete);
    }
}
