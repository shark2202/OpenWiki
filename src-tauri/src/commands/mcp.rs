use crate::commands::capture::AppState;
use crate::storage::models::CapturedContent;
use crate::storage::repository::Repository;
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

/// Fallback preview when AI summary is not available.
fn fallback_preview(item: &CapturedContent) -> String {
    if let Some(ref url) = item.source_url {
        if !url.is_empty() {
            return url.clone();
        }
    }
    if let Some(ref text) = item.raw_text {
        if !text.is_empty() {
            let preview: String = text.chars().take(80).collect();
            return preview.replace('\n', " ");
        }
    }
    "[图片]".to_string()
}

// ─── MCP Integration ──────────────────────────────────────────────
//
//  Data flow:
//
//  User clicks [连接 Claude Desktop]
//       │
//       ├─ check_node_installed()  → which node
//       ├─ get_mcp_status()        → read config file, check for "xiaoyun" key
//       ├─ connect_mcp()           → backup + inject + write config
//       └─ disconnect_mcp()        → read + remove "xiaoyun" key + write
//
//  Config file: ~/Library/Application Support/Claude/claude_desktop_config.json

const MCP_SERVER_KEY: &str = "xiaoyun";

#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpTarget {
    Claude,
    Openclaw,
}

impl McpTarget {
    fn config_path(&self) -> Option<PathBuf> {
        match self {
            McpTarget::Claude => {
                let base = dirs::data_dir().or_else(|| {
                    dirs::home_dir().map(|h| h.join("Library").join("Application Support"))
                })?;
                Some(base.join("Claude").join("claude_desktop_config.json"))
            }
            McpTarget::Openclaw => {
                let home = dirs::home_dir()?;
                Some(home.join(".openclaw").join("openclaw.json"))
            }
        }
    }

    fn display_name(&self) -> &str {
        match self {
            McpTarget::Claude => "Claude Desktop",
            McpTarget::Openclaw => "OpenClaw",
        }
    }

    fn process_name(&self) -> &str {
        match self {
            McpTarget::Claude => "Claude",
            McpTarget::Openclaw => "openclaw",
        }
    }
}

#[derive(Serialize)]
pub struct McpStatus {
    pub connected: bool,
    pub installed: bool,
    pub node_installed: bool,
    pub config_path: Option<String>,
}

/// Get the absolute path to xiaoyun's SQLite database.
fn xiaoyun_db_path() -> Option<String> {
    let base = dirs::data_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Library").join("Application Support")))?;
    let db_path = base.join("com.xiaoyun.app").join("xiaoyun.db");
    Some(db_path.to_string_lossy().to_string())
}

/// Check if Node.js is installed.
/// Checks common paths because Tauri apps launched from Dock don't inherit shell PATH.
fn is_node_installed() -> bool {
    // First try PATH (works when launched from terminal)
    if std::process::Command::new("which")
        .arg("node")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return true;
    }
    // Check common macOS Node.js locations
    let common_paths = [
        "/usr/local/bin/node",
        "/opt/homebrew/bin/node",
        "/usr/bin/node",
    ];
    for path in &common_paths {
        if std::path::Path::new(path).exists() {
            return true;
        }
    }
    // Check nvm
    if let Some(home) = dirs::home_dir() {
        let nvm_node = home.join(".nvm/versions/node");
        if nvm_node.exists() {
            return true;
        }
    }
    false
}

/// Find the absolute path to npx for writing into MCP config.
fn find_npx_path() -> Option<String> {
    let common_paths = [
        "/usr/local/bin/npx",
        "/opt/homebrew/bin/npx",
        "/usr/bin/npx",
    ];
    for path in &common_paths {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    // Check nvm current version
    if let Some(home) = dirs::home_dir() {
        let nvm_dir = home.join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            // Get the latest version directory
            let mut versions: Vec<_> = entries.filter_map(|e| e.ok()).collect();
            versions.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
            if let Some(latest) = versions.first() {
                let npx = latest.path().join("bin/npx");
                if npx.exists() {
                    return Some(npx.to_string_lossy().to_string());
                }
            }
        }
    }
    None
}

