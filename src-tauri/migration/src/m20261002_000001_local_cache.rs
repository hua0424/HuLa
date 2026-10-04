use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::TransactionTrait;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection().begin().await?;
        db.execute_unprepared("CREATE TABLE im_cache_scope (id INTEGER PRIMARY KEY CHECK(id = 1), backend_key TEXT NOT NULL, uid TEXT NOT NULL)").await?;
        db.execute_unprepared("CREATE TABLE im_thinking_cache (thinking_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, trigger_msg_id TEXT NOT NULL, aiclaw_uid TEXT NOT NULL, raw_status INTEGER NOT NULL CHECK(raw_status BETWEEN 0 AND 4), metadata TEXT NOT NULL, content TEXT, body_loaded INTEGER NOT NULL DEFAULT 0 CHECK(body_loaded IN (0,1)), body_etag TEXT, body_verified_at INTEGER)").await?;
        db.execute_unprepared(
            "CREATE INDEX idx_thinking_trigger ON im_thinking_cache (room_id, trigger_msg_id)",
        )
        .await?;
        db.execute_unprepared("CREATE TABLE im_thinking_receipt (room_id TEXT NOT NULL, trigger_msg_id TEXT NOT NULL, PRIMARY KEY(room_id, trigger_msg_id))").await?;
        db.execute_unprepared(
            "CREATE TABLE im_local_snapshot (name TEXT PRIMARY KEY, payload TEXT NOT NULL)",
        )
        .await?;
        db.commit().await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        for table in [
            "im_local_snapshot",
            "im_thinking_receipt",
            "im_thinking_cache",
            "im_cache_scope",
        ] {
            db.execute_unprepared(&format!("DROP TABLE {table}"))
                .await?;
        }
        Ok(())
    }
}
