# OpenAI Codex OAuth 集成实现方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户通过 OpenAI 账号登录（OAuth），直接使用 ChatGPT 订阅额度调用 Codex 模型，无需手动输入 API Key。

**Architecture:** 新增 `oauth.rs` 模块处理 PKCE 登录流程和 token 管理。新增 `OpenAiCodex` provider 走 `chatgpt.com/backend-api/codex/responses` 端点（Responses API，SSE 流式）。前端设置页 OpenAI 区域增加"账号登录"选项。OAuth token 存储在 SQLite 独立字段，不通过 `get_settings` 暴露给前端。

**Tech Stack:** Rust (tokio, reqwest, sha2, base64), Tauri 2 commands, React/TypeScript

**已验证的参数：**
- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann`
- Auth URL: `https://auth.openai.com/oauth/authorize`
- Token URL: `https://auth.openai.com/oauth/token`
- API URL: `https://chatgpt.com/backend-api/codex/responses`
- Callback: `http://localhost:1455/auth/callback`
- Scopes: `openid profile email offline_access`
- 必需 headers: `Authorization: Bearer <token>`, `ChatGPT-Account-Id: <jwt中提取>`
- 请求体必需: `instructions` 字段, `stream: true`
- 支持的模型: `gpt-5.1-codex`, `gpt-5.2-codex`, `gpt-5.3-codex`, `gpt-5.4`, `gpt-5.4-mini`

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src-tauri/src/ai/oauth.rs` | 新建 | OAuth PKCE 流程、token 交换/刷新、本地回调服务器 |
| `src-tauri/src/ai/codex_api.rs` | 新建 | Codex Responses API 调用（SSE 流式解析） |
| `src-tauri/src/ai/mod.rs` | 修改 | 注册新模块 |
| `src-tauri/src/commands/oauth.rs` | 新建 | Tauri OAuth 命令（登录/状态/登出） |
| `src-tauri/src/commands/mod.rs` | 修改 | 注册 oauth 模块 |
| `src-tauri/src/commands/capture.rs` | 修改 | 摘要生成支持 Codex provider |
| `src-tauri/src/commands/attention.rs` | 修改 | 雷达分析支持 Codex provider |
| `src-tauri/src/lib.rs` | 修改 | 注册新 Tauri 命令 |
| `src-tauri/Cargo.toml` | 修改 | 添加 `base64` 依赖到主依赖 |
| `src/stores/settingsStore.ts` | 修改 | 增加 OAuth 状态字段和 actions |
| `src/features/settings/SettingsView.tsx` | 修改 | OpenAI 设置区增加登录 UI |

---

### Task 1: OAuth 核心模块

**Files:**
- Create: `src-tauri/src/ai/oauth.rs`
- Modify: `src-tauri/src/ai/mod.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: 添加 base64 到主依赖**

`src-tauri/Cargo.toml` 的 `[dependencies]` 部分添加：
```toml
base64 = "0.22"
```

- [ ] **Step 2: 注册模块**

`src-tauri/src/ai/mod.rs` 添加：
```rust
pub mod codex_api;
pub mod oauth;
```

- [ ] **Step 3: 创建 oauth.rs — 数据结构和常量**

创建 `src-tauri/src/ai/oauth.rs`：

```rust
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_URL: &str = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const SCOPES: &str = "openid profile email offline_access";
const CALLBACK_PORT: u16 = 1455;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthToken {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,        // unix timestamp in seconds
    pub account_id: String,     // ChatGPT-Account-Id from JWT
    pub email: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OAuthStatus {
    pub logged_in: bool,
    pub email: Option<String>,
    pub expires_at: Option<i64>,
}

/// Global OAuth state — holds the current token in memory for fast access
pub static OAUTH_STATE: once_cell::sync::Lazy<Arc<Mutex<Option<OAuthToken>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(None)));
```

- [ ] **Step 4: 实现 PKCE 生成**

在 `oauth.rs` 中继续添加：

```rust
fn generate_pkce() -> (String, String) {
    let random_bytes: Vec<u8> = (0..32).map(|_| rand::thread_rng().gen()).collect();
    let verifier = URL_SAFE_NO_PAD.encode(&random_bytes);
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());
    (verifier, challenge)
}

fn generate_state() -> String {
    let bytes: Vec<u8> = (0..16).map(|_| rand::thread_rng().gen()).collect();
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn decode_jwt_payload(token: &str) -> Option<serde_json::Value> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 { return None; }
    let bytes = URL_SAFE_NO_PAD.decode(parts[1]).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn url_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                format!("{}", b as char)
            }
            _ => format!("%{:02X}", b),
        })
        .collect()
}
```

