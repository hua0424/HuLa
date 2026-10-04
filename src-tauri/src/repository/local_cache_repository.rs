use crate::repository::im_message_repository;
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement, TransactionTrait};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingMetadata {
    pub id: String,
    pub aiclaw_uid: String,
    pub trigger_msg_id: String,
    pub status: i32,
    pub duration_ms: Option<i64>,
    pub has_response: Option<i32>,
    pub create_time: String,
    /// aichatoverview#351：服务端正文 ETag；None 表示无从校验，不作无思考证据。
    /// 注意：显式 rename 保持线上 bodyETag（camelCase 会误成 bodyEtag）。
    #[serde(default, rename = "bodyETag")]
    pub body_etag: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedThinking {
    pub metadata: ThinkingMetadata,
    pub room_id: String,
    pub content: Option<String>,
    pub body_loaded: bool,
    // aichatoverview#351：已读正文 ETag 与验证时间；只读缓存不算已验证。
    #[serde(default, rename = "bodyETag")]
    pub body_etag: Option<String>,
    pub body_verified_at: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingCacheWindow {
    pub items: Vec<CachedThinking>,
    pub loaded_trigger_ids: Vec<String>,
    pub visible_trigger_ids: Vec<String>,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.bytes().all(|b| b.is_ascii_digit())
}

fn validate_window(room_id: &str, ids: &[String]) -> Result<(), String> {
    if !valid_id(room_id) || ids.len() > 100 || ids.iter().any(|id| !valid_id(id)) {
        return Err("缓存窗口ID无效或超过100条".into());
    }
    Ok(())
}

/// Message visibility is the deletion/clear boundary for metadata, receipts, and successful bodies.
async fn visible_trigger_ids(
    db: &DatabaseConnection,
    uid: &str,
    room_id: &str,
    ids: &[String],
) -> Result<Vec<String>, String> {
    Ok(
        im_message_repository::find_visible_by_ids(db, ids, room_id, uid)
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|record| record.message.id)
            .collect(),
    )
}

pub async fn read_thinking_window(
    db: &DatabaseConnection,
    uid: &str,
    room_id: &str,
    ids: &[String],
) -> Result<ThinkingCacheWindow, String> {
    validate_window(room_id, ids)?;
    let visible = visible_trigger_ids(db, uid, room_id, ids).await?;
    let mut items = Vec::new();
    let mut loaded_trigger_ids = Vec::new();
    // ponytail: <=100 local triggers per window; use one IN query if measured IPC cost warrants it.
    for id in &visible {
        let rows = db.query_all(Statement::from_sql_and_values(DbBackend::Sqlite,
            "SELECT metadata,room_id,content,body_loaded,body_etag,body_verified_at FROM im_thinking_cache WHERE room_id=? AND trigger_msg_id=?", [room_id.into(), id.clone().into()]))
            .await.map_err(|e| e.to_string())?;
        for row in rows {
            let metadata: String = row.try_get("", "metadata").map_err(|e| e.to_string())?;
            items.push(CachedThinking {
                metadata: serde_json::from_str(&metadata).map_err(|e| e.to_string())?,
                room_id: row.try_get("", "room_id").map_err(|e| e.to_string())?,
                content: row.try_get("", "content").map_err(|e| e.to_string())?,
                body_loaded: row
                    .try_get::<i32>("", "body_loaded")
                    .map_err(|e| e.to_string())?
                    == 1,
                body_etag: row.try_get("", "body_etag").map_err(|e| e.to_string())?,
                body_verified_at: row
                    .try_get("", "body_verified_at")
                    .map_err(|e| e.to_string())?,
            });
        }
        if db.query_one(Statement::from_sql_and_values(DbBackend::Sqlite,
            "SELECT trigger_msg_id FROM im_thinking_receipt WHERE room_id=? AND trigger_msg_id=?", [room_id.into(), id.clone().into()]))
            .await.map_err(|e| e.to_string())?.is_some() {
            loaded_trigger_ids.push(id.clone());
        }
    }
    Ok(ThinkingCacheWindow {
        items,
        loaded_trigger_ids,
        visible_trigger_ids: visible,
    })
}

/// Call only on a successful metadata response (including []). A failed request has no receipt.
pub async fn save_thinking_metadata(
    db: &DatabaseConnection,
    uid: &str,
    room_id: &str,
    trigger_ids: &[String],
    items: &[ThinkingMetadata],
) -> Result<Vec<String>, String> {
    validate_window(room_id, trigger_ids)?;
    if items.len() > 1000
        || items.iter().any(|item| {
            !valid_id(&item.id)
                || !valid_id(&item.aiclaw_uid)
                || !trigger_ids.contains(&item.trigger_msg_id)
                || !(0..=4).contains(&item.status)
        })
    {
        return Err("思考元数据归属或状态无效".into());
    }
    let visible = visible_trigger_ids(db, uid, room_id, trigger_ids).await?;
    let tx = db.begin().await.map_err(|e| e.to_string())?;
    for item in items
        .iter()
        .filter(|item| visible.contains(&item.trigger_msg_id))
    {
        let stored = tx.query_one(Statement::from_sql_and_values(DbBackend::Sqlite,
            "SELECT room_id,trigger_msg_id,aiclaw_uid,raw_status,metadata FROM im_thinking_cache WHERE thinking_id=?", [item.id.clone().into()]))
            .await.map_err(|e| e.to_string())?;
        let mut metadata = item.clone();
        if let Some(row) = stored {
            let room: String = row.try_get("", "room_id").map_err(|e| e.to_string())?;
            let trigger: String = row
                .try_get("", "trigger_msg_id")
                .map_err(|e| e.to_string())?;
            let actor: String = row.try_get("", "aiclaw_uid").map_err(|e| e.to_string())?;
            if room != room_id || trigger != item.trigger_msg_id || actor != item.aiclaw_uid {
                return Err("思考ID归属冲突".into());
            }
            let status: i32 = row.try_get("", "raw_status").map_err(|e| e.to_string())?;
            if status != 0 && item.status == 0 {
                let original: String = row.try_get("", "metadata").map_err(|e| e.to_string())?;
                metadata = serde_json::from_str(&original).map_err(|e| e.to_string())?;
            }
        }
        let payload = serde_json::to_string(&metadata).map_err(|e| e.to_string())?;
        tx.execute(Statement::from_sql_and_values(DbBackend::Sqlite,
            "INSERT INTO im_thinking_cache (thinking_id,room_id,trigger_msg_id,aiclaw_uid,raw_status,metadata) VALUES (?,?,?,?,?,?) ON CONFLICT(thinking_id) DO UPDATE SET raw_status=excluded.raw_status,metadata=excluded.metadata",
            [metadata.id.into(), room_id.into(), metadata.trigger_msg_id.into(), metadata.aiclaw_uid.into(), metadata.status.into(), payload.into()]))
            .await.map_err(|e| e.to_string())?;
        // aichatoverview#351：ETag 差异使当前校验状态失效——保留已读内容，
        // 只清 body_verified_at（入视野再按需重取）；任一端缺 ETag 不判差异。
        if let Some(new_etag) = item.body_etag.as_deref() {
            tx.execute(Statement::from_sql_and_values(DbBackend::Sqlite,
                "UPDATE im_thinking_cache SET body_verified_at=NULL WHERE thinking_id=? AND body_loaded=1 AND body_etag IS NOT NULL AND body_etag<>?",
                [item.id.clone().into(), new_etag.into()]))
                .await.map_err(|e| e.to_string())?;
        }
    }
    for id in &visible {
        tx.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT OR IGNORE INTO im_thinking_receipt (room_id,trigger_msg_id) VALUES (?,?)",
            [room_id.into(), id.clone().into()],
        ))
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(visible)
}

