use reqwest::Client;
use std::time::Duration;

const JINA_READER_BASE: &str = "https://r.jina.ai/";
const MAX_CONTENT_LENGTH: usize = 50_000; // ~50KB
const FETCH_TIMEOUT_SECS: u64 = 15;
const MIN_CONTENT_LENGTH: usize = 20;

const BROWSER_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

pub struct UrlReadResult {
    pub content: String,
    pub title: Option<String>,
}

pub struct UrlReader {
    http_client: Client,
}

impl UrlReader {
    pub fn new() -> Self {
        let http_client = match Client::builder()
            .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
            .build()
        {
            Ok(client) => client,
            Err(e) => {
                log::error!("Failed to build HTTP client: {}, using default", e);
                Client::new()
            }
        };
        UrlReader { http_client }
    }

    /// Smart fetch: pick the best method based on URL domain.
    /// Order: platform-specific → Jina Reader → direct HTML (fallback).
    pub async fn fetch_content(&self, url: &str) -> Result<UrlReadResult, String> {
        let raw = self.fetch_content_raw(url).await?;
        // Strip Markdown syntax for clean display
        let clean = strip_markdown(&raw.content);

        // Auto-translate: bilingual (original + Chinese) for non-Chinese content
        let content = if needs_translation(&clean) {
            log::info!("[Translate] Content is non-Chinese, creating bilingual version...");
            let bilingual = translate_bilingual(&self.http_client, &clean).await;
            log::info!("[Translate] Done, {} chars", bilingual.len());
            bilingual
        } else {
            clean
        };

        // Also translate title if needed
        let title = if let Some(ref t) = raw.title {
            if needs_translation(t) {
                let translated = translate_chunk(&self.http_client, t)
                    .await
                    .unwrap_or_else(|_| t.clone());
                Some(translated)
            } else {
                raw.title
            }
        } else {
            None
        };

        Ok(UrlReadResult { content, title })
    }

    /// Internal: fetch content without stripping Markdown.
    async fn fetch_content_raw(&self, url: &str) -> Result<UrlReadResult, String> {
        let clean_url = url.trim();
        if clean_url.is_empty() {
            return Err("Empty URL".to_string());
        }

        // ── Platform-specific readers (fastest, most reliable) ──

        // WeChat: Jina is blocked, must use direct HTML
        if clean_url.contains("mp.weixin.qq.com") {
            log::info!("[WeChat] 直接抓取: {}", clean_url);
            return self.fetch_wechat(clean_url).await;
        }

        // X/Twitter: Jina only gets login wall, use fxtwitter API
        if clean_url.contains("x.com/") || clean_url.contains("twitter.com/") {
            log::info!("[Twitter] fxtwitter API: {}", clean_url);
            return self.fetch_twitter(clean_url).await;
        }

        // YouTube: extract transcript/subtitles directly
        if clean_url.contains("youtube.com/") || clean_url.contains("youtu.be/") {
            log::info!("[YouTube] 字幕提取: {}", clean_url);
            return self.fetch_youtube(clean_url).await;
        }

        // GitHub: use API for repos, Jina for others
        if clean_url.contains("github.com/") {
            if let Some(result) = self.try_fetch_github(clean_url).await {
                return result;
            }
            // Fall through to Jina for non-repo GitHub pages
        }

        // Reddit: use JSON API (Jina often rate-limited by Reddit)
        if clean_url.contains("reddit.com/") {
            log::info!("[Reddit] JSON API: {}", clean_url);
            match self.fetch_reddit(clean_url).await {
                Ok(r) => return Ok(r),
                Err(e) => log::warn!("[Reddit] API failed, trying Jina: {}", e),
            }
        }

        // Xiaohongshu: extract from SSR JSON in HTML
        if clean_url.contains("xiaohongshu.com/") || clean_url.contains("xhslink.com/") {
            log::info!("[Xiaohongshu] SSR 提取: {}", clean_url);
            match self.fetch_xiaohongshu(clean_url).await {
                Ok(r) => return Ok(r),
                Err(e) => log::warn!("[Xiaohongshu] 失败 ({}), 尝试 Jina", e),
            }
        }

        // ── General: Jina Reader → direct HTML fallback ──
        log::info!("[Jina] 通用读取: {}", clean_url);
        match self.fetch_via_jina(clean_url).await {
            Ok(r) => Ok(r),
            Err(jina_err) => {
                log::warn!("[Jina] 失败 ({}), 尝试直接抓取", jina_err);
                // Fallback: direct HTML fetch + tag stripping
                self.fetch_direct_html(clean_url)
                    .await
                    .map_err(|html_err| format!("Jina: {} | Direct: {}", jina_err, html_err))
            }
        }
    }

    // ─── WeChat ────────────────────────────────────────────────────

    async fn fetch_wechat(&self, url: &str) -> Result<UrlReadResult, String> {
        let html = self.get_html(url).await?;
        let title = extract_wechat_title(&html);

        // Try js_content div first (traditional articles)
        let content = extract_wechat_content(&html);

        if content.len() >= MIN_CONTENT_LENGTH {
            let markdown = format_with_title(&title, &truncate_content(content));
            log::info!(
                "[WeChat] 成功 (js_content): {} chars, title={:?}",
                markdown.len(),
                title
            );
            return Ok(UrlReadResult {
                content: markdown,
                title,
            });
        }

        // Try content_noencode (newer format: content stored in JS variable)
        let noencode = extract_wechat_content_noencode(&html);
        if noencode.len() >= MIN_CONTENT_LENGTH {
            let markdown = format_with_title(&title, &truncate_content(noencode));
            log::info!(
                "[WeChat] 成功 (content_noencode): {} chars, title={:?}",
                markdown.len(),
                title
            );
            return Ok(UrlReadResult {
                content: markdown,
                title,
            });
        }

        // Fallback: og:description (for appmsg_type=9 short articles, shares, etc.)
        log::info!("[WeChat] js_content/noencode too short, trying og:description fallback");
        if let Some(desc) = extract_og_description(&html) {
            if desc.len() >= MIN_CONTENT_LENGTH {
                let decoded = desc.replace("\\x0a", "\n").replace("\\x26amp;amp;", "&");
                let markdown = format_with_title(&title, &truncate_content(decoded));
                log::info!(
                    "[WeChat] 成功 (og:description): {} chars, title={:?}",
                    markdown.len(),
                    title
                );
                return Ok(UrlReadResult {
                    content: markdown,
                    title,
                });
            }
        }

        // Fallback: try Jina Reader (some JS-rendered articles need headless browser)
        log::info!("[WeChat] HTML 抓取失败, 尝试 Jina Reader");
        if let Ok(jina_result) = self.fetch_via_jina(url).await {
            if jina_result.content.len() >= MIN_CONTENT_LENGTH {
                log::info!(
                    "[WeChat] 成功 (Jina fallback): {} chars",
                    jina_result.content.len()
                );
                return Ok(jina_result);
            }
        }

        // Last resort: return title as content (better than "读取失败")
        if let Some(ref t) = title {
            if !t.is_empty() {
                log::info!("[WeChat] 仅获取到标题: {:?}", title);
                return Ok(UrlReadResult {
                    content: t.clone(),
                    title,
                });
            }
        }

        Err(format!(
            "WeChat content too short ({} chars)",
            content.len()
        ))
    }

