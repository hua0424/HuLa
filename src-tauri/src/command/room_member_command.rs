use crate::AppData;
use crate::command::token_helper::request_bound;
use crate::pojo::common::{CursorPageParam, CursorPageResp, Page, PageParam};
use crate::repository::im_room_member_repository::update_my_room_info as update_my_room_info_db;
use crate::session::SessionIdentity;
use crate::vo::vo::MyRoomInfoReq;

use entity::{im_room, im_room_member};

use crate::im_request_client::ImUrl;
use crate::repository::im_room_member_repository;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

use tauri::State;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomMemberResponse {
    pub id: String,
    pub room_id: Option<String>,
    pub uid: Option<String>,
    pub account: Option<String>,
    pub my_name: Option<String>,
    pub active_status: Option<u8>,
    #[serde(rename = "roleId")]
    pub group_role: Option<i64>,
    pub loc_place: Option<String>,
    pub last_opt_time: i64,
    pub create_time: Option<i64>,
    pub name: String,
    pub avatar: Option<String>,
    pub user_state_id: Option<String>,
    #[serde(rename = "wearingItemId")]
    pub wearing_item_id: Option<String>,
    #[serde(rename = "itemIds")]
    pub item_ids: Option<Vec<String>>,
    pub linked_gitee: Option<bool>,
    pub linked_github: Option<bool>,
    pub user_type: Option<i64>,
}

#[tauri::command]
pub async fn update_my_room_info(
    my_room_info: MyRoomInfoReq,
    state: State<'_, AppData>,
    binding: SessionIdentity,
) -> Result<(), String> {
    let binding = state.session.capture_identity(&binding)?;
    let response: Option<bool> = request_bound(
        &state.rc,
        &state.session,
        &binding,
        ImUrl::UpdateMyRoomInfo,
        Some(my_room_info.clone()),
        None::<serde_json::Value>,
    )
    .await
    .map_err(|e| e.to_string())?;
    if response != Some(true) {
        return Err("更新房间信息未成功".into());
    }
    let _gate = state.session.commit(&binding).await?;
    let uid = &binding.identity.uid;
    update_my_room_info_db(
        &binding.db,
        &my_room_info.my_name,
        &my_room_info.id,
        uid,
        uid,
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 获取room_id的房间的所有成员列表
#[tauri::command]
pub async fn get_room_members(
    room_id: String,
    state: State<'_, AppData>,
    binding: SessionIdentity,
) -> Result<Vec<RoomMemberResponse>, String> {
    let binding = state.session.capture_identity(&binding)?;
    let mut members = request_bound(
        &state.rc,
        &state.session,
        &binding,
        ImUrl::GroupListMember,
        None::<serde_json::Value>,
        Some(serde_json::json!({"roomId": room_id})),
    )
    .await
    .map_err(|e| e.to_string())?
    .ok_or("房间成员响应为空")?;
    sort_room_members(&mut members);
    Ok(members)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CursorPageRoomMemberParam {
    room_id: String,
    #[serde(flatten)]
    cursor_page_param: CursorPageParam,
}

// 游标分页查询数据
#[tauri::command]
pub async fn cursor_page_room_members(
    param: CursorPageRoomMemberParam,
    state: State<'_, AppData>,
    binding: SessionIdentity,
) -> Result<CursorPageResp<Vec<im_room_member::Model>>, String> {
    let binding = state.session.capture_identity(&binding)?;
    let _gate = state.session.commit(&binding).await?;
    im_room_member_repository::cursor_page_room_members(
        &binding.db,
        param.room_id,
        param.cursor_page_param,
        &binding.identity.uid,
    )
    .await
    .map_err(|e| e.to_string())
}

// 从本地数据库分页查询群房间数据，如果为空则从后端获取
#[tauri::command]
pub async fn page_room(
    page_param: PageParam,
    state: State<'_, AppData>,
    binding: SessionIdentity,
) -> Result<Page<im_room::Model>, String> {
    let binding = state.session.capture_identity(&binding)?;
    request_bound(
        &state.rc,
        &state.session,
        &binding,
        ImUrl::GroupList,
        None::<serde_json::Value>,
        Some(page_param),
    )
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "房间列表响应为空".into())
}

/// 对房间成员列表进行排序：按角色优先，再按在线状态，最后按名称字母序
fn sort_room_members(members: &mut Vec<RoomMemberResponse>) {
    members.sort_by(|a, b| {
        let role_cmp = match (a.group_role, b.group_role) {
            (Some(a_role), Some(b_role)) if a_role != b_role => a_role.cmp(&b_role),
            _ => Ordering::Equal,
        };
        if role_cmp != Ordering::Equal {
            return role_cmp;
        }

        let a_status = a.active_status.unwrap_or(u8::MAX);
        let b_status = b.active_status.unwrap_or(u8::MAX);
        if a_status != b_status {
            return a_status.cmp(&b_status);
        }

        let a_name = a.name.to_lowercase();
        let b_name = b.name.to_lowercase();
        a_name.cmp(&b_name)
    });
}