- [ ] **Step 5: 实现完整 OAuth 登录流程**

```rust
/// Run the full OAuth PKCE login flow.
/// 1. Start local callback server on port 1455
/// 2. Open browser to auth URL
/// 3. Wait for callback with auth code
/// 4. Exchange code for tokens
/// Returns OAuthToken on success.
pub async fn start_oauth_login() -> Result<OAuthToken, String> {
    let (verifier, challenge) = generate_pkce();
    let state = generate_state();
    let redirect_uri = format!("http://localhost:{}/auth/callback", CALLBACK_PORT);

    // Start local server
    let listener = TcpListener::bind(format!("127.0.0.1:{}", CALLBACK_PORT))
        .await
        .map_err(|e| format!("端口 {} 被占用: {}。请关闭占用该端口的程序后重试。", CALLBACK_PORT, e))?;

    // Build auth URL
    let auth_url = format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&code_challenge={}&code_challenge_method=S256&state={}&codex_cli_simplified_flow=true",
        AUTH_URL, CLIENT_ID, url_encode(&redirect_uri), url_encode(SCOPES), challenge, state,
    );

    // Open browser
    open::that(&auth_url).map_err(|e| format!("无法打开浏览器: {}", e))?;

    log::info!("OAuth: 已打开浏览器，等待用户授权...");

    // Wait for callback (180s timeout)
    let (code, received_state) = wait_for_callback(&listener).await?;

    if received_state != state {
        return Err("OAuth state 不匹配，可能存在安全问题".to_string());
    }

    // Exchange code for token
    let token = exchange_code(&code, &verifier, &redirect_uri).await?;

    // Store in memory
    let mut oauth_state = OAUTH_STATE.lock().await;
    *oauth_state = Some(token.clone());

    log::info!("OAuth: 登录成功，邮箱: {}", token.email);
    Ok(token)
}

async fn wait_for_callback(listener: &TcpListener) -> Result<(String, String), String> {
    let timeout = tokio::time::Duration::from_secs(180);
    let (mut stream, _) = tokio::time::timeout(timeout, listener.accept())
        .await
        .map_err(|_| "等待授权超时（180秒）")?
        .map_err(|e| format!("接受连接失败: {}", e))?;

    let (reader, mut writer) = stream.split();
    let mut buf_reader = BufReader::new(reader);
    let mut request_line = String::new();
    buf_reader.read_line(&mut request_line).await
        .map_err(|e| format!("读取请求失败: {}", e))?;

    let path = request_line.split_whitespace().nth(1)
        .ok_or("无效的 HTTP 请求")?.to_string();
    let query = path.split('?').nth(1).ok_or("回调缺少参数")?;

    let mut code = String::new();
    let mut state = String::new();
    for param in query.split('&') {
        let mut kv = param.splitn(2, '=');
        match (kv.next(), kv.next()) {
            (Some("code"), Some(v)) => code = v.to_string(),
            (Some("state"), Some(v)) => state = v.to_string(),
            _ => {}
        }
    }

    // Drain headers
    loop {
        let mut line = String::new();
        buf_reader.read_line(&mut line).await.map_err(|e| format!("{}", e))?;
        if line.trim().is_empty() { break; }
    }

    let html = if code.is_empty() {
        "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n\
        <html><body style='font-family:system-ui;text-align:center;padding:60px'>\
        <h2 style='color:#ef4444'>&#10007; 授权失败</h2>\
        <p>请返回小云重试。</p></body></html>"
    } else {
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n\
        <html><body style='font-family:system-ui;text-align:center;padding:60px'>\
        <h2 style='color:#22c55e'>&#10003; 授权成功</h2>\
        <p>已收到授权，请返回小云。</p>\
        <p style='color:#888;font-size:14px'>你可以关闭此页面。</p></body></html>"
    };

    let _ = writer.write_all(html.as_bytes()).await;
    let _ = writer.shutdown().await;

    if code.is_empty() {
        return Err("未收到授权码".to_string());
    }

    Ok((code, state))
}
```

- [ ] **Step 6: 实现 token 交换和刷新**

