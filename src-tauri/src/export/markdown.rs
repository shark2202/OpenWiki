use crate::storage::models::{CapturedContent, ContentType};
use crate::storage::repository::Repository;
use std::fs;
use std::path::{Path, PathBuf};

/// Convert a date string (e.g. "2026-03-19") to a Chinese weekday name.
fn weekday_chinese(date_str: &str) -> String {
    use chrono::NaiveDate;
    match NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
        Ok(date) => {
            use chrono::Datelike;
            match date.weekday() {
                chrono::Weekday::Mon => "周一".to_string(),
                chrono::Weekday::Tue => "周二".to_string(),
                chrono::Weekday::Wed => "周三".to_string(),
                chrono::Weekday::Thu => "周四".to_string(),
                chrono::Weekday::Fri => "周五".to_string(),
                chrono::Weekday::Sat => "周六".to_string(),
                chrono::Weekday::Sun => "周日".to_string(),
            }
        }
        Err(_) => String::new(),
    }
}

/// Generate markdown content for a single day, grouped by content type.
pub fn generate_day_markdown(
    date: &str,
    contents: &[CapturedContent],
    export_dir: &Path,
) -> Result<String, Box<dyn std::error::Error>> {
    let weekday = weekday_chinese(date);
    let mut md = format!("# {} {}\n\n", date, weekday);

    // Group contents by type
    let texts: Vec<&CapturedContent> = contents
        .iter()
        .filter(|c| matches!(c.content_type, ContentType::Text))
        .collect();
    let urls: Vec<&CapturedContent> = contents
        .iter()
        .filter(|c| matches!(c.content_type, ContentType::Url))
        .collect();
    let images: Vec<&CapturedContent> = contents
        .iter()
        .filter(|c| matches!(c.content_type, ContentType::Image))
        .collect();
    let mixed: Vec<&CapturedContent> = contents
        .iter()
        .filter(|c| matches!(c.content_type, ContentType::Mixed))
        .collect();

    // Text section
    if !texts.is_empty() {
        md.push_str("## 文本\n\n");
        for item in &texts {
            write_content_item(&mut md, item, export_dir);
        }
    }

    // URL section
    if !urls.is_empty() {
        md.push_str("## 链接\n\n");
        for item in &urls {
            write_content_item(&mut md, item, export_dir);
        }
    }

    // Image section
    if !images.is_empty() {
        md.push_str("## 图片\n\n");
        for item in &images {
            write_content_item(&mut md, item, export_dir);
        }
    }

    // Mixed section
    if !mixed.is_empty() {
        md.push_str("## 其他\n\n");
        for item in &mixed {
            write_content_item(&mut md, item, export_dir);
        }
    }

    Ok(md)
}

/// Write a single content item to the markdown string.
fn write_content_item(md: &mut String, item: &CapturedContent, export_dir: &Path) {
    let time = extract_time(&item.captured_at);
    md.push_str(&format!("### {} — {}\n\n", time, item.source_app));

    // Summary
    if let Some(summary) = &item.summary {
        if !summary.is_empty() {
            md.push_str(&format!("**摘要**: {}\n\n", summary));
        }
    }

    // Tags
    if let Some(tags) = &item.tags {
        if !tags.is_empty() {
            md.push_str(&format!("**标签**: {}\n\n", tags));
        }
    }

    // Source URL (for link type)
    if let Some(url) = &item.source_url {
        if !url.is_empty() {
            md.push_str(&format!("**链接**: [{}]({})\n\n", url, url));
        }
    }

    // Image (copy file + embed)
    if let Some(image_path) = &item.image_path {
        let src = Path::new(image_path);
        if src.exists() {
            if let Some(filename) = src.file_name() {
                let images_dir = export_dir.join("images");
                let _ = fs::create_dir_all(&images_dir);
                let dest = images_dir.join(filename);
                let _ = fs::copy(src, &dest);
                md.push_str(&format!(
                    "![image](../images/{})\n\n",
                    filename.to_string_lossy()
                ));
            }
        }
    }

    // Full original text / OCR text / fetched URL content
    if let Some(text) = &item.raw_text {
        if !text.is_empty() {
            match item.content_type {
                ContentType::Image => {
                    md.push_str("**OCR 识别文本**:\n\n");
                    md.push_str(text);
                    md.push_str("\n\n");
                }
                ContentType::Url => {
                    md.push_str("**原文内容**:\n\n");
                    md.push_str(text);
                    md.push_str("\n\n");
                }
                _ => {
                    md.push_str(text);
                    md.push_str("\n\n");
                }
            }
        }
    }

    // User note
    if let Some(note) = &item.user_note {
        if !note.is_empty() {
            md.push_str(&format!("> **备注**: {}\n\n", note));
        }
    }

    md.push_str("---\n\n");
}