    // ─── X/Twitter ─────────────────────────────────────────────────

    async fn fetch_twitter(&self, url: &str) -> Result<UrlReadResult, String> {
        let (user, tweet_id) =
            parse_twitter_url(url).ok_or_else(|| format!("Cannot parse Twitter URL: {}", url))?;

        let api_url = format!("https://api.fxtwitter.com/{}/status/{}", user, tweet_id);
        let json: serde_json::Value = self.get_json(&api_url).await?;

        let tweet = json.get("tweet").ok_or("fxtwitter: no tweet")?;
        let author_name = tweet
            .pointer("/author/name")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let author_handle = tweet
            .pointer("/author/screen_name")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let (title, body) = if let Some(article) = tweet.get("article") {
            let t = article
                .get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            (t, extract_twitter_article_content(article))
        } else {
            let text = tweet
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            (None, text)
        };

        // No minimum length check — user chose to save it, respect that

        let content = truncate_content(body);
        let markdown = if let Some(ref t) = title {
            format!(
                "# {}\n\n> @{} ({})\n\n{}",
                t, author_handle, author_name, content
            )
        } else {
            format!("> @{} ({})\n\n{}", author_handle, author_name, content)
        };

        log::info!("[Twitter] 成功: {} chars", markdown.len());
        Ok(UrlReadResult {
            content: markdown,
            title: title.or_else(|| {
                Some(format!(
                    "@{}: {}…",
                    author_handle,
                    content.chars().take(50).collect::<String>()
                ))
            }),
        })
    }

    // ─── GitHub ────────────────────────────────────────────────────

    /// Try GitHub API for repo URLs (owner/repo). Returns None for non-repo URLs.
    async fn try_fetch_github(&self, url: &str) -> Option<Result<UrlReadResult, String>> {
        let (owner, repo) = parse_github_repo_url(url)?;
        log::info!("[GitHub] API 读取: {}/{}", owner, repo);

        Some(self.fetch_github_repo(&owner, &repo).await)
    }