pub async fn save_thinking_body(
    db: &DatabaseConnection,
    uid: &str,
    room_id: &str,
    trigger_msg_id: &str,
    aiclaw_uid: &str,
    thinking_id: &str,
    content: &str,
    body_etag: Option<&str>,
) -> Result<(), String> {
    validate_window(room_id, &[trigger_msg_id.to_owned()])?;
    if !valid_id(thinking_id) || !valid_id(aiclaw_uid) {
        return Err("思考正文ID无效".into());
    }
    if visible_trigger_ids(db, uid, room_id, &[trigger_msg_id.to_owned()])
        .await?
        .is_empty()
    {
        return Err("触发消息已删除或清空，不能恢复思考正文".into());
    }
    // aichatoverview#351：经归属匹配的权威 detail 写入才算本轮已验证，记 ETag 与验证时间；
    // 成功空正文（""）有效，body_loaded=1。
    let verified_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .map_err(|e| e.to_string())?;
    let result = db.execute(Statement::from_sql_and_values(DbBackend::Sqlite,
        "UPDATE im_thinking_cache SET content=?,body_loaded=1,body_etag=?,body_verified_at=? WHERE thinking_id=? AND room_id=? AND trigger_msg_id=? AND aiclaw_uid=?",
        [content.into(), body_etag.into(), verified_at.into(), thinking_id.into(), room_id.into(), trigger_msg_id.into(), aiclaw_uid.into()]))
        .await.map_err(|e| e.to_string())?;
    if result.rows_affected() != 1 {
        return Err("思考正文必须匹配已取得的元数据归属".into());
    }
    Ok(())
}