/// Extract the HH:MM time portion from an ISO-8601 datetime string.
fn extract_time(datetime: &str) -> String {
    // captured_at is like "2026-03-19T14:30:00+08:00" or "2026-03-19 14:30:00"
    if let Some(t_pos) = datetime.find('T') {
        let time_part = &datetime[t_pos + 1..];
        return time_part.chars().take(5).collect();
    }
    if let Some(space_pos) = datetime.find(' ') {
        let time_part = &datetime[space_pos + 1..];
        return time_part.chars().take(5).collect();
    }
    String::new()
}

/// Export a single day's content to a markdown file.
pub fn export_day(
    date: &str,
    repo: &Repository,
    export_dir: &Path,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let contents = repo.get_content_for_date(date)?;
    if contents.is_empty() {
        return Err(format!("No content found for date {}", date).into());
    }

    let md = generate_day_markdown(date, &contents, export_dir)?;

    // Create month subdirectory, e.g. "2026-03/"
    let month_dir_name = if date.len() >= 7 { &date[..7] } else { date };
    let month_dir = export_dir.join(month_dir_name);
    fs::create_dir_all(&month_dir)?;

    let file_path = month_dir.join(format!("{}.md", date));
    fs::write(&file_path, md)?;

    Ok(file_path)
}

/// Export all dates that have content to markdown files.
/// Returns the number of files exported.
pub fn export_all(
    repo: &Repository,
    export_dir: &Path,
) -> Result<usize, Box<dyn std::error::Error>> {
    let dates = repo.get_dates_with_content()?;
    let mut count = 0;

    for (date, _cnt) in &dates {
        match export_day(date, repo, export_dir) {
            Ok(_) => count += 1,
            Err(e) => {
                log::warn!("Failed to export date {}: {}", date, e);
            }
        }
    }

    Ok(count)
}

/// Export content for a date range (inclusive) to markdown files.
/// Returns the number of files exported.
pub fn export_date_range(
    start: &str,
    end: &str,
    repo: &Repository,
    export_dir: &Path,
) -> Result<usize, Box<dyn std::error::Error>> {
    let dates = repo.get_dates_with_content()?;
    let mut count = 0;

    for (date, _cnt) in &dates {
        if date.as_str() >= start && date.as_str() <= end {
            match export_day(date, repo, export_dir) {
                Ok(_) => count += 1,
                Err(e) => {
                    log::warn!("Failed to export date {}: {}", date, e);
                }
            }
        }
    }

    Ok(count)
}

/// Export all content into a single markdown file, grouped by date.
/// Returns the file path of the exported file.
pub fn export_all_single_file(
    repo: &Repository,
    export_dir: &Path,
) -> Result<(PathBuf, usize), Box<dyn std::error::Error>> {
    let dates = repo.get_dates_with_content()?;
    export_dates_to_single_file(&dates, repo, export_dir, "小云-全部内容")
}

/// Export a date range into a single markdown file, grouped by date.
/// Returns the file path and content count.
pub fn export_range_single_file(
    start: &str,
    end: &str,
    repo: &Repository,
    export_dir: &Path,
) -> Result<(PathBuf, usize), Box<dyn std::error::Error>> {
    let dates = repo.get_dates_with_content()?;
    let filtered: Vec<(String, i64)> = dates
        .into_iter()
        .filter(|(d, _)| d.as_str() >= start && d.as_str() <= end)
        .collect();
    let filename = format!("小云-{}-至-{}", start, end);
    export_dates_to_single_file(&filtered, repo, export_dir, &filename)
}

/// Internal: merge multiple days into one markdown file.
fn export_dates_to_single_file(
    dates: &[(String, i64)],
    repo: &Repository,
    export_dir: &Path,
    filename: &str,
) -> Result<(PathBuf, usize), Box<dyn std::error::Error>> {
    fs::create_dir_all(export_dir)?;

    let mut md = String::new();
    let mut total_items = 0usize;

    for (date, _cnt) in dates {
        let contents = match repo.get_content_for_date(date) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if contents.is_empty() {
            continue;
        }
        total_items += contents.len();
        let day_md = generate_day_markdown(date, &contents, export_dir)?;
        md.push_str(&day_md);
        md.push('\n');
    }

    if md.is_empty() {
        return Err("没有可导出的内容".into());
    }

    let file_path = export_dir.join(format!("{}.md", filename));
    fs::write(&file_path, &md)?;
    log::info!(
        "Exported {} items to single file: {}",
        total_items,
        file_path.display()
    );

    Ok((file_path, total_items))
}