```rust
async fn exchange_code(code: &str, verifier: &str, redirect_uri: &str) -> Result<OAuthToken, String> {
    let client = Client::new();
    let resp = client
        .post(TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!(
            "grant_type=authorization_code&client_id={}&code={}&code_verifier={}&redirect_uri={}",
            CLIENT_ID, url_encode(code), url_encode(verifier), url_encode(redirect_uri),
        ))
        .send().await
        .map_err(|e| format!("Token 交换请求失败: {}", e))?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
    if !status.is_success() {
        return Err(format!("Token 交换失败 ({}): {}", status, body));
    }

    parse_token_response(&body)
}

/// Refresh the access token using the refresh token.
pub async fn refresh_token(refresh: &str) -> Result<OAuthToken, String> {
    let client = Client::new();
    let resp = client
        .post(TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!(
            "grant_type=refresh_token&refresh_token={}&client_id={}",
            url_encode(refresh), CLIENT_ID,
        ))
        .send().await
        .map_err(|e| format!("Token 刷新请求失败: {}", e))?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
    if !status.is_success() {
        return Err(format!("Token 刷新失败 ({}): {}", status, body));
    }

    parse_token_response(&body)
}

fn parse_token_response(body: &str) -> Result<OAuthToken, String> {
    let data: serde_json::Value = serde_json::from_str(body)
        .map_err(|e| format!("解析 token 响应失败: {}", e))?;

    let access_token = data["access_token"].as_str()
        .ok_or("响应中缺少 access_token")?.to_string();
    let refresh_token = data.get("refresh_token")
        .and_then(|v| v.as_str()).unwrap_or("").to_string();
    let expires_in = data.get("expires_in")
        .and_then(|v| v.as_i64()).unwrap_or(3600);
    let expires_at = chrono::Utc::now().timestamp() + expires_in;

    // Extract account_id and email from JWT
    let jwt = decode_jwt_payload(&access_token);
    let account_id = jwt.as_ref()
        .and_then(|j| j.get("https://api.openai.com/auth"))
        .and_then(|a| a.get("chatgpt_account_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("").to_string();
    let email = jwt.as_ref()
        .and_then(|j| j.get("email"))
        .and_then(|v| v.as_str())
        .unwrap_or("").to_string();

    Ok(OAuthToken { access_token, refresh_token, expires_at, account_id, email })
}

/// Get a valid access token, refreshing if needed.
/// Returns (access_token, account_id) or None if not logged in.
pub async fn get_valid_token(db: &crate::storage::database::Database) -> Option<(String, String)> {
    let mut state = OAUTH_STATE.lock().await;

    if state.is_none() {
        // Try loading from DB
        if let Ok(Some(json)) = db.repo().get_setting("openai_oauth_token") {
            if let Ok(token) = serde_json::from_str::<OAuthToken>(&json) {
                *state = Some(token);
            }
        }
    }

    let token = state.as_ref()?;
    let now = chrono::Utc::now().timestamp();

    // If token expires within 5 minutes, refresh
    if now > token.expires_at - 300 {
        if token.refresh_token.is_empty() {
            *state = None;
            return None;
        }
        match refresh_token(&token.refresh_token).await {
            Ok(new_token) => {
                // Save refreshed token to DB
                if let Ok(json) = serde_json::to_string(&new_token) {
                    let _ = db.repo().update_setting("openai_oauth_token", &json);
                }
                let result = (new_token.access_token.clone(), new_token.account_id.clone());
                *state = Some(new_token);
                return Some(result);
            }
            Err(e) => {
                log::error!("OAuth token 刷新失败: {}", e);
                *state = None;
                return None;
            }
        }
    }

    Some((token.access_token.clone(), token.account_id.clone()))
}

/// Save token to DB and memory.
pub async fn save_token(db: &crate::storage::database::Database, token: &OAuthToken) {
    if let Ok(json) = serde_json::to_string(token) {
        let _ = db.repo().update_setting("openai_oauth_token", &json);
    }
    let mut state = OAUTH_STATE.lock().await;
    *state = Some(token.clone());
}

/// Clear OAuth state (logout).
pub async fn clear_token(db: &crate::storage::database::Database) {
    let _ = db.repo().update_setting("openai_oauth_token", "");
    let mut state = OAUTH_STATE.lock().await;
    *state = None;
}
```

- [ ] **Step 7: 验证编译**