pub async fn read_snapshot(
    db: &DatabaseConnection,
    name: &str,
) -> Result<Option<serde_json::Value>, String> {
    validate_snapshot_name(name)?;
    let row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT payload FROM im_local_snapshot WHERE name=?",
            [name.into()],
        ))
        .await
        .map_err(|e| e.to_string())?;
    row.map(|row| {
        let payload: String = row.try_get("", "payload").map_err(|e| e.to_string())?;
        serde_json::from_str(&payload).map_err(|e| e.to_string())
    })
    .transpose()
}

pub async fn save_snapshot(
    db: &DatabaseConnection,
    name: &str,
    payload: &serde_json::Value,
) -> Result<(), String> {
    validate_snapshot_name(name)?;
    let payload = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    db.execute(Statement::from_sql_and_values(DbBackend::Sqlite,
        "INSERT INTO im_local_snapshot (name,payload) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET payload=excluded.payload", [name.into(), payload.into()]))
        .await.map_err(|e| e.to_string())?;
    Ok(())
}

fn validate_snapshot_name(name: &str) -> Result<(), String> {
    if !matches!(name, "sessions" | "reading") {
        return Err("未知本地快照类型".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::database_command::prepare_scoped_database;
    use sea_orm::Database;

    async fn setup() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        prepare_scoped_database(&db, "http://a/api", "4")
            .await
            .unwrap();
        db.execute_unprepared("INSERT INTO im_message (id,uid,room_id,login_uid,send_status) VALUES ('10','2','3','4','success'),('11','2','3','4','success')").await.unwrap();
        db
    }
    fn item(id: &str, actor: &str, status: i32) -> ThinkingMetadata {
        ThinkingMetadata {
            id: id.into(),
            aiclaw_uid: actor.into(),
            trigger_msg_id: "10".into(),
            status,
            duration_ms: Some(5),
            has_response: Some(1),
            create_time: "2026-10-02T01:00:00".into(),
            body_etag: None,
        }
    }

    #[tokio::test]
    async fn real_file_reopen_preserves_bodies_snapshots_and_unknown_legacy_bytes() {
        use crate::configuration::scoped_db_filename;
        let fixture = std::env::temp_dir().join(format!("hula-cache-348-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&fixture).unwrap();
        let legacy = fixture.join("db_4.sqlite");
        std::fs::write(&legacy, b"unknown-backend-legacy-file-preserved").unwrap();
        let before = std::fs::read(&legacy).unwrap();
        let path = fixture.join(scoped_db_filename("http://a/api", "4").unwrap());
        let url = format!("sqlite:{}?mode=rwc", path.display());
        let db = Database::connect(&url).await.unwrap();
        prepare_scoped_database(&db, "http://a/api", "4")
            .await
            .unwrap();
        db.execute_unprepared("INSERT INTO im_message (id,uid,room_id,login_uid,send_status) VALUES ('10','2','3','4','success')").await.unwrap();
        save_thinking_metadata(&db, "4", "3", &["10".into()], &[item("100", "20", 1)])
            .await
            .unwrap();
        save_thinking_body(
            &db,
            "4",
            "3",
            "10",
            "20",
            "100",
            "retained fixture body",
            Some("etag-fixture"),
        )
        .await
        .unwrap();
        save_snapshot(&db, "sessions", &serde_json::json!([{ "roomId": "3" }]))
            .await
            .unwrap();
        db.close().await.unwrap();
        let reopened = Database::connect(&url).await.unwrap();
        prepare_scoped_database(&reopened, "http://a/api", "4")
            .await
            .unwrap();
        let window = read_thinking_window(&reopened, "4", "3", &["10".into()])
            .await
            .unwrap();
        assert_eq!(
            window.items[0].content.as_deref(),
            Some("retained fixture body")
        );
        assert!(window.items[0].body_loaded);
        assert_eq!(
            read_snapshot(&reopened, "sessions").await.unwrap().unwrap(),
            serde_json::json!([{ "roomId": "3" }])
        );
        assert_eq!(std::fs::read(&legacy).unwrap(), before);
        assert!(
            prepare_scoped_database(&reopened, "http://b/api", "4")
                .await
                .is_err()
        );
        reopened.close().await.unwrap();
        // Isolated test fixtures are deliberately retained; never clean a user's cache/profile.
    }

    #[tokio::test]
    async fn success_empty_body_empty_metadata_multi_assistant_and_failures_are_distinct() {
        let db = setup().await;
        let ids = vec!["10".into(), "11".into()];
        save_thinking_metadata(
            &db,
            "4",
            "3",
            &ids,
            &[item("100", "20", 4), item("101", "21", 3)],
        )
        .await
        .unwrap();
        let initial = read_thinking_window(&db, "4", "3", &ids).await.unwrap();
        assert_eq!(initial.items.len(), 2);
        assert_eq!(initial.loaded_trigger_ids.len(), 2); // '11' is successful empty metadata.
        assert!(!initial.items[0].body_loaded);
        assert!(
            save_thinking_body(&db, "4", "3", "10", "99", "100", "wrong", None)
                .await
                .is_err()
        );
        save_thinking_body(&db, "4", "3", "10", "20", "100", "", None)
            .await
            .unwrap();
        save_thinking_metadata(&db, "4", "3", &["10".into()], &[item("100", "20", 0)])
            .await
            .unwrap();
        let loaded = read_thinking_window(&db, "4", "3", &ids).await.unwrap();
        let body = loaded
            .items
            .iter()
            .find(|item| item.metadata.id == "100")
            .unwrap();
        assert!(body.body_loaded);
        assert_eq!(body.content.as_deref(), Some(""));
        assert_eq!(body.metadata.status, 4);
        // 经归属匹配的权威写入即本轮已验证（记验证时间）；本次写入未带 ETag，故无 ETag。
        assert!(body.body_etag.is_none() && body.body_verified_at.is_some());
        assert!(
            read_thinking_window(&db, "5", "3", &ids)
                .await
                .unwrap()
                .items
                .is_empty()
        );
        assert!(
            read_thinking_window(&db, "4", "9", &ids)
                .await
                .unwrap()
                .items
                .is_empty()
        );
    }

    #[tokio::test]
    async fn deleted_and_cleared_triggers_never_restore_associated_thinking() {
        let db = setup().await;
        let ids = vec!["10".into()];
        save_thinking_metadata(&db, "4", "3", &ids, &[item("100", "20", 1)])
            .await
            .unwrap();
        im_message_repository::record_deleted_message(&db, "10", "3", "4")
            .await
            .unwrap();
        assert!(
            read_thinking_window(&db, "4", "3", &ids)
                .await
                .unwrap()
                .items
                .is_empty()
        );
        assert!(
            save_thinking_body(&db, "4", "3", "10", "20", "100", "late", None)
                .await
                .is_err()
        );
        save_thinking_metadata(&db, "4", "3", &ids, &[item("102", "21", 1)])
            .await
            .unwrap();
        let rows = db
            .query_all(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT thinking_id FROM im_thinking_cache".to_owned(),
            ))
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        im_message_repository::record_room_clear(&db, "3", "4", Some("11".into()))
            .await
            .unwrap();
        assert!(
            read_thinking_window(&db, "4", "3", &["11".into()])
                .await
                .unwrap()
                .loaded_trigger_ids
                .is_empty()
        );
    }

    #[tokio::test]
    async fn optimistic_reconcile_is_atomic_and_user_deletions_win_over_late_receipts() {
        use entity::im_message;
        use sea_orm::EntityTrait;
        let db = setup().await;
        let model = im_message::Entity::find_by_id(("10".to_owned(), "4".to_owned()))
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        let record = |id: &str| {
            let mut message = model.clone();
            message.id = id.to_owned();
            im_message_repository::MessageWithThumbnail::new(message, None)
        };
        let tx = db.begin().await.unwrap();
        im_message_repository::save_message(&tx, record("T10"))
            .await
            .unwrap();
        tx.commit().await.unwrap();
        im_message_repository::update_message_status(
            &db,
            record("T10"),
            "success",
            Some("12".into()),
            "4".into(),
        )
        .await
        .unwrap();
        assert!(
            im_message::Entity::find_by_id(("T10".to_owned(), "4".to_owned()))
                .one(&db)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            im_message::Entity::find_by_id(("12".to_owned(), "4".to_owned()))
                .one(&db)
                .await
                .unwrap()
                .is_some()
        );
        assert!(
            db.query_one(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT id FROM im_deleted_message WHERE id='T10'".to_owned()
            ))
            .await
            .unwrap()
            .is_none()
        );
        // Idempotent HTTP confirmation after a WS collapse is allowed, unlike a user deletion.
        im_message_repository::update_message_status(
            &db,
            record("T10"),
            "success",
            Some("12".into()),
            "4".into(),
        )
        .await
        .unwrap();
        im_message_repository::record_deleted_message(&db, "T11", "3", "4")
            .await
            .unwrap();
        assert!(
            im_message_repository::update_message_status(
                &db,
                record("T11"),
                "success",
                Some("13".into()),
                "4".into()
            )
            .await
            .is_err()
        );
        assert!(
            im_message::Entity::find_by_id(("13".to_owned(), "4".to_owned()))
                .one(&db)
                .await
                .unwrap()
                .is_none()
        );
        // Learning the official ID transfers the boundary, so ordinary history cannot resurrect it.
        let tx = db.begin().await.unwrap();
        im_message_repository::save_message(&tx, record("13"))
            .await
            .unwrap();
        tx.commit().await.unwrap();
        assert!(
            im_message::Entity::find_by_id(("13".to_owned(), "4".to_owned()))
                .one(&db)
                .await
                .unwrap()
                .is_none()
        );
        im_message_repository::record_deleted_message(&db, "14", "3", "4")
            .await
            .unwrap();
        assert!(
            im_message_repository::update_message_status(
                &db,
                record("T12"),
                "success",
                Some("14".into()),
                "4".into()
            )
            .await
            .is_err()
        );
        im_message_repository::record_room_clear(&db, "3", "4", Some("20".into()))
            .await
            .unwrap();
        assert!(
            im_message_repository::update_message_status(
                &db,
                record("T13"),
                "success",
                Some("15".into()),
                "4".into()
            )
            .await
            .is_err()
        );
    }

    #[tokio::test]
    async fn metadata_ownership_conflict_rolls_back_receipts_and_preserves_success_body() {
        let db = setup().await;
        let ids = vec!["10".into()];
        save_thinking_metadata(&db, "4", "3", &ids, &[item("100", "20", 1)])
            .await
            .unwrap();
        save_thinking_body(
            &db,
            "4",
            "3",
            "10",
            "20",
            "100",
            "cached",
            Some("etag-cached"),
        )
        .await
        .unwrap();
        assert!(
            save_thinking_metadata(&db, "4", "3", &ids, &[item("100", "99", 1)])
                .await
                .is_err()
        );
        let loaded = read_thinking_window(&db, "4", "3", &ids).await.unwrap();
        assert_eq!(loaded.items[0].content.as_deref(), Some("cached"));
        assert_eq!(loaded.items[0].metadata.aiclaw_uid, "20");
        save_snapshot(&db, "sessions", &serde_json::json!([{ "roomId": "3" }]))
            .await
            .unwrap();
        assert_eq!(
            read_snapshot(&db, "sessions").await.unwrap().unwrap(),
            serde_json::json!([{ "roomId": "3" }])
        );
    }

    #[tokio::test]
    async fn etag_mismatch_invalidates_verification_but_keeps_read_body() {
        let db = setup().await;
        let ids = vec!["10".into()];
        let mut meta = item("100", "20", 1);
        meta.body_etag = Some("etag-a".into());
        save_thinking_metadata(&db, "4", "3", &ids, &[meta])
            .await
            .unwrap();
        save_thinking_body(
            &db,
            "4",
            "3",
            "10",
            "20",
            "100",
            "cached body",
            Some("etag-a"),
        )
        .await
        .unwrap();
        let loaded = read_thinking_window(&db, "4", "3", &ids).await.unwrap();
        assert!(loaded.items[0].body_loaded);
        assert!(loaded.items[0].body_verified_at.is_some());
        assert_eq!(loaded.items[0].body_etag.as_deref(), Some("etag-a"));
        // 同一正文 ETag 不变：仍已验证。
        let mut same = item("100", "20", 1);
        same.body_etag = Some("etag-a".into());
        save_thinking_metadata(&db, "4", "3", &ids, &[same])
            .await
            .unwrap();
        let reloaded = read_thinking_window(&db, "4", "3", &ids).await.unwrap();
        assert!(reloaded.items[0].body_verified_at.is_some());
        // ETag 差异：当前校验状态失效，已读内容保留、不假已验证。
        let mut changed = item("100", "20", 1);
        changed.body_etag = Some("etag-b".into());
        save_thinking_metadata(&db, "4", "3", &ids, &[changed])
            .await
            .unwrap();
        let stale = read_thinking_window(&db, "4", "3", &ids).await.unwrap();
        assert!(stale.items[0].body_verified_at.is_none());
        assert!(stale.items[0].body_loaded);
        assert_eq!(stale.items[0].content.as_deref(), Some("cached body"));
    }
}
