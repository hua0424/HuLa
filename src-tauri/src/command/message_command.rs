use crate::AppData;
use crate::command::token_helper::{
    capture_token_snapshot_arc, capture_token_snapshot_direct, persist_token_if_refreshed_arc,
    persist_token_if_refreshed_direct,
};
use crate::error::CommonError;
use crate::im_request_client::{ImRequestClient, ImUrl};
use crate::pojo::common::{CursorPageParam, CursorPageResp};
use crate::repository::im_message_repository::MessageWithThumbnail;
use crate::repository::{im_message_repository, im_user_repository};
use crate::vo::vo::ChatMessageReq;

use entity::im_user::Entity as ImUserEntity;
use entity::{im_message, im_user};
use once_cell::sync::Lazy;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use sea_orm::{DatabaseConnection, TransactionTrait};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use tauri::{State, ipc::Channel};
use tokio::sync::Mutex;
use tokio::time::{Duration, sleep};
use tracing::{debug, error, info, warn};

const WRITE_RETRY_LIMIT: usize = 3; // 写操作最多重试 3 次
const WRITE_RETRY_DELAY_MS: u64 = 80; // 重试基础延迟 80ms

async fn run_with_write_lock<T, F, Fut>(
    lock: Arc<Mutex<()>>, // 传入全局写锁，保证串行执行
    op_name: &str,        // 当前操作名用于日志
    mut operation: F,     // 实际写入逻辑
) -> Result<T, String>
where
    F: FnMut() -> Fut,                            // 返回异步写入 Future 的闭包
    Fut: Future<Output = Result<T, CommonError>>, // 写入结果类型
{
    let mut attempt: usize = 0; // 当前已重试次数
    loop {
        let guard = lock.lock().await; // 获取写锁
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
    #[serde(flatten)]
    cursor_page_param: CursorPageParam,
}

#[tauri::command]
pub async fn page_msg(
    param: CursorPageMessageParam,
    state: State<'_, AppData>,
) -> Result<CursorPageResp<Vec<MessageResp>>, String> {
    // 获取当前登录用户的 uid
    let login_uid = {
        let user_info = state.user_info.lock().await;
        user_info.uid.clone()
    };

    // 从数据库查询消息
    let db_result = im_message_repository::cursor_page_messages(
        &*state.db_conn.read().await,
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
                &*state.db_conn.read().await,
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
    db_conn: &DatabaseConnection,
    uid: &str,
    async_data: bool,
    force_full: bool,
) -> Result<(), CommonError> {
    // 防止高频同步，10秒内只允许一次同步(比如弱网、网络不好情况下会重复重连)
    static MESSAGE_SYNC_LOCK: Lazy<tokio::sync::Mutex<()>> =
        Lazy::new(|| tokio::sync::Mutex::new(()));
    static LAST_MESSAGE_SYNC_MS: AtomicI64 = AtomicI64::new(0);
    const MESSAGE_SYNC_COOLDOWN_MS: i64 = 10_000;

    info!(
        "Checking user initialization status and fetching messages, uid: {}",
        uid
    );

    let now_ms = chrono::Utc::now().timestamp_millis();
    if !force_full {
        let last = LAST_MESSAGE_SYNC_MS.load(Ordering::Relaxed);
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
                if let Err(e) = fetch_all_messages(client, db_conn, uid, async_data).await {
                    error!("Failed to fetch all messages: {}", e);
                    return Err(e);
                }
            } else {
                info!(
                    "User {} incremental/offline message update, async_data: {:?}",
                    uid, async_data
                );
                fetch_all_messages(client, db_conn, uid, async_data)
                    .await
                    .map_err(|e| {
                        error!("Failed to update offline messages: {}", e);
                        e
                    })?;
            }
        }
    }
    LAST_MESSAGE_SYNC_MS.store(now_ms, Ordering::Relaxed);
    drop(guard);
    Ok(())
}