Run: `cd src-tauri && cargo check`
Expected: 编译通过（忽略 warnings）

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/ai/oauth.rs src-tauri/src/ai/mod.rs src-tauri/Cargo.toml
git commit -m "feat: add OpenAI Codex OAuth module (PKCE + token management)"
```

---

### Task 2: Codex Responses API 调用模块

**Files:**
- Create: `src-tauri/src/ai/codex_api.rs`

- [ ] **Step 1: 创建 codex_api.rs**

```rust
use reqwest::Client;
use std::time::Duration;

const CODEX_API_URL: &str = "https://chatgpt.com/backend-api/codex/responses";

/// Call the Codex Responses API with SSE streaming.
/// This uses the ChatGPT subscription quota, not the OpenAI platform API.
///
/// - `access_token`: OAuth access token
/// - `account_id`: ChatGPT Account ID (from JWT)
/// - `model`: Codex model ID (e.g. "gpt-5.4", "gpt-5.1-codex")
/// - `instructions`: System prompt (required by Codex API)
/// - `user_message`: User message text
///
/// Returns the complete response text.
pub async fn call_codex_api(
    access_token: &str,
    account_id: &str,
    model: &str,
    instructions: &str,
    user_message: &str,
) -> Result<String, String> {
    let http_client = Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("HTTP client 创建失败: {}", e))?;

    let body = serde_json::json!({
        "model": model,
        "instructions": if instructions.is_empty() { "You are a helpful assistant." } else { instructions },
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": user_message
                    }
                ]
            }
        ],
        "stream": true,
        "store": false
    });

    let resp = http_client
        .post(CODEX_API_URL)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .header("ChatGPT-Account-Id", account_id)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Codex API 请求失败: {}", e))?;

    let status = resp.status();
    let text = resp.text().await
        .map_err(|e| format!("读取 Codex 响应失败: {}", e))?;

    if !status.is_success() {
        return Err(format!("Codex API 错误 ({}): {}", status, text));
    }

    // Parse SSE stream
    let mut result = String::new();
    for line in text.lines() {
        if let Some(data) = line.strip_prefix("data: ") {
            if data == "[DONE]" { break; }
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                if event["type"].as_str() == Some("response.output_text.delta") {
                    if let Some(delta) = event["delta"].as_str() {
                        result.push_str(delta);
                    }
                }
            }
        }
    }

    if result.is_empty() {
        Err("Codex API 返回空响应".to_string())
    } else {
        Ok(result)
    }
}
```

- [ ] **Step 2: 验证编译**

Run: `cd src-tauri && cargo check`

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/ai/codex_api.rs
git commit -m "feat: add Codex Responses API caller with SSE parsing"
```

---

### Task 3: Tauri OAuth 命令

**Files:**
- Create: `src-tauri/src/commands/oauth.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 创建 commands/oauth.rs**

```rust
use crate::ai::oauth;
use crate::commands::capture::AppState;
use tauri::State;

#[tauri::command]
pub async fn start_openai_oauth(state: State<'_, AppState>) -> Result<oauth::OAuthStatus, String> {
    let token = oauth::start_oauth_login().await?;
    oauth::save_token(&state.db, &token).await;
    Ok(oauth::OAuthStatus {
        logged_in: true,
        email: Some(token.email),
        expires_at: Some(token.expires_at),
    })
}

#[tauri::command]
pub async fn get_openai_oauth_status(state: State<'_, AppState>) -> Result<oauth::OAuthStatus, String> {
    let valid = oauth::get_valid_token(&state.db).await;
    match valid {
        Some(_) => {
            let guard = oauth::OAUTH_STATE.lock().await;
            let token = guard.as_ref().unwrap();
            Ok(oauth::OAuthStatus {
                logged_in: true,
                email: Some(token.email.clone()),
                expires_at: Some(token.expires_at),
            })
        }
        None => Ok(oauth::OAuthStatus {
            logged_in: false,
            email: None,
            expires_at: None,
        }),
    }
}