/// Check if a process is running by name.
fn is_process_running(name: &str) -> bool {
    std::process::Command::new("pgrep")
        .args(["-xi", name])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Read and parse the Claude Desktop config file.
fn read_config(path: &PathBuf) -> Result<serde_json::Value, String> {
    let content = std::fs::read_to_string(path).map_err(|e| format!("无法读取配置文件: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("配置文件格式错误 (JSON 无效): {}", e))
}

/// Write the config back to file.
fn write_config(path: &PathBuf, config: &serde_json::Value) -> Result<(), String> {
    let content =
        serde_json::to_string_pretty(config).map_err(|e| format!("JSON 序列化失败: {}", e))?;
    std::fs::write(path, content).map_err(|e| format!("无法写入配置文件: {}", e))
}

/// Create a timestamped backup of the config file.
fn backup_config(path: &PathBuf) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let backup_path = path.with_extension(format!("json.bak.{}", timestamp));
    std::fs::copy(path, &backup_path).map_err(|e| format!("备份失败: {}", e))?;
    log::info!("Config backed up to {:?}", backup_path);
    Ok(())
}

#[tauri::command]
pub async fn get_mcp_status(target: McpTarget) -> Result<McpStatus, String> {
    let config_path = target.config_path();
    let installed = config_path
        .as_ref()
        .map(|p| p.parent().map(|d| d.exists()).unwrap_or(false))
        .unwrap_or(false);
    let node_installed = is_node_installed();

    let connected = if let Some(ref path) = config_path {
        if path.exists() {
            read_config(path)
                .ok()
                .and_then(|c| c.get("mcpServers")?.get(MCP_SERVER_KEY).cloned())
                .is_some()
        } else {
            false
        }
    } else {
        false
    };

    Ok(McpStatus {
        connected,
        installed,
        node_installed,
        config_path: config_path.map(|p| p.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub async fn connect_mcp(target: McpTarget) -> Result<String, String> {
    let name = target.display_name();

    // 1. Check Node.js
    if !is_node_installed() {
        return Err("需要安装 Node.js。请前往 https://nodejs.org 下载安装。".to_string());
    }

    // 2. Check config directory
    let config_path = target
        .config_path()
        .ok_or(format!("无法确定 {} 配置路径", name))?;
    let config_dir = config_path
        .parent()
        .ok_or(format!("无法确定 {} 配置目录", name))?;

    if !config_dir.exists() {
        // For OpenClaw, create the directory if it doesn't exist
        if target == McpTarget::Openclaw {
            std::fs::create_dir_all(config_dir)
                .map_err(|e| format!("无法创建 OpenClaw 配置目录: {}", e))?;
        } else {
            return Err(format!("{} 未安装。请先安装 {}。", name, name));
        }
    }

    // 3. Get absolute db path
    let db_path = xiaoyun_db_path().ok_or("无法确定 OpenWiki 数据库路径")?;

    // 4. Read or create config
    let mut config = if config_path.exists() {
        // Backup first
        backup_config(&config_path)?;
        let c = read_config(&config_path)?;
        if !c.is_object() {
            return Err("配置文件格式错误：不是有效的 JSON 对象".to_string());
        }
        c
    } else {
        serde_json::json!({})
    };

    // 5. Inject xiaoyun MCP entry
    let mcp_servers = config
        .as_object_mut()
        .ok_or("配置不是 JSON 对象")?
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));

    if !mcp_servers.is_object() {
        *mcp_servers = serde_json::json!({});
    }

    // Find npx absolute path for reliable execution
    let npx_path = find_npx_path().unwrap_or_else(|| "npx".to_string());

    mcp_servers.as_object_mut().unwrap().insert(
        MCP_SERVER_KEY.to_string(),
        serde_json::json!({
            "command": npx_path,
            "args": [
                "-y",
                "mcp-server-sqlite-npx",
                db_path
            ]
        }),
    );

    // 6. Write back
    write_config(&config_path, &config)?;

    // 7. Check if the target app is running
    let msg = if is_process_running(target.process_name()) {
        format!("连接成功！请退出并重新打开 {} 生效。", name)
    } else {
        format!("连接成功！下次打开 {} 即可使用。", name)
    };

    log::info!("MCP connected: xiaoyun entry added to {} config", name);
    Ok(msg)
}

#[tauri::command]
pub async fn disconnect_mcp(target: McpTarget) -> Result<(), String> {
    let config_path = target
        .config_path()
        .ok_or(format!("无法确定 {} 配置路径", target.display_name()))?;

    if !config_path.exists() {
        return Ok(()); // Nothing to disconnect
    }

    let mut config = read_config(&config_path)?;

    // Surgically remove only the xiaoyun entry
    if let Some(servers) = config.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
        if servers.remove(MCP_SERVER_KEY).is_some() {
            backup_config(&config_path)?;
            write_config(&config_path, &config)?;
            log::info!("MCP disconnected: xiaoyun entry removed");
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn copy_content_summary(state: State<'_, AppState>) -> Result<(), String> {
    let repo = Repository::new(state.db.clone());

    // Get last 7 days of content
    let now = chrono::Local::now();
    let week_ago = now - chrono::Duration::days(7);
    let contents = repo
        .get_content_for_week(
            &week_ago.format("%Y-%m-%dT00:00:00").to_string(),
            &now.format("%Y-%m-%dT23:59:59").to_string(),
        )
        .map_err(|e| e.to_string())?;

    let text = if contents.is_empty() {
        "最近 7 天没有保存的内容。".to_string()
    } else {
        let total = contents.len();
        let mut lines = Vec::new();
        lines.push(format!(
            "以下是我最近 7 天保存的内容（共 {} 条）：\n",
            total
        ));

        for (i, item) in contents.iter().enumerate() {
            let date = &item.captured_at[..10];
            let source = &item.source_app;
            let content_type = item.content_type.as_str();

            // Use AI summary if available, otherwise fall back to a short preview
            let description = if let Some(ref summary) = item.summary {
                if !summary.is_empty() {
                    summary.clone()
                } else {
                    fallback_preview(item)
                }
            } else {
                fallback_preview(item)
            };

            let tags = item.tags.as_deref().unwrap_or("");

            if tags.is_empty() {
                lines.push(format!(
                    "{}. [{}] [{}] 来自 {}: {}",
                    i + 1,
                    date,
                    content_type,
                    source,
                    description
                ));
            } else {
                lines.push(format!(
                    "{}. [{}] [{}] 来自 {}: {} ({})",
                    i + 1,
                    date,
                    content_type,
                    source,
                    description,
                    tags
                ));
            }
        }

        lines.push("\n请帮我整理和分析这些内容。".to_string());
        lines.join("\n")
    };

    // Write to clipboard directly via arboard
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("无法访问剪贴板: {}", e))?;
    clipboard
        .set_text(&text)
        .map_err(|e| format!("写入剪贴板失败: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn make_temp_config(content: &str) -> NamedTempFile {
        let mut f = NamedTempFile::new().unwrap();
        f.write_all(content.as_bytes()).unwrap();
        f
    }

    #[test]
    fn test_read_valid_config() {
        let f = make_temp_config(r#"{"mcpServers": {}}"#);
        let config = read_config(&f.path().to_path_buf()).unwrap();
        assert!(config.get("mcpServers").is_some());
    }

    #[test]
    fn test_read_invalid_json() {
        let f = make_temp_config("not json at all");
        let result = read_config(&f.path().to_path_buf());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("JSON 无效"));
    }

    #[test]
    fn test_read_nonexistent_file() {
        let result = read_config(&PathBuf::from("/tmp/nonexistent-xiaoyun-test.json"));
        assert!(result.is_err());
    }

    #[test]
    fn test_write_and_read_config() {
        let f = make_temp_config("{}");
        let path = f.path().to_path_buf();
        let config = serde_json::json!({"mcpServers": {"test": {"command": "echo"}}});
        write_config(&path, &config).unwrap();
        let read_back = read_config(&path).unwrap();
        assert_eq!(read_back["mcpServers"]["test"]["command"], "echo");
    }

    #[test]
    fn test_backup_creates_timestamped_file() {
        let f = make_temp_config(r#"{"original": true}"#);
        let path = f.path().to_path_buf();
        backup_config(&path).unwrap();
        // Check that a .bak.YYYYMMDD file was created in the same directory
        let dir = path.parent().unwrap();
        let bak_files: Vec<_> = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".bak."))
            .collect();
        assert!(!bak_files.is_empty());
    }

    #[test]
    fn test_inject_xiaoyun_entry_new_config() {
        let mut config = serde_json::json!({});
        let servers = config
            .as_object_mut()
            .unwrap()
            .entry("mcpServers")
            .or_insert_with(|| serde_json::json!({}));
        servers.as_object_mut().unwrap().insert(
            MCP_SERVER_KEY.to_string(),
            serde_json::json!({"command": "npx", "args": ["-y", "mcp-server-sqlite-npx"]}),
        );
        assert!(config["mcpServers"]["xiaoyun"]["command"] == "npx");
    }

    #[test]
    fn test_inject_preserves_existing_entries() {
        let mut config = serde_json::json!({
            "mcpServers": {
                "other-tool": {"command": "other"}
            }
        });
        config["mcpServers"].as_object_mut().unwrap().insert(
            MCP_SERVER_KEY.to_string(),
            serde_json::json!({"command": "npx"}),
        );
        // Both entries should exist
        assert!(config["mcpServers"]["other-tool"]["command"] == "other");
        assert!(config["mcpServers"]["xiaoyun"]["command"] == "npx");
    }

    #[test]
    fn test_remove_xiaoyun_entry() {
        let mut config = serde_json::json!({
            "mcpServers": {
                "xiaoyun": {"command": "npx"},
                "other-tool": {"command": "other"}
            }
        });
        if let Some(servers) = config.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
            servers.remove(MCP_SERVER_KEY);
        }
        assert!(config["mcpServers"].get("xiaoyun").is_none());
        assert!(config["mcpServers"]["other-tool"]["command"] == "other");
    }

    #[test]
    fn test_remove_from_empty_servers() {
        let mut config = serde_json::json!({"mcpServers": {}});
        if let Some(servers) = config.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
            servers.remove(MCP_SERVER_KEY); // Should not panic
        }
        assert!(config["mcpServers"].as_object().unwrap().is_empty());
    }

    #[test]
    fn test_xiaoyun_db_path_is_absolute() {
        if let Some(path) = xiaoyun_db_path() {
            assert!(
                path.starts_with('/'),
                "DB path should be absolute: {}",
                path
            );
            assert!(
                !path.contains('~'),
                "DB path should not contain tilde: {}",
                path
            );
        }
    }

    #[test]
    fn test_config_no_mcp_servers_key() {
        let mut config = serde_json::json!({"someOtherKey": true});
        let servers = config
            .as_object_mut()
            .unwrap()
            .entry("mcpServers")
            .or_insert_with(|| serde_json::json!({}));
        servers.as_object_mut().unwrap().insert(
            MCP_SERVER_KEY.to_string(),
            serde_json::json!({"command": "npx"}),
        );
        assert!(config["mcpServers"]["xiaoyun"]["command"] == "npx");
        assert!(config["someOtherKey"] == true);
    }

    #[test]
    fn test_full_roundtrip() {
        let f = make_temp_config(r#"{"mcpServers": {"existing": {"command": "foo"}}}"#);
        let path = f.path().to_path_buf();

        // Connect
        let mut config = read_config(&path).unwrap();
        config["mcpServers"].as_object_mut().unwrap().insert(
            MCP_SERVER_KEY.to_string(),
            serde_json::json!({"command": "npx"}),
        );
        write_config(&path, &config).unwrap();

        // Verify connected
        let config = read_config(&path).unwrap();
        assert!(config["mcpServers"]["xiaoyun"].is_object());
        assert!(config["mcpServers"]["existing"].is_object());

        // Disconnect
        let mut config = read_config(&path).unwrap();
        config["mcpServers"]
            .as_object_mut()
            .unwrap()
            .remove(MCP_SERVER_KEY);
        write_config(&path, &config).unwrap();

        // Verify disconnected
        let config = read_config(&path).unwrap();
        assert!(config["mcpServers"].get("xiaoyun").is_none());
        assert!(config["mcpServers"]["existing"]["command"] == "foo");
    }
}
