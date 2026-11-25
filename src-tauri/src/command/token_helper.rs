use crate::error::CommonError;
use crate::im_request_client::{ImRequestClient, ImUrl};
use crate::repository::im_user_repository;
use crate::session::{SessionBinding, SessionStore};
use tokio::sync::Mutex;

#[derive(Clone, Debug)]
pub struct TokenSnapshot {
    pub token: Option<String>,
    pub refresh_token: Option<String>,
}

pub fn capture_token_snapshot_direct(client: &ImRequestClient) -> TokenSnapshot {
    TokenSnapshot {
        token: client.token.clone(),
        refresh_token: client.refresh_token.clone(),
    }
}

/// Persist only tokens captured from this request, under the same account commit gate.
pub async fn persist_captured_tokens(
    old: &TokenSnapshot,
    new: &TokenSnapshot,
    binding: &SessionBinding,
    sessions: &SessionStore,
) -> Result<(), String> {
    if old.token != new.token || old.refresh_token != new.refresh_token {
        let _gate = sessions.commit(binding).await?;
        if let (Some(token), Some(refresh)) = (&new.token, &new.refresh_token) {
            im_user_repository::save_user_tokens(
                &binding.db,
                &binding.identity.uid,
                token,
                refresh,
            )
            .await
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// All authenticated native HTTP callers share the before-request and after-IO ownership boundary.
pub async fn request_bound<
    T: serde::de::DeserializeOwned,
    B: serde::Serialize,
    P: serde::Serialize,
>(
    client: &Mutex<ImRequestClient>,
    sessions: &SessionStore,
    binding: &SessionBinding,
    url: ImUrl,
    body: Option<B>,
    params: Option<P>,
) -> Result<Option<T>, CommonError> {
    let (result, old, new) = {
        let mut client = client.lock().await;
        if !sessions.is_current(binding) {
            return Err(CommonError::RequestError("HTTP请求账号代次已失效".into()));
        }
        let old = capture_token_snapshot_direct(&client);
        let result = client.im_request(url, body, params).await;
        (result, old, capture_token_snapshot_direct(&client))
    };
    persist_captured_tokens(&old, &new, binding, sessions)
        .await
        .map_err(CommonError::RequestError)?;
    let _gate = sessions
        .commit(binding)
        .await
        .map_err(CommonError::RequestError)?;
    result.map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::Database;
    use std::io::{Read, Write};
    use std::sync::Arc;

    #[tokio::test]
    async fn real_delayed_http_history_send_and_contact_responses_cannot_cross_session_commits() {
        // Only local synthetic sockets/SQLite fixtures; never login or inject faults on the shared test host.
        for (route, replacement) in [
            (ImUrl::GetMsgPage, None),
            (ImUrl::GetMsgPage, Some((false, "4"))), // same-UID relogin
            (ImUrl::SendMsg, Some((true, "4"))),     // backend change
            (ImUrl::GetContactList, Some((false, "5"))), // account change
        ] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            let (received_tx, received_rx) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = std::sync::mpsc::channel();
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut request = Vec::new();
                let mut bytes = [0; 4096];
                while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                    let size = stream.read(&mut bytes).unwrap();
                    if size == 0 {
                        return;
                    }
                    request.extend_from_slice(&bytes[..size]);
                }
                received_tx.send(()).unwrap();
                if release_rx.recv().is_ok() {
                    let body = r#"{"success":true,"code":200,"data":{"marker":"old"}}"#;
                    write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
                }
            });
            let sessions = Arc::new(SessionStore::new(Arc::new(Mutex::new(()))));
            let old_db = Database::connect("sqlite::memory:").await.unwrap();
            let new_db = Database::connect("sqlite::memory:").await.unwrap();
            let epoch = sessions.invalidate().await;
            let old = sessions
                .install(epoch, base.clone(), "4".into(), old_db.clone())
                .await
                .unwrap();
            let client = Arc::new(Mutex::new(ImRequestClient::new(base.clone()).unwrap()));
            client.lock().await.token = Some("synthetic-fixture-token".into());
            let task = tokio::spawn({
                let sessions = sessions.clone();
                let old = old.clone();
                let client = client.clone();
                async move {
                    request_bound::<serde_json::Value, _, _>(
                        &client,
                        &sessions,
                        &old,
                        route,
                        None::<serde_json::Value>,
                        None::<serde_json::Value>,
                    )
                    .await
                }
            });
            tokio::time::timeout(std::time::Duration::from_secs(5), received_rx)
                .await
                .unwrap()
                .unwrap();
            if let Some((change_backend, uid)) = replacement {
                let epoch =
                    tokio::time::timeout(std::time::Duration::from_secs(1), sessions.invalidate())
                        .await
                        .unwrap();
                let key = if change_backend {
                    "http://other-fixture.invalid".to_owned()
                } else {
                    base
                };
                let current = sessions
                    .install(epoch, key, uid.into(), new_db)
                    .await
                    .unwrap();
                assert!(sessions.invalidate_identity(&old.identity).await.is_err());
                assert!(sessions.is_current(&current));
            }
            release_tx.send(()).unwrap();
            let result = tokio::time::timeout(std::time::Duration::from_secs(5), task)
                .await
                .unwrap()
                .unwrap();
            server.join().unwrap();
            if replacement.is_none() {
                assert_eq!(result.unwrap(), Some(serde_json::json!({"marker": "old"})));
            } else {
                assert!(matches!(
                    result,
                    Err(CommonError::RequestError(message)) if message == "登录代次已失效，丢弃旧任务"
                ));
            }
        }
    }
}
