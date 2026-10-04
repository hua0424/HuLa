use crate::AppData;
use crate::session::{SessionBinding, SessionIdentity, normalize_backend_key};
use migration::{Migrator, MigratorTrait};
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement, TransactionTrait};
use tauri::{AppHandle, State};

/// Check full ownership, not just the filename hash. Never migrate an unknown legacy UID file.
pub async fn prepare_scoped_database(
    db: &DatabaseConnection,
    backend_key: &str,
    uid: &str,
) -> Result<(), String> {
    let exists = db
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT name FROM sqlite_master WHERE type='table' AND name='im_cache_scope'"
                .to_owned(),
        ))
        .await
        .map_err(|e| e.to_string())?
        .is_some();
    if exists {
        if let Some(row) = db
            .query_one(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT backend_key, uid FROM im_cache_scope WHERE id=1".to_owned(),
            ))
            .await
            .map_err(|e| e.to_string())?
        {
            let stored_backend: String =
                row.try_get("", "backend_key").map_err(|e| e.to_string())?;
            let stored_uid: String = row.try_get("", "uid").map_err(|e| e.to_string())?;
            if stored_backend != backend_key || stored_uid != uid {
                return Err("缓存数据库归属冲突，原文件保留".into());
            }
        }
    }
    // Failure is not a warning/success. No connection is published until all migrations finish.
    Migrator::up(db, None)
        .await
        .map_err(|e| format!("缓存迁移失败，数据保留: {e}"))?;
    let tx = db.begin().await.map_err(|e| e.to_string())?;
    tx.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "INSERT OR IGNORE INTO im_cache_scope (id,backend_key,uid) VALUES (1,?,?)",
        [backend_key.into(), uid.into()],
    ))
    .await
    .map_err(|e| e.to_string())?;
    let owner = tx
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT backend_key, uid FROM im_cache_scope WHERE id=1".to_owned(),
        ))
        .await
        .map_err(|e| e.to_string())?
        .ok_or("缓存数据库缺少归属")?;
    let stored_backend: String = owner
        .try_get("", "backend_key")
        .map_err(|e| e.to_string())?;
    let stored_uid: String = owner.try_get("", "uid").map_err(|e| e.to_string())?;
    if stored_backend != backend_key || stored_uid != uid {
        return Err("缓存数据库归属冲突，原文件保留".into());
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn bind_user_database(
    state: &AppData,
    app_handle: &AppHandle,
    uid: &str,
    epoch: u64,
) -> Result<SessionBinding, String> {
    if !state.session.is_epoch(epoch) {
        return Err("账号库准备代次已失效".into());
    }
    let configuration = state.config.lock().await.clone();
    let backend_key = normalize_backend_key(&configuration.backend.base_url)?;
    if !state.session.is_epoch(epoch) {
        return Err("账号库准备代次已失效".into());
    }
    let db = configuration
        .database
        .scoped_connection_string(app_handle, &backend_key, uid)
        .await
        .map_err(|e| e.to_string())?;
    let migration_gate = state.session.prepare(epoch).await?;
    prepare_scoped_database(&db, &backend_key, uid).await?;
    drop(migration_gate);
    let binding = state
        .session
        .install(epoch, backend_key, uid.to_owned(), db)
        .await?;
    Ok(binding)
}

#[tauri::command]
pub async fn switch_user_database(
    uid: String,
    state: State<'_, AppData>,
    binding: SessionIdentity,
) -> Result<(), String> {
    // Authentication already selected/migrated the only permitted account database.
    let binding = state.session.capture_identity(&binding)?;
    if binding.identity.uid != uid {
        return Err("只能使用本次已认证账号的数据库".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_session_binding(
    state: State<'_, AppData>,
) -> Result<crate::session::SessionChange, String> {
    Ok(state.session.current_change())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::configuration::scoped_db_filename;
    use crate::session::SessionStore;
    use sea_orm::Database;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    #[tokio::test]
    async fn real_six_migration_upgrade_preserves_messages_and_checks_owner() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, Some(6)).await.unwrap();
        db.execute_unprepared("INSERT INTO im_message (id,uid,room_id,login_uid,send_status) VALUES ('1','2','3','4','success')").await.unwrap();
        prepare_scoped_database(&db, "http://a/api", "4")
            .await
            .unwrap();
        prepare_scoped_database(&db, "http://a/api", "4")
            .await
            .unwrap();
        assert!(
            prepare_scoped_database(&db, "http://b/api", "4")
                .await
                .is_err()
        );
        assert!(
            prepare_scoped_database(&db, "http://a/api", "5")
                .await
                .is_err()
        );
        let rows = db
            .query_all(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT id FROM im_message".to_owned(),
            ))
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        let rows = db
            .query_all(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT version FROM seaql_migrations".to_owned(),
            ))
            .await
            .unwrap();
        assert_eq!(rows.len(), 7);
    }

    #[tokio::test]
    async fn failed_migration_preserves_old_data_and_cannot_publish_a_binding() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, Some(6)).await.unwrap();
        db.execute_unprepared("INSERT INTO im_message (id,uid,room_id,login_uid,send_status) VALUES ('1','2','3','4','success')").await.unwrap();
        // Isolated local fixture, not shared environment fault injection.
        db.execute_unprepared("CREATE TABLE im_thinking_cache (conflicting TEXT)")
            .await
            .unwrap();
        let sessions = SessionStore::new(Arc::new(Mutex::new(())));
        sessions.invalidate().await;
        assert!(
            prepare_scoped_database(&db, "http://a/api", "4")
                .await
                .is_err()
        );
        assert!(sessions.capture().is_err());
        let rows = db
            .query_all(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT id FROM im_message".to_owned(),
            ))
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        let rows = db
            .query_all(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT version FROM seaql_migrations".to_owned(),
            ))
            .await
            .unwrap();
        assert_eq!(rows.len(), 6);
        let partial = db
            .query_one(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT name FROM sqlite_master WHERE name='im_cache_scope'".to_owned(),
            ))
            .await
            .unwrap();
        assert!(
            partial.is_none(),
            "failed DDL must roll back all newly added cache tables"
        );
        db.execute_unprepared("DROP TABLE im_thinking_cache")
            .await
            .unwrap();
        prepare_scoped_database(&db, "http://a/api", "4")
            .await
            .unwrap();
    }

    #[test]
    fn legacy_uid_file_is_never_the_scoped_target() {
        let a = scoped_db_filename("http://a/api", "4").unwrap();
        assert_ne!(a, "db_4.sqlite");
        assert_ne!(a, scoped_db_filename("http://b/api", "4").unwrap());
        assert_ne!(a, scoped_db_filename("http://a/api", "5").unwrap());
        assert!(scoped_db_filename("http://a/api", "../4").is_err());
    }
}