    async fn fetch_github_repo(&self, owner: &str, repo: &str) -> Result<UrlReadResult, String> {
        // 1. Get repo info
        let repo_url = format!("https://api.github.com/repos/{}/{}", owner, repo);
        let repo_json: serde_json::Value = self
            .http_client
            .get(&repo_url)
            .header("User-Agent", "xiaoyun/0.1")
            .header("Accept", "application/vnd.github.v3+json")
            .send()
            .await
            .map_err(|e| format!("GitHub API: {}", e))?
            .json()
            .await
            .map_err(|e| format!("GitHub JSON: {}", e))?;

        let description = repo_json
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let stars = repo_json
            .get("stargazers_count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let language = repo_json
            .get("language")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown");
        let repo_name = repo_json
            .get("full_name")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // 2. Try to get README
        let readme_url = format!("https://api.github.com/repos/{}/{}/readme", owner, repo);
        let readme_content = match self
            .http_client
            .get(&readme_url)
            .header("User-Agent", "xiaoyun/0.1")
            .header("Accept", "application/vnd.github.v3+json")
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    // README is base64-encoded
                    json.get("content")
                        .and_then(|v| v.as_str())
                        .and_then(|b64| {
                            let clean = b64.replace('\n', "");
                            base64_decode(&clean)
                        })
                        .unwrap_or_default()
                } else {
                    String::new()
                }
            }
            _ => String::new(),
        };

        // 3. Format
        let header = format!(
            "# {}\n\n{}\n\n⭐ {} stars · Language: {}\n",
            repo_name, description, stars, language
        );

        let content = if readme_content.is_empty() {
            header
        } else {
            let readme_trimmed = truncate_content(readme_content);
            format!("{}\n---\n\n{}", header, readme_trimmed)
        };

        let title = Some(format!("{} — {}", repo_name, description));
        log::info!("[GitHub] 成功: {} chars", content.len());
        Ok(UrlReadResult { content, title })
    }

    // ─── Reddit ────────────────────────────────────────────────────

    async fn fetch_reddit(&self, url: &str) -> Result<UrlReadResult, String> {
        // Append .json to Reddit URL to get JSON response
        let clean = url.split('?').next().unwrap_or(url).trim_end_matches('/');
        let json_url = format!("{}.json", clean);

        let json: serde_json::Value = self
            .http_client
            .get(&json_url)
            .header("User-Agent", "xiaoyun/0.1")
            .send()
            .await
            .map_err(|e| format!("Reddit: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Reddit JSON: {}", e))?;

        // Reddit returns an array: [post_listing, comments_listing]
        let post_data = json
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|listing| listing.pointer("/data/children/0/data"))
            .ok_or("Reddit: cannot find post data")?;

        let title = post_data
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let selftext = post_data
            .get("selftext")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let subreddit = post_data
            .get("subreddit")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let author = post_data
            .get("author")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let score = post_data.get("score").and_then(|v| v.as_i64()).unwrap_or(0);

        let body = if selftext.is_empty() {
            // Link post — might have a linked URL
            let linked_url = post_data.get("url").and_then(|v| v.as_str()).unwrap_or("");
            format!("Link: {}", linked_url)
        } else {
            selftext.to_string()
        };

        let markdown = format!(
            "# {}\n\n> r/{} · u/{} · {} points\n\n{}",
            title,
            subreddit,
            author,
            score,
            truncate_content(body)
        );

        log::info!("[Reddit] 成功: {} chars", markdown.len());
        Ok(UrlReadResult {
            content: markdown,
            title: if title.is_empty() { None } else { Some(title) },
        })
    }

    // ─── YouTube ──────────────────────────────────────────────────

    async fn fetch_youtube(&self, url: &str) -> Result<UrlReadResult, String> {
        use regex::Regex;

        let video_id = extract_youtube_id(url)
            .ok_or_else(|| format!("Cannot extract YouTube video ID from: {}", url))?;

        log::info!("[YouTube] video_id={}", video_id);

        // Step 1: Fetch the video page HTML (for title and chapters)
        let watch_url = format!("https://www.youtube.com/watch?v={}", video_id);
        let html = self
            .http_client
            .get(&watch_url)
            .header("User-Agent", BROWSER_UA)
            .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
            .send()
            .await
            .map_err(|e| format!("YouTube page request failed: {}", e))?
            .text()
            .await
            .map_err(|e| format!("YouTube page read failed: {}", e))?;

        let title = extract_youtube_title(&html);

        // Step 2: Use yt-dlp to download caption XML (YouTube's timedtext API
        // no longer works with direct requests; yt-dlp uses the Android VR
        // Player API which still returns valid caption URLs)
        let tmp_dir = std::env::temp_dir().join(format!("xiaoyun_yt_{}", video_id));
        let _ = std::fs::create_dir_all(&tmp_dir);
        let out_template = tmp_dir.join("sub");

        // Try Chinese first, fallback to English
        let sub_langs = "zh-Hans,zh,zh-CN,zh-Hant,en";

        // Resolve yt-dlp binary path — macOS GUI apps have a minimal PATH,
        // so we search common install locations explicitly (concrete paths first).
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/pipiwang".to_string());
        let candidates = vec![
            format!("{}/anaconda3/bin/yt-dlp", home),
            format!("{}/miniconda3/bin/yt-dlp", home),
            format!("{}/.local/bin/yt-dlp", home),
            "/usr/local/bin/yt-dlp".to_string(),
            "/opt/homebrew/bin/yt-dlp".to_string(),
        ];
        let yt_dlp_bin = candidates
            .iter()
            .find(|p| std::path::Path::new(p).exists())
            .cloned()
            .unwrap_or_else(|| "yt-dlp".to_string()); // bare name as last resort

        log::info!("[YouTube] Using yt-dlp binary: {}", yt_dlp_bin);

        // Try one language at a time — yt-dlp aborts ALL downloads on first 429
        let lang_attempts = vec!["en", "zh-Hans", "zh", "zh-Hant"];

        let out_path = out_template.to_str().unwrap_or("/tmp/sub");
        let mut last_stderr = String::new();

        for (attempt, langs) in lang_attempts.iter().enumerate() {
            // Clean tmp dir before each attempt
            let _ = std::fs::remove_dir_all(&tmp_dir);
            let _ = std::fs::create_dir_all(&tmp_dir);

            log::info!("[YouTube] attempt {} with langs: {}", attempt + 1, langs);

            let output = tokio::process::Command::new(&yt_dlp_bin)
                .args(&[
                    "--write-auto-sub",
                    "--sub-lang",
                    langs,
                    "--skip-download",
                    "--sub-format",
                    "srv1",
                    "-o",
                    out_path,
                    &watch_url,
                ])
                .output()
                .await
                .map_err(|e| {
                    format!(
                        "yt-dlp not found or failed: {}. Please install: pip3 install yt-dlp",
                        e
                    )
                })?;

            last_stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if !output.status.success() {
                log::warn!("[YouTube] yt-dlp exit non-zero: {}", last_stderr);
            }

            // Check if subtitle file was downloaded
            let has_sub = std::fs::read_dir(&tmp_dir)
                .map(|entries| {
                    entries
                        .filter_map(|e| e.ok())
                        .any(|e| e.path().extension().map(|x| x == "srv1").unwrap_or(false))
                })
                .unwrap_or(false);

            if has_sub {
                log::info!("[YouTube] Got subtitles on attempt {}", attempt + 1);
                break;
            }

            // If failed and more attempts left, wait before retry
            if attempt + 1 < lang_attempts.len() {
                log::info!(
                    "[YouTube] attempt {} failed, waiting 2s before next lang...",
                    attempt + 1
                );
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }

        // Step 3: Find and read the downloaded subtitle file
        let xml = std::fs::read_dir(&tmp_dir)
            .map_err(|e| format!("Cannot read tmp dir: {}", e))?
            .filter_map(|entry| entry.ok())
            .find(|entry| {
                entry
                    .path()
                    .extension()
                    .map(|e| e == "srv1")
                    .unwrap_or(false)
            })
            .and_then(|entry| std::fs::read_to_string(entry.path()).ok())
            .unwrap_or_default();

        // Clean up temp files
        let _ = std::fs::remove_dir_all(&tmp_dir);

        if xml.is_empty() {
            let desc = extract_youtube_description(&html).unwrap_or_default();
            let content = if let Some(ref t) = title {
                format!(
                    "{}\n\n{}",
                    t,
                    if desc.is_empty() {
                        "（该视频没有字幕）".to_string()
                    } else {
                        desc
                    }
                )
            } else {
                if desc.is_empty() {
                    "（该视频没有字幕）".to_string()
                } else {
                    desc
                }
            };
            return Ok(UrlReadResult {
                content: truncate_content(content),
                title,
            });
        }

        // Step 4: Parse XML → structured snippets with timestamps
        let re_text =
            Regex::new(r#"<text\s+start="([^"]+)"\s+dur="([^"]+)"[^>]*>(.*?)</text>"#).unwrap();
        let re_html_tags = Regex::new(r"<[^>]*>").unwrap();

        struct Snippet {
            start: f64,
            dur: f64,
            text: String,
        }

        let mut snippets: Vec<Snippet> = Vec::new();
        for cap in re_text.captures_iter(&xml) {
            let start: f64 = cap
                .get(1)
                .and_then(|m| m.as_str().parse().ok())
                .unwrap_or(0.0);
            let dur: f64 = cap
                .get(2)
                .and_then(|m| m.as_str().parse().ok())
                .unwrap_or(0.0);
            let raw_text = cap.get(3).map(|m| m.as_str()).unwrap_or("");
            let decoded = html_decode(raw_text).replace('\n', " ");
            let clean = re_html_tags.replace_all(&decoded, "").trim().to_string();
            if !clean.is_empty() {
                snippets.push(Snippet {
                    start,
                    dur,
                    text: clean,
                });
            }
        }

        if snippets.is_empty() {
            return Err("YouTube: caption XML parsed but no text found".to_string());
        }

        // Step 5: Extract chapters from video description
        let chapters = extract_youtube_chapters(&html);

        // Step 6: Group snippets into paragraphs
        // Split on: gap > 2s OR accumulated text > 500 chars
        let mut paragraphs: Vec<(f64, f64, String)> = Vec::new();
        let mut para_start = snippets[0].start;
        let mut para_end = snippets[0].start + snippets[0].dur;
        let mut para_texts: Vec<String> = vec![snippets[0].text.clone()];
        let mut para_len: usize = snippets[0].text.len();

        for s in snippets.iter().skip(1) {
            let gap = s.start - para_end;
            if gap > 2.0 || para_len > 500 {
                paragraphs.push((para_start, para_end, para_texts.join(" ")));
                para_start = s.start;
                para_texts.clear();
                para_len = 0;
            }
            para_end = s.start + s.dur;
            para_texts.push(s.text.clone());
            para_len += s.text.len();
        }
        paragraphs.push((para_start, para_end, para_texts.join(" ")));

        // Step 7: Format output with chapters and timestamps
        let mut output = String::new();

        if let Some(ref t) = title {
            output.push_str(t);
            output.push_str("\n\n");
        }

        if chapters.is_empty() {
            for (start, end, text) in &paragraphs {
                output.push_str(&format!(
                    "[{} → {}]\n{}\n\n",
                    format_timestamp(*start),
                    format_timestamp(*end),
                    text
                ));
            }
        } else {
            for (ci, chapter) in chapters.iter().enumerate() {
                let chapter_end = chapters.get(ci + 1).map(|c| c.0).unwrap_or(f64::MAX);
                output.push_str(&format!(
                    "【{}】{}\n\n",
                    format_timestamp(chapter.0),
                    chapter.1
                ));
                for (start, end, text) in &paragraphs {
                    if *start >= chapter.0 && *start < chapter_end {
                        output.push_str(&format!(
                            "[{} → {}]\n{}\n\n",
                            format_timestamp(*start),
                            format_timestamp(*end),
                            text
                        ));
                    }
                }
            }
        }

        let content = truncate_content(output.trim().to_string());
        log::info!(
            "[YouTube] 成功: {} chars, {} paragraphs, {} chapters",
            content.len(),
            paragraphs.len(),
            chapters.len()
        );
        Ok(UrlReadResult { content, title })
    }

    // ─── Jina Reader ───────────────────────────────────────────────

    /// Xiaohongshu: fetch HTML with mobile UA, extract title + desc from SSR JSON.
    async fn fetch_xiaohongshu(&self, url: &str) -> Result<UrlReadResult, String> {
        // Clean URL: keep only the note path, strip share tracking params
        let clean = if let Some(pos) = url.find("/explore/") {
            let base = &url[..pos + 9]; // ".../explore/"
            let rest = &url[pos + 9..];
            let note_id = rest.split('?').next().unwrap_or(rest);
            // Keep xsec params needed for access
            let xsec = url
                .find("xsec_token=")
                .map(|start| {
                    let token_part = &url[start..];
                    let end = token_part.find('&').unwrap_or(token_part.len());
                    format!("?xsec_source=app_share&{}", &token_part[..end])
                })
                .unwrap_or_default();
            format!("{}{}{}", base, note_id, xsec)
        } else {
            url.to_string()
        };

        let response = self.http_client
            .get(&clean)
            .header("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
            .header("Accept", "text/html")
            .send()
            .await
            .map_err(|e| format!("小红书请求失败: {}", e))?;

        let html = response
            .text()
            .await
            .map_err(|e| format!("读取小红书响应失败: {}", e))?;

        // Extract title from SSR JSON: "title":"..."
        let title = extract_json_string_field(&html, "title");

        // Extract desc from SSR JSON: "desc":"..."
        let desc = extract_json_string_field(&html, "desc");

        if let Some(content) = desc {
            if !content.is_empty() {
                // Unescape \n \t
                let content = content.replace("\\n", "\n").replace("\\t", " ");
                log::info!(
                    "[Xiaohongshu] 提取成功: {} chars, title={:?}",
                    content.len(),
                    title
                );
                return Ok(UrlReadResult { content, title });
            }
        }

        Err("小红书笔记内容提取失败".to_string())
    }

    async fn fetch_via_jina(&self, url: &str) -> Result<UrlReadResult, String> {
        let jina_url = format!("{}{}", JINA_READER_BASE, url);

        let response = self
            .http_client
            .get(&jina_url)
            .header("X-Return-Format", "markdown")
            .send()
            .await
            .map_err(|e| format!("Jina request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Jina status: {}", response.status()));
        }

        let body = response
            .text()
            .await
            .map_err(|e| format!("Jina read failed: {}", e))?;

        if body.trim().len() < MIN_CONTENT_LENGTH {
            return Err("Content too short".to_string());
        }

        let content = truncate_content(body);
        let title = extract_markdown_title(&content);
        Ok(UrlReadResult { content, title })
    }

    // ─── Direct HTML Fallback ──────────────────────────────────────

    /// Last resort: fetch raw HTML and strip tags.
    /// Works for most server-rendered pages, fails for SPAs.
    async fn fetch_direct_html(&self, url: &str) -> Result<UrlReadResult, String> {
        log::info!("[Direct] 直接抓取 HTML: {}", url);
        let html = self.get_html(url).await?;

        let title = extract_html_title(&html);
        let content = strip_html_to_text(&html);

        if content.len() < MIN_CONTENT_LENGTH {
            return Err(format!(
                "Direct HTML: content too short ({} chars)",
                content.len()
            ));
        }

        let markdown = format_with_title(&title, &truncate_content(content));
        log::info!("[Direct] 成功: {} chars, title={:?}", markdown.len(), title);
        Ok(UrlReadResult {
            content: markdown,
            title,
        })
    }

    // ─── HTTP helpers ──────────────────────────────────────────────

    async fn get_html(&self, url: &str) -> Result<String, String> {
        self.http_client
            .get(url)
            .header("User-Agent", BROWSER_UA)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?
            .text()
            .await
            .map_err(|e| format!("HTTP read failed: {}", e))
    }

    async fn get_json(&self, url: &str) -> Result<serde_json::Value, String> {
        self.http_client
            .get(url)
            .header("User-Agent", "xiaoyun/0.1")
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?
            .json()
            .await
            .map_err(|e| format!("JSON parse failed: {}", e))
    }
}

// ═══════════════════════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════════════════════

/// Check if text is predominantly non-Chinese (needs translation)
fn needs_translation(text: &str) -> bool {
    let total_chars: usize = text.chars().filter(|c| c.is_alphanumeric()).count();
    if total_chars < 20 {
        return false;
    }
    let chinese_chars: usize = text
        .chars()
        .filter(|c| {
            let u = *c as u32;
            (0x4E00..=0x9FFF).contains(&u) ||  // CJK Unified
        (0x3400..=0x4DBF).contains(&u) // CJK Extension A
        })
        .count();
    let ratio = chinese_chars as f64 / total_chars as f64;
    ratio < 0.3 // less than 30% Chinese → needs translation
}

/// Bilingual translation: each paragraph shows original + Chinese translation.
/// Splits by blank lines (paragraphs), translates each, formats as:
///   original text
///   翻译：translated text
async fn translate_bilingual(client: &Client, text: &str) -> String {
    // Split into paragraphs by blank lines
    let paragraphs: Vec<&str> = text
        .split("\n\n")
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();

    let mut result = String::new();

    for para in &paragraphs {
        // Already Chinese or too short — keep as-is
        if !needs_translation(para) || para.len() < 10 {
            result.push_str(para);
            result.push_str("\n\n");
            continue;
        }

        // Handle "[00:05 → 00:33]\ncontent..." — split timestamp from content
        if para.starts_with('[') && para.contains('→') {
            if let Some(newline_pos) = para.find('\n') {
                let timestamp = &para[..newline_pos];
                let content = para[newline_pos + 1..].trim();
                result.push_str(timestamp);
                result.push('\n');
                result.push_str(content);
                result.push('\n');
                if !content.is_empty() && needs_translation(content) {
                    if let Ok(translated) = translate_chunk(client, content).await {
                        result.push_str(&format!("翻译：{}", translated));
                        result.push('\n');
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                }
                result.push('\n');
                continue;
            }
            // Timestamp-only line (no content after it)
            result.push_str(para);
            result.push_str("\n\n");
            continue;
        }

        // Handle chapter headings "【00:26】 – Genesis of Notion AI"
        if para.starts_with('【') && para.contains('–') {
            result.push_str(para);
            result.push('\n');
            // Only translate the part after "–"
            if let Some(dash_pos) = para.find('–') {
                let chapter_title = para[dash_pos + 3..].trim(); // skip "– "
                if !chapter_title.is_empty() && needs_translation(chapter_title) {
                    if let Ok(translated) = translate_chunk(client, chapter_title).await {
                        result.push_str(&format!("翻译：{}", translated));
                        result.push('\n');
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                }
            }
            result.push('\n');
            continue;
        }

        // Regular paragraph — show original + translation
        result.push_str(para);
        result.push('\n');
        match translate_chunk(client, para).await {
            Ok(translated) => {
                result.push_str(&format!("翻译：{}", translated));
            }
            Err(_) => {}
        }
        result.push_str("\n\n");
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }

    result.trim().to_string()
}

/// Translate text to Chinese using free Google Translate API.
/// Splits long text into chunks to avoid API limits.
async fn translate_to_chinese(client: &Client, text: &str) -> String {
    // Split into chunks of ~1500 chars (smaller = more reliable with free API)
    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    for line in text.lines() {
        if current.len() + line.len() > 1500 && !current.is_empty() {
            chunks.push(current.clone());
            current.clear();
        }
        if !current.is_empty() {
            current.push('\n');
        }
        current.push_str(line);
    }
    if !current.is_empty() {
        chunks.push(current);
    }

    let mut translated_parts: Vec<String> = Vec::new();

    for chunk in &chunks {
        match translate_chunk(client, chunk).await {
            Ok(t) => translated_parts.push(t),
            Err(e) => {
                log::warn!("[Translate] chunk failed: {}, using original", e);
                translated_parts.push(chunk.clone());
            }
        }
        // Small delay between chunks to avoid rate limiting
        if chunks.len() > 1 {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
    }

    translated_parts.join("\n")
}

async fn translate_chunk(client: &Client, text: &str) -> Result<String, String> {
    let url = "https://translate.googleapis.com/translate_a/single";
    let resp = client
        .get(url)
        .query(&[
            ("client", "gtx"),
            ("sl", "auto"),
            ("tl", "zh-CN"),
            ("dt", "t"),
            ("q", text),
        ])
        .header("User-Agent", BROWSER_UA)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("translate request failed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("translate read failed: {}", e))?;

    // Response is a nested JSON array: [[["translated","original",...],...],...]
    // Parse manually — it's not standard JSON (has null entries)
    let parsed: serde_json::Value =
        serde_json::from_str(&resp).map_err(|e| format!("translate parse failed: {}", e))?;

    let mut result = String::new();
    if let Some(sentences) = parsed.get(0).and_then(|v| v.as_array()) {
        for sentence in sentences {
            if let Some(translated) = sentence.get(0).and_then(|v| v.as_str()) {
                result.push_str(translated);
            }
        }
    }

    if result.is_empty() {
        Err("empty translation".to_string())
    } else {
        Ok(result)
    }
}

/// Strip Markdown syntax, keep clean plain text.
/// Light cleanup of Markdown: remove noise (images, raw links, code blocks)
/// but KEEP structural elements (headings, lists, blockquotes, paragraphs).
fn strip_markdown(input: &str) -> String {
    use regex::Regex;

    let mut s = input.to_string();

    // ── Remove noise ──

    // Images: ![alt](url) → remove entirely
    let re_img = Regex::new(r"!\[[^\]]*\]\([^)]*\)").unwrap();
    s = re_img.replace_all(&s, "").to_string();

    // Links: [text](url) → text (keep the text, drop the URL)
    let re_link = Regex::new(r"\[([^\]]*)\]\([^)]*\)").unwrap();
    s = re_link.replace_all(&s, "$1").to_string();

    // Code blocks: ```...``` → remove
    let re_codeblock = Regex::new(r"(?s)```[^\n]*\n.*?```").unwrap();
    s = re_codeblock.replace_all(&s, "").to_string();

    // Inline code: `code` → code
    let re_code = Regex::new(r"`([^`]+)`").unwrap();
    s = re_code.replace_all(&s, "$1").to_string();

    // Strikethrough: ~~text~~ → text
    let re_strike = Regex::new(r"~~([^~]+)~~").unwrap();
    s = re_strike.replace_all(&s, "$1").to_string();

    // Bold/italic markers: **text** → text, *text* → text (keep text, remove markers)
    let re_bold = Regex::new(r"\*{1,3}([^*]+)\*{1,3}").unwrap();
    s = re_bold.replace_all(&s, "$1").to_string();
    let re_under = Regex::new(r"_{1,3}([^_]+)_{1,3}").unwrap();
    s = re_under.replace_all(&s, "$1").to_string();

    // HTML tags: <br>, <p>, etc → remove
    let re_html = Regex::new(r"<[^>]+>").unwrap();
    s = re_html.replace_all(&s, "").to_string();

    // Horizontal rules: --- / *** / ___ → newline separator
    let re_hr = Regex::new(r"(?m)^[\s]*([-*_]){3,}\s*$").unwrap();
    s = re_hr.replace_all(&s, "\n").to_string();

    // ── KEEP structural elements (headings, lists, blockquotes) ──
    // These are NOT stripped — they stay in the text for frontend rendering.

    // Collapse 3+ consecutive newlines → 2
    let re_lines = Regex::new(r"\n{3,}").unwrap();
    s = re_lines.replace_all(&s, "\n\n").to_string();

    s.trim().to_string()
}

fn truncate_content(content: String) -> String {
    if content.len() > MAX_CONTENT_LENGTH {
        let truncated: String = content.chars().take(MAX_CONTENT_LENGTH).collect();
        format!("{}...\n\n[内容已截断]", truncated)
    } else {
        content
    }
}

fn format_with_title(title: &Option<String>, content: &str) -> String {
    if let Some(t) = title {
        format!("# {}\n\n{}", t, content)
    } else {
        content.to_string()
    }
}

fn extract_markdown_title(markdown: &str) -> Option<String> {
    for line in markdown.lines().take(10) {
        let trimmed = line.trim();
        if trimmed.starts_with("# ") {
            return Some(trimmed.trim_start_matches('#').trim().to_string());
        }
    }
    None
}

// ─── WeChat helpers ────────────────────────────────────────────────

/// Extract item_show_type from WeChat HTML (0=article, 5=video, 7=gallery, 8=image, 10=channels video)
fn extract_wechat_show_type(html: &str) -> Option<u32> {
    // item_show_type = "10" or item_show_type = '10'
    for pat in &["item_show_type = \"", "item_show_type = '"] {
        if let Some(start) = html.find(pat) {
            let rest = &html[start + pat.len()..];
            let end = rest
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(rest.len());
            if end > 0 {
                if let Ok(n) = rest[..end].parse::<u32>() {
                    return Some(n);
                }
            }
        }
    }
    None
}

fn extract_wechat_title(html: &str) -> Option<String> {
    // msg_title = '...' (single quotes)
    if let Some(start) = html.find("msg_title = '") {
        let rest = &html[start + 13..];
        if let Some(end) = rest.find('\'') {
            let title = rest[..end].trim().to_string();
            if !title.is_empty() {
                return Some(html_decode(&title));
            }
        }
    }
    // msg_title = "..." (double quotes)
    if let Some(start) = html.find("msg_title = \"") {
        let rest = &html[start + 13..];
        if let Some(end) = rest.find('"') {
            let title = rest[..end].trim().to_string();
            if !title.is_empty() {
                return Some(html_decode(&title));
            }
        }
    }
    extract_og_title(html)
}

/// Extract article content from `content_noencode: JsDecode('...')` in newer WeChat format.
/// The content uses \x0a for newlines and contains HTML tags.
fn extract_wechat_content_noencode(html: &str) -> String {
    let marker = "content_noencode: JsDecode('";
    let start_idx = match html.find(marker) {
        Some(idx) => idx + marker.len(),
        None => return String::new(),
    };

    let rest = &html[start_idx..];
    // Find the closing ')  — the pattern is JsDecode('...')
    let end_idx = match rest.find("')") {
        Some(idx) => idx,
        None => return String::new(),
    };

    let raw = &rest[..end_idx];

    // Decode hex escapes: \x0a → newline, \x26 → &, \x3c → <, \x3e → >, etc.
    let decoded = raw
        .replace("\\x0a", "\n")
        .replace("\\x0d", "")
        .replace("\\x26", "&")
        .replace("\\x27", "'")
        .replace("\\x22", "\"")
        .replace("\\x3c", "<")
        .replace("\\x3e", ">");

    // Strip HTML tags
    let mut result = String::new();
    let mut in_tag = false;
    for ch in decoded.chars() {
        if result.len() > MAX_CONTENT_LENGTH {
            break;
        }
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
            }
            '\n' => {
                if !result.ends_with('\n') {
                    result.push('\n');
                }
            }
            _ => {
                if !in_tag {
                    result.push(ch);
                }
            }
        }
    }

    let text = html_decode(&result);
    text.lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn extract_wechat_content(html: &str) -> String {
    let marker = "id=\"js_content\"";
    let start_idx = match html.find(marker) {
        Some(idx) => idx,
        None => return String::new(),
    };

    let rest = &html[start_idx..];
    let content_start = match rest.find('>') {
        Some(idx) => start_idx + idx + 1,
        None => return String::new(),
    };

    let content_html = &html[content_start..];
    let mut result = String::new();
    let mut in_tag = false;
    let mut div_depth: i32 = 1;
    let mut chars = content_html.chars().peekable();

    while let Some(ch) = chars.next() {
        if result.len() > MAX_CONTENT_LENGTH {
            break;
        }
        match ch {
            '<' => {
                in_tag = true;
                let upcoming: String = chars.clone().take(10).collect();
                if upcoming.starts_with("div") || upcoming.starts_with("section") {
                    div_depth += 1;
                } else if upcoming.starts_with("/div") || upcoming.starts_with("/section") {
                    div_depth -= 1;
                    if div_depth <= 0 {
                        break;
                    }
                }
                if upcoming.starts_with("br")
                    || upcoming.starts_with("/p")
                    || upcoming.starts_with("/div")
                    || upcoming.starts_with("/section")
                {
                    if !result.ends_with('\n') {
                        result.push('\n');
                    }
                }
            }
            '>' => {
                in_tag = false;
            }
            _ => {
                if !in_tag {
                    result.push(ch);
                }
            }
        }
    }

    let decoded = html_decode(&result);
    decoded
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

// ─── Twitter helpers ───────────────────────────────────────────────

fn parse_twitter_url(url: &str) -> Option<(String, String)> {
    let clean = url
        .trim()
        .trim_end_matches('/')
        .split('?')
        .next()
        .unwrap_or(url);
    let parts: Vec<&str> = clean.split('/').collect();
    for i in 0..parts.len() {
        if parts[i] == "status" && i > 0 && i + 1 < parts.len() {
            let user = parts[i - 1].to_string();
            let id = parts[i + 1].to_string();
            if !user.is_empty() && !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
                return Some((user, id));
            }
        }
    }
    None
}

fn extract_twitter_article_content(article: &serde_json::Value) -> String {
    let mut lines = Vec::new();
    if let Some(blocks) = article
        .pointer("/content/blocks")
        .and_then(|v| v.as_array())
    {
        for block in blocks {
            let text = block.get("text").and_then(|v| v.as_str()).unwrap_or("");
            if text.is_empty() {
                continue;
            }
            let btype = block
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("unstyled");
            match btype {
                "header-one" => lines.push(format!("## {}", text)),
                "header-two" => lines.push(format!("### {}", text)),
                "header-three" => lines.push(format!("#### {}", text)),
                "blockquote" => lines.push(format!("> {}", text)),
                "ordered-list-item" | "unordered-list-item" => lines.push(format!("- {}", text)),
                "atomic" => {}
                _ => lines.push(text.to_string()),
            }
        }
    }
    lines.join("\n\n")
}

// ─── GitHub helpers ────────────────────────────────────────────────

/// Parse GitHub repo URL: https://github.com/owner/repo[/...]
fn parse_github_repo_url(url: &str) -> Option<(String, String)> {
    let clean = url
        .trim()
        .trim_end_matches('/')
        .split('?')
        .next()
        .unwrap_or(url);
    let parts: Vec<&str> = clean.split('/').collect();
    // Find "github.com" and get the next two segments
    for i in 0..parts.len() {
        if parts[i] == "github.com" && i + 2 < parts.len() {
            let owner = parts[i + 1].to_string();
            let repo = parts[i + 2].to_string();
            if !owner.is_empty()
                && !repo.is_empty()
                && owner != "."
                && repo != "."
                && !owner.starts_with('-')
            {
                return Some((owner, repo));
            }
        }
    }
    None
}

fn base64_decode(input: &str) -> Option<String> {
    // Simple base64 decoder for GitHub API responses
    let table = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut bytes = Vec::new();
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;

    for &b in input.as_bytes() {
        if b == b'=' || b == b'\n' || b == b'\r' || b == b' ' {
            continue;
        }
        let val = table.iter().position(|&c| c == b)? as u32;
        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }

    String::from_utf8(bytes).ok()
}

// ─── Generic HTML helpers ──────────────────────────────────────────

fn extract_og_description(html: &str) -> Option<String> {
    if let Some(start) = html.find("og:description") {
        let rest = &html[start..];
        if let Some(c_start) = rest.find("content=\"") {
            let c_rest = &rest[c_start + 9..];
            if let Some(end) = c_rest.find('"') {
                let desc = c_rest[..end].trim().to_string();
                if !desc.is_empty() {
                    return Some(html_decode(&desc));
                }
            }
        }
    }
    None
}

fn extract_og_title(html: &str) -> Option<String> {
    if let Some(start) = html.find("og:title") {
        let rest = &html[start..];
        if let Some(c_start) = rest.find("content=\"") {
            let c_rest = &rest[c_start + 9..];
            if let Some(end) = c_rest.find('"') {
                let title = c_rest[..end].trim().to_string();
                if !title.is_empty() {
                    return Some(html_decode(&title));
                }
            }
        }
    }
    None
}

fn extract_html_title(html: &str) -> Option<String> {
    // Try og:title first
    if let Some(t) = extract_og_title(html) {
        return Some(t);
    }
    // Try <title>...</title>
    if let Some(start) = html.find("<title>") {
        let rest = &html[start + 7..];
        if let Some(end) = rest.find("</title>") {
            let title = rest[..end].trim().to_string();
            if !title.is_empty() {
                return Some(html_decode(&title));
            }
        }
    }
    None
}

/// Strip all HTML tags and extract readable text from <body> or <article>.
fn strip_html_to_text(html: &str) -> String {
    // Try to find <article> or <main> or <body>
    let start_markers = ["<article", "<main", "<body"];
    let start_idx = start_markers
        .iter()
        .filter_map(|m| html.find(m))
        .min()
        .unwrap_or(0);

    let content_html = &html[start_idx..];
    let mut result = String::new();
    let mut in_tag = false;
    let mut in_script = false;
    let mut in_style = false;

    let bytes = content_html.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len && result.len() < MAX_CONTENT_LENGTH {
        let b = bytes[i];
        if b == b'<' {
            in_tag = true;
            // Check for <script or <style
            let upcoming = &content_html[i..std::cmp::min(i + 20, len)].to_lowercase();
            if upcoming.starts_with("<script") {
                in_script = true;
            } else if upcoming.starts_with("</script") {
                in_script = false;
            } else if upcoming.starts_with("<style") {
                in_style = true;
            } else if upcoming.starts_with("</style") {
                in_style = false;
            }
            // Block-level tags → newline
            if upcoming.starts_with("<br")
                || upcoming.starts_with("</p")
                || upcoming.starts_with("</div")
                || upcoming.starts_with("</h")
                || upcoming.starts_with("</li")
                || upcoming.starts_with("</tr")
            {
                if !result.ends_with('\n') {
                    result.push('\n');
                }
            }
            i += 1;
            continue;
        }
        if b == b'>' {
            in_tag = false;
            i += 1;
            continue;
        }
        if !in_tag && !in_script && !in_style {
            result.push(b as char);
        }
        i += 1;
    }

    let decoded = html_decode(&result);
    let lines: Vec<&str> = decoded
        .lines()
        .map(|l| l.trim())
        .filter(|l| l.len() > 1) // skip single-char noise
        .collect();
    lines.join("\n")
}

fn html_decode(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .replace("&#x27;", "'")
        .replace("&#x2F;", "/")
        .replace("&#x3D;", "=")
}

// ─── YouTube helpers ──────────────────────────────────────────────

/// Extract video ID from various YouTube URL formats:
/// - https://www.youtube.com/watch?v=VIDEO_ID
/// - https://youtu.be/VIDEO_ID
/// - https://www.youtube.com/embed/VIDEO_ID
/// - https://www.youtube.com/shorts/VIDEO_ID
fn extract_youtube_id(url: &str) -> Option<String> {
    use regex::Regex;

    // youtu.be/VIDEO_ID
    if url.contains("youtu.be/") {
        let re = Regex::new(r"youtu\.be/([a-zA-Z0-9_-]{11})").ok()?;
        return re
            .captures(url)
            .and_then(|c| c.get(1).map(|m| m.as_str().to_string()));
    }

    // youtube.com/watch?v=VIDEO_ID
    let re_v = Regex::new(r"[?&]v=([a-zA-Z0-9_-]{11})").ok()?;
    if let Some(cap) = re_v.captures(url) {
        return cap.get(1).map(|m| m.as_str().to_string());
    }

    // youtube.com/embed/VIDEO_ID or youtube.com/shorts/VIDEO_ID
    let re_path = Regex::new(r"youtube\.com/(?:embed|shorts)/([a-zA-Z0-9_-]{11})").ok()?;
    re_path
        .captures(url)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
}

fn extract_youtube_title(html: &str) -> Option<String> {
    // Try og:title first
    extract_og_title(html)
        .or_else(|| extract_html_title(html))
        .map(|t| {
            // Remove " - YouTube" suffix
            t.trim_end_matches(" - YouTube").trim().to_string()
        })
}

/// Format seconds to HH:MM:SS or MM:SS
fn format_timestamp(secs: f64) -> String {
    let total = secs as u64;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    if h > 0 {
        format!("{:02}:{:02}:{:02}", h, m, s)
    } else {
        format!("{:02}:{:02}", m, s)
    }
}

/// Extract chapters from YouTube video description.
/// Chapters are lines like "0:00 Introduction" or "01:23:45 Chapter title"
fn extract_youtube_chapters(html: &str) -> Vec<(f64, String)> {
    use regex::Regex;

    // Try to extract description from the page
    // YouTube stores it in "shortDescription":"..." in the initial data
    let re_desc = Regex::new(r#""shortDescription"\s*:\s*"((?:[^"\\]|\\.)*)""#).unwrap();
    let desc = match re_desc.captures(html) {
        Some(cap) => {
            let raw = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            // Unescape JSON string (\\n → \n, etc.)
            raw.replace("\\n", "\n")
                .replace("\\\"", "\"")
                .replace("\\\\", "\\")
        }
        None => return Vec::new(),
    };

    // Match chapter timestamp lines: "0:00 Title" or "1:23:45 Title"
    let re_chapter = Regex::new(r"(?m)^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$").unwrap();
    let mut chapters: Vec<(f64, String)> = Vec::new();

    for cap in re_chapter.captures_iter(&desc) {
        let ts_str = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let title = cap
            .get(2)
            .map(|m| m.as_str().trim().to_string())
            .unwrap_or_default();

        // Parse timestamp to seconds
        let parts: Vec<u64> = ts_str.split(':').filter_map(|p| p.parse().ok()).collect();
        let secs = match parts.len() {
            2 => parts[0] * 60 + parts[1],
            3 => parts[0] * 3600 + parts[1] * 60 + parts[2],
            _ => continue,
        };

        if !title.is_empty() {
            chapters.push((secs as f64, title));
        }
    }

    // Only treat as chapters if there are at least 2 entries and first starts near 0
    if chapters.len() >= 2 && chapters[0].0 < 10.0 {
        chapters
    } else {
        Vec::new()
    }
}

fn extract_youtube_description(html: &str) -> Option<String> {
    use regex::Regex;
    // Try og:description
    let re = Regex::new(r#"<meta\s+(?:property|name)="og:description"\s+content="([^"]*)"#).ok()?;
    re.captures(html)
        .and_then(|c| c.get(1))
        .map(|m| html_decode(m.as_str()))
        .filter(|s| !s.is_empty())
}

/// Extract a string field value from SSR JSON embedded in HTML.
/// Looks for "field":"value" pattern, handles escaped quotes.
fn extract_json_string_field(html: &str, field: &str) -> Option<String> {
    let pattern = format!("\"{}\":\"", field);
    let start = html.find(&pattern)? + pattern.len();
    let rest = &html[start..];
    // Find closing quote (not escaped)
    let mut end = 0;
    let chars: Vec<char> = rest.chars().collect();
    while end < chars.len() {
        if chars[end] == '"' && (end == 0 || chars[end - 1] != '\\') {
            break;
        }
        end += 1;
    }
    if end == 0 || end >= chars.len() {
        return None;
    }
    let value: String = chars[..end].iter().collect();
    let value = value.replace("\\\"", "\"");
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}