#[tauri::command]
pub async fn logout_openai_oauth(state: State<'_, AppState>) -> Result<(), String> {
    oauth::clear_token(&state.db).await;
    log::info!("OAuth: 用户已退出登录");
    Ok(())
}
```

- [ ] **Step 2: 注册模块**

`src-tauri/src/commands/mod.rs` 添加：
```rust
pub mod oauth;
```

- [ ] **Step 3: 注册 Tauri 命令**

`src-tauri/src/lib.rs` 的 `invoke_handler` 中添加：
```rust
commands::oauth::start_openai_oauth,
commands::oauth::get_openai_oauth_status,
commands::oauth::logout_openai_oauth,
```

- [ ] **Step 4: 添加 open crate 依赖**

`src-tauri/Cargo.toml` 的 `[dependencies]` 添加：
```toml
open = "5"
```

- [ ] **Step 5: 验证编译**

Run: `cd src-tauri && cargo check`

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/oauth.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat: add Tauri commands for OpenAI OAuth (login/status/logout)"
```

---

### Task 4: 接入现有 AI 调用路径

**Files:**
- Modify: `src-tauri/src/ai/attention_analyzer.rs`
- Modify: `src-tauri/src/commands/capture.rs`
- Modify: `src-tauri/src/commands/attention.rs`

这一步的核心逻辑：当 provider 是 `openai` 且有有效的 OAuth token 时，自动切换到 Codex API，不再需要 API Key。

- [ ] **Step 1: 在 attention_analyzer.rs 添加 Codex 调用路径**

在 `call_analysis_api` 函数的 `match provider` 之前，添加一个 helper 函数：

```rust
/// Check if OpenAI Codex OAuth is available and call the Codex API if so.
/// Returns Some(result) if Codex was used, None if should fall back to API key.
pub async fn try_codex_call(
    db: &crate::storage::database::Database,
    system_prompt: &str,
    user_message: &str,
) -> Option<Result<String, String>> {
    let (access_token, account_id) = crate::ai::oauth::get_valid_token(db).await?;
    // Use gpt-5.1-codex as default model for Codex OAuth calls
    let model = "gpt-5.1-codex";
    Some(crate::ai::codex_api::call_codex_api(
        &access_token, &account_id, model, system_prompt, user_message,
    ).await)
}
```

- [ ] **Step 2: 修改 capture.rs 中的摘要生成**

在 `capture.rs` 的摘要生成部分（约第 779 行），在现有的 `call_analysis_api` 之前添加 Codex 路径：

```rust
// Try Codex OAuth first (if available)
if provider_str == "openai" {
    if let Some(result) = crate::ai::attention_analyzer::try_codex_call(
        &state_for_ai.db, "", &prompt
    ).await {
        match result {
            Ok(raw) => {
                // ... 同现有的 Ok 分支处理逻辑 ...
            }
            Err(e) => {
                log::warn!("Codex OAuth 调用失败，回退到 API Key: {}", e);
                // Fall through to existing API key path below
            }
        }
    }
}
// Existing API key path (unchanged)
```

- [ ] **Step 3: 修改 attention.rs 中的雷达分析**

在 `trigger_attention_analysis` 命令中，在调用 `call_analysis_api` / `call_dashscope_streaming` 之前添加类似的 Codex 路径：

```rust
// Try Codex OAuth if provider is openai
if provider_str == "openai" {
    if let Some(result) = crate::ai::attention_analyzer::try_codex_call(
        &state.db, &system_prompt, &user_message
    ).await {
        match result {
            Ok(raw) => {
                // ... 解析 RadarReport 和保存 ...
            }
            Err(e) => {
                log::warn!("Codex OAuth 雷达分析失败，回退到 API Key: {}", e);
            }
        }
    }
}
```

- [ ] **Step 4: 验证编译**

Run: `cd src-tauri && cargo check`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ai/attention_analyzer.rs src-tauri/src/commands/capture.rs src-tauri/src/commands/attention.rs
git commit -m "feat: integrate Codex OAuth into summary and radar analysis paths"
```

---

### Task 5: 前端设置页 — OAuth 登录 UI

**Files:**
- Modify: `src/stores/settingsStore.ts`
- Modify: `src/features/settings/SettingsView.tsx`

- [ ] **Step 1: 扩展 settingsStore — 添加 OAuth 状态**

在 `SettingsState` interface 中添加：

```typescript
// OAuth 状态
oauthLoggedIn: boolean;
oauthEmail: string;
oauthLoading: boolean;

