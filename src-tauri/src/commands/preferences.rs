use crate::commands::capture::AppState;
use crate::storage::repository::Repository;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

/// Supported platforms with built-in readers (no external tools needed).
const BUILTIN_PLATFORMS: &[&str] = &[
    "mp.weixin.qq.com (微信公众号)",
    "x.com / twitter.com (X/Twitter)",
    "其他网页 (via Jina Reader)",
];

#[derive(Serialize, Deserialize)]
pub struct XReaderStatus {
    pub installed: bool,
    pub supported_platforms: Vec<String>,
    pub install_command: String,
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    let repo = Repository::new(state.db.clone());
    repo.get_all_settings()
        .map_err(|e| format!("获取设置失败: {}", e))
}

#[tauri::command]
pub fn update_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let repo = Repository::new(state.db.clone());
    repo.update_setting(&key, &value)
        .map_err(|e| format!("更新设置失败: {}", e))
}

#[tauri::command]
pub fn check_xreader_status() -> Result<XReaderStatus, String> {
    // Built-in readers — no external Python dependencies needed
    let supported_platforms: Vec<String> =
        BUILTIN_PLATFORMS.iter().map(|s| s.to_string()).collect();

    Ok(XReaderStatus {
        installed: true, // Built-in, always available
        supported_platforms,
        install_command: String::new(),
    })
}
