//! Account ownership is captured before IO; identity changes and commits share one short gate.
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};
use tokio::sync::{Mutex, OwnedMutexGuard};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionIdentity {
    pub backend_key: String,
    pub uid: String,
    pub session_epoch: u64,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionChange {
    pub session_epoch: u64,
    pub binding: Option<SessionIdentity>,
}

#[derive(Clone, Debug)]
pub struct SessionBinding {
    pub identity: SessionIdentity,
    pub db: DatabaseConnection,
}

#[derive(Debug, Default)]
struct Slot {
    epoch: u64,
    binding: Option<SessionBinding>,
}

#[derive(Debug)]
pub struct SessionStore {
    gate: Arc<Mutex<()>>,
    slot: RwLock<Slot>,
    changes: tokio::sync::watch::Sender<SessionChange>,
}

impl SessionStore {
    pub fn new(gate: Arc<Mutex<()>>) -> Self {
        Self {
            gate,
            slot: RwLock::new(Slot::default()),
            changes: tokio::sync::watch::channel(SessionChange::default()).0,
        }
    }

    /// Also invalidates same-UID relogin and requests already holding the old database.
    pub async fn invalidate(&self) -> u64 {
        let _gate = self.gate.lock().await;
        let mut slot = self.slot.write().expect("session slot poisoned");
        slot.epoch = slot.epoch.checked_add(1).expect("session epoch exhausted");
        slot.binding = None;
        self.changes.send_replace(SessionChange {
            session_epoch: slot.epoch,
            binding: None,
        });
        slot.epoch
    }

    pub async fn invalidate_identity(&self, identity: &SessionIdentity) -> Result<u64, String> {
        let _gate = self.gate.lock().await;
        let mut slot = self.slot.write().expect("session slot poisoned");
        if slot.binding.as_ref().map(|binding| &binding.identity) != Some(identity) {
            return Err("拒绝旧账号任务失效新登录".into());
        }
        slot.epoch = slot.epoch.checked_add(1).expect("session epoch exhausted");
        slot.binding = None;
        self.changes.send_replace(SessionChange {
            session_epoch: slot.epoch,
            binding: None,
        });
        Ok(slot.epoch)
    }

    /// Only publish after successful migrations. A superseded login cannot publish its database.
    pub async fn install(
        &self,
        epoch: u64,
        backend_key: String,
        uid: String,
        db: DatabaseConnection,
    ) -> Result<SessionBinding, String> {
        let _gate = self.gate.lock().await;
        if self.slot.read().expect("session slot poisoned").epoch != epoch {
            return Err("登录代次已失效".into());
        }
        let binding = SessionBinding {
            identity: SessionIdentity {
                backend_key,
                uid,
                session_epoch: epoch,
            },
            db,
        };
        self.slot.write().expect("session slot poisoned").binding = Some(binding.clone());
        self.changes.send_replace(SessionChange {
            session_epoch: epoch,
            binding: Some(binding.identity.clone()),
        });
        Ok(binding)
    }

    pub fn subscribe(&self) -> tokio::sync::watch::Receiver<SessionChange> {
        self.changes.subscribe()
    }

    pub fn current_change(&self) -> SessionChange {
        let slot = self.slot.read().expect("session slot poisoned");
        SessionChange {
            session_epoch: slot.epoch,
            binding: slot
                .binding
                .as_ref()
                .map(|binding| binding.identity.clone()),
        }
    }

    pub fn epoch(&self) -> u64 {
        self.slot.read().expect("session slot poisoned").epoch
    }

    pub async fn prepare(&self, epoch: u64) -> Result<OwnedMutexGuard<()>, String> {
        let guard = self.gate.clone().lock_owned().await;
        if !self.is_epoch(epoch) {
            return Err("数据库准备代次已失效".into());
        }
        Ok(guard)
    }

    pub fn is_epoch(&self, epoch: u64) -> bool {
        self.slot.read().expect("session slot poisoned").epoch == epoch
    }

    pub fn capture(&self) -> Result<SessionBinding, String> {
        self.slot
            .read()
            .expect("session slot poisoned")
            .binding
            .clone()
            .ok_or_else(|| "尚未绑定已认证账号数据库".into())
    }

    pub fn is_current(&self, binding: &SessionBinding) -> bool {
        self.slot
            .read()
            .expect("session slot poisoned")
            .binding
            .as_ref()
            .is_some_and(|current| current.identity == binding.identity)
    }

    /// Never hold this guard across HTTP/WS awaits. Keep it until SQLite commit/UI publication.
    pub async fn commit(&self, binding: &SessionBinding) -> Result<OwnedMutexGuard<()>, String> {
        let guard = self.gate.clone().lock_owned().await;
        if !self.is_current(binding) {
            return Err("登录代次已失效，丢弃旧任务".into());
        }
        Ok(guard)
    }

    pub fn capture_identity(&self, identity: &SessionIdentity) -> Result<SessionBinding, String> {
        let binding = self.capture()?;
        if &binding.identity != identity {
            return Err("账号或后端归属已失效".into());
        }
        Ok(binding)
    }
}

/// Only standard URL equivalences; internal/public hosts never get guessed to be aliases.
pub fn normalize_backend_key(base_url: &str) -> Result<String, String> {
    let mut url = url::Url::parse(base_url).map_err(|_| "后端URL无效")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("后端URL必须是无凭据/查询/片段的HTTP API地址".into());
    }
    let path = url.path().trim_end_matches('/').to_string();
    url.set_path(if path.is_empty() { "/" } else { &path });
    Ok(url.to_string().trim_end_matches('/').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};

    #[test]
    fn only_standard_backend_equivalences() {
        assert_eq!(
            normalize_backend_key("HTTP://EXAMPLE.COM:80/api/").unwrap(),
            "http://example.com/api"
        );
        assert_ne!(
            normalize_backend_key("http://example.com/api").unwrap(),
            normalize_backend_key("http://example.com/api/v2").unwrap()
        );
        assert_ne!(
            normalize_backend_key("http://192.168.8.83/api").unwrap(),
            normalize_backend_key("https://example.com/api").unwrap()
        );
        assert!(normalize_backend_key("http://user:secret@example.com/api").is_err());
        assert!(normalize_backend_key("file:///tmp/db").is_err());
    }

    #[tokio::test]
    async fn captured_database_and_epoch_survive_neither_relogin_nor_logout() {
        let store = SessionStore::new(Arc::new(Mutex::new(())));
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute(Statement::from_string(
            DbBackend::Sqlite,
            "CREATE TABLE receipt (id TEXT)".to_owned(),
        ))
        .await
        .unwrap();
        let epoch = store.invalidate().await;
        let old = store
            .install(epoch, "http://a/api".into(), "1".into(), db.clone())
            .await
            .unwrap();
        let epoch = store.invalidate().await;
        let current = store
            .install(epoch, "http://a/api".into(), "1".into(), db.clone())
            .await
            .unwrap();
        assert!(store.commit(&old).await.is_err());
        assert!(store.capture_identity(&old.identity).is_err());
        let guard = store.commit(&current).await.unwrap();
        current
            .db
            .execute(Statement::from_string(
                DbBackend::Sqlite,
                "INSERT INTO receipt VALUES ('current')".to_owned(),
            ))
            .await
            .unwrap();
        drop(guard);
        store.invalidate().await;
        assert!(store.commit(&current).await.is_err());
        assert!(store.capture().is_err());
        let rows = db
            .query_all(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT id FROM receipt".to_owned(),
            ))
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[tokio::test]
    async fn identity_change_waits_for_short_commit_not_for_request_io() {
        let store = Arc::new(SessionStore::new(Arc::new(Mutex::new(()))));
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let epoch = store.invalidate().await;
        let old = store
            .install(epoch, "http://a/api".into(), "1".into(), db.clone())
            .await
            .unwrap();
        let guard = store.commit(&old).await.unwrap();
        let task = tokio::spawn({
            let store = store.clone();
            async move { store.invalidate().await }
        });
        tokio::task::yield_now().await;
        assert!(!task.is_finished());
        drop(guard);
        let epoch = task.await.unwrap();
        let new = store
            .install(epoch, "http://b/api".into(), "1".into(), db)
            .await
            .unwrap();
        assert!(!store.is_current(&old));
        assert!(store.is_current(&new));
        assert!(
            store
                .install(epoch - 1, "http://a/api".into(), "2".into(), old.db)
                .await
                .is_err()
        );
    }
}