// OAuth actions
loadOAuthStatus: () => Promise<void>;
startOAuthLogin: () => Promise<void>;
logoutOAuth: () => Promise<void>;
```

在 `create<SettingsState>` 初始值中添加：

```typescript
oauthLoggedIn: false,
oauthEmail: "",
oauthLoading: false,
```

实现 actions：

```typescript
loadOAuthStatus: async () => {
    try {
        const status = await invoke<{ logged_in: boolean; email?: string }>("get_openai_oauth_status");
        set({ oauthLoggedIn: status.logged_in, oauthEmail: status.email || "" });
    } catch {
        set({ oauthLoggedIn: false, oauthEmail: "" });
    }
},

startOAuthLogin: async () => {
    set({ oauthLoading: true });
    try {
        const status = await invoke<{ logged_in: boolean; email?: string }>("start_openai_oauth");
        set({ oauthLoggedIn: status.logged_in, oauthEmail: status.email || "", oauthLoading: false });
    } catch (e) {
        set({ oauthLoading: false });
        throw e;
    }
},

logoutOAuth: async () => {
    try {
        await invoke("logout_openai_oauth");
        set({ oauthLoggedIn: false, oauthEmail: "" });
    } catch (e) {
        console.error("Logout failed:", e);
    }
},
```

在 `loadFromDB` 末尾、`set({ isLoaded: true })` 之前添加：

```typescript
// Load OAuth status
try {
    const oauthStatus = await invoke<{ logged_in: boolean; email?: string }>("get_openai_oauth_status");
    set({ oauthLoggedIn: oauthStatus.logged_in, oauthEmail: oauthStatus.email || "" });
} catch {}
```

- [ ] **Step 2: 修改 SettingsView — OpenAI 区域增加登录选项**

在 API Key 区域（约第 420 行）之前，当 `provider === "openai"` 时，添加 OAuth 登录区域：

```tsx
{/* OpenAI OAuth 登录 */}
{provider === "openai" && (
    <div className="p-4">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">账号登录</div>
        {oauthLoggedIn ? (
            <div className="flex items-center justify-between">
                <div>
                    <span className="text-sm text-green-600 dark:text-green-400">✓ 已登录</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">{oauthEmail}</span>
                </div>
                <button
                    onClick={logoutOAuth}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200/50 dark:border-white/[0.08] text-gray-500 dark:text-slate-400 hover:bg-gray-100/50 dark:hover:bg-white/[0.04] transition-colors"
                >
                    退出登录
                </button>
            </div>
        ) : (
            <div>
                <button
                    onClick={async () => {
                        try {
                            await startOAuthLogin();
                        } catch (e) {
                            alert(typeof e === "string" ? e : "登录失败，请重试");
                        }
                    }}
                    disabled={oauthLoading}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-[#10a37f] hover:bg-[#0d8c6d] text-white transition-colors disabled:opacity-50"
                >
                    {oauthLoading ? "等待授权..." : "🔑 登录 OpenAI 账号"}
                </button>
                <p className="text-xs text-gray-400 dark:text-gray-600 mt-2">
                    使用 ChatGPT 订阅额度，无需 API Key
                </p>
            </div>
        )}
    </div>
)}
```

从 store 中解构新字段：

```typescript
const { oauthLoggedIn, oauthEmail, oauthLoading, startOAuthLogin, logoutOAuth } = useSettingsStore();
```

- [ ] **Step 3: 验证编译和运行**

Run: `cd src-tauri && cargo check && cd .. && npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/stores/settingsStore.ts src/features/settings/SettingsView.tsx
git commit -m "feat: add OpenAI OAuth login UI in settings"
```

---

### Task 6: 端到端测试

- [ ] **Step 1: 启动开发服务器**

Run: `npm run dev` (或 `cargo tauri dev`)

- [ ] **Step 2: 测试 OAuth 登录**

1. 打开设置 → AI 配置
2. 选择 OpenAI 提供商
3. 点击"登录 OpenAI 账号"按钮
4. 浏览器打开 → 用 Google 账号登录 OpenAI
5. 授权后返回小云
6. 确认显示"已登录 + 邮箱"

- [ ] **Step 3: 测试 AI 调用**

1. 保存一段文本内容 → 确认自动摘要生成正常（走 Codex API）
2. 打开洞察页 → 触发雷达分析 → 确认能正常生成报告

- [ ] **Step 4: 测试退出登录**

1. 点击"退出登录"
2. 确认状态恢复为"未登录"
3. 确认 AI 调用回退到 API Key 方式

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: OpenAI Codex OAuth integration complete"
```