// 获取所有消息并保存到数据库
pub async fn fetch_all_messages(
    client: &mut ImRequestClient,
    db_conn: &DatabaseConnection,
    uid: &str,
    async_data: bool,
) -> Result<(), CommonError> {
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

    persist_token_if_refreshed_direct(&old_tokens, client, db_conn, uid).await;

    if let Some(mut messages) = messages {
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

        // aichatoverview#42: 持久化前先按 client_msg_id 删除本地乐观 temp 行，
        // 防止 sync 后原来的 T... 行复活成重复气泡。
        let client_msg_ids: Vec<String> = messages
            .iter()
            .filter_map(|m| m.message.client_msg_id.clone())
            .filter(|s| !s.is_empty())
            .collect();
        if !client_msg_ids.is_empty() {
            let deleted = im_message_repository::delete_temp_messages_by_client_msg_id(
                db_conn,
                uid,
                &client_msg_ids,
            )
            .await?;
            debug!(
                "fetch_all_messages deleted {} optimistic temp rows by client_msg_id",
                deleted
            );
        }

        // 开启事务
        let tx = db_conn.begin().await?;

        // 转换 MessageResp 为本地存储模型
        let db_messages: Vec<MessageWithThumbnail> = messages
            .into_iter()
            .map(|msg_resp| convert_resp_to_record_for_fetch(msg_resp, uid.to_string()))
            .collect();
        // 保存到本地数据库
        match im_message_repository::save_all(&tx, db_messages).await {
            Ok(_) => {
                info!("Messages saved to database successfully");
            }
            Err(e) => {
                error!(
                    "Failed to save messages to database, detailed error: {:?}",
                    e
                );
                return Err(e.into());
            }
        }

        // 消息保存完成后，将用户的 is_init 状态设置为 false
        im_user_repository::update_user_init_status(&tx, uid, false)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to update user is_init status: {}", e))?;

        // 提交事务
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
) -> Result<(), String> {
    let async_data = param.as_ref().and_then(|p| p.async_data).unwrap_or(true);
    let full_sync = param.as_ref().and_then(|p| p.full_sync).unwrap_or(false);
    let uid = match param.as_ref().and_then(|p| p.uid.clone()) {
        Some(v) if !v.is_empty() => v,
        _ => state.user_info.lock().await.uid.clone(),
    };

    let mut client = state.rc.lock().await;
    check_user_init_and_fetch_messages(
        &mut client,
        &*state.db_conn.read().await,
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
) -> Result<(), String> {
    // 获取当前登录用户信息
    let (login_uid, nickname, current_user_type) = {
        let user_info = state.user_info.lock().await;
        let user_type = ImUserEntity::find()
            .filter(im_user::Column::Id.eq(&user_info.uid))
            .select_only()
            .column(im_user::Column::UserType)
            .into_tuple::<Option<i32>>()
            .one(&*state.db_conn.read().await)
            .await
            .unwrap_or(None)
            .flatten();
        (user_info.uid.clone(), None, user_type) // UserInfo只有uid和token字段，nickname暂时设为None
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

    let write_lock = state.write_lock.clone(); // 克隆全局写锁句柄
    message_record = run_with_write_lock(write_lock, "send_msg", || {
        let db_conn = state.db_conn.clone(); // 克隆数据库连接供异步使用
        let mut record = message_record.clone(); // 拷贝消息记录以便闭包内可变
        async move {
            let db = db_conn.read().await;
            let tx = db.begin().await.map_err(CommonError::DatabaseError)?; // 开启事务
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
    let db_conn = state.db_conn.clone();
    let request_client = state.rc.clone();
    let mut record_for_send = message_record.clone();
    let uid_for_token = login_uid.clone();

    tokio::spawn(async move {
        let old_tokens = capture_token_snapshot_arc(&request_client).await;

        // 发送到后端接口
        let result: Result<Option<MessageResp>, anyhow::Error> = {
            let mut client = request_client.lock().await;
            client
                .im_request(ImUrl::SendMsg, Some(send_data), None::<serde_json::Value>)
                .await
        };

        persist_token_if_refreshed_arc(&old_tokens, &request_client, &db_conn, &uid_for_token)
            .await;

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
            &*db_conn.read().await,
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
pub async fn save_msg(data: MessageResp, state: State<'_, AppData>) -> Result<(), String> {
    // 创建 im_message::Model
    let record = convert_resp_to_record_for_fetch(data, state.user_info.lock().await.uid.clone());

    let lock = state.write_lock.clone();
    run_with_write_lock(lock, "save_msg", || {
        let db_conn = state.db_conn.clone();
        let record = record.clone();
        async move {
            let db = db_conn.read().await;
            let tx = db.begin().await?;
            im_message_repository::save_message(&tx, record).await?;
            tx.commit().await?;
            Ok(())
        }
    })
    .await?;

    Ok(())
}

#[tauri::command]
pub async fn update_message_recall_status(
    message_id: String,
    message_type: u8,
    message_body: String,
    state: State<'_, AppData>,
) -> Result<(), String> {
    let login_uid = state.user_info.lock().await.uid.clone();

    im_message_repository::update_message_recall_status(
        &*state.db_conn.read().await,
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
) -> Result<(), String> {
    let login_uid = state.user_info.lock().await.uid.clone();

    let db = state.db_conn.read().await;
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
) -> Result<u64, String> {
    let login_uid = state.user_info.lock().await.uid.clone();
    let db = state.db_conn.read().await;

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
}
