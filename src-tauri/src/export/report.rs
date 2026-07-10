use crate::ai::attention_analyzer::{validate_radar_report, RadarReport};
use crate::storage::models::AttentionInsight;
use crate::storage::repository::Repository;
use std::fs;
use std::path::{Path, PathBuf};

pub fn export_current_radar_report(
    repo: &Repository,
    export_dir: &Path,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let insight = repo
        .get_current_insight()?
        .ok_or("No radar report available to export")?;

    if insight.status != "complete" && insight.status != "completed" {
        return Err("The current radar report is not ready yet".into());
    }

    let analysis_json = insight
        .analysis_json
        .as_deref()
        .ok_or("The current radar report has no analysis content")?;
    let report = validate_radar_report(analysis_json)?;

    fs::create_dir_all(export_dir)?;

    let start = date_part(&insight.window_start);
    let end = date_part(&insight.window_end);
    let filename = format!(
        "OpenWiki-Radar-{}-to-{}.md",
        sanitize_filename_part(&start),
        sanitize_filename_part(&end)
    );
    let path = export_dir.join(filename);
    fs::write(&path, generate_radar_report_markdown(&report, &insight))?;

    Ok(path)
}

fn generate_radar_report_markdown(report: &RadarReport, insight: &AttentionInsight) -> String {
    let mut md = String::new();

    md.push_str("# OpenWiki Radar Report\n\n");
    md.push_str(&format!("- Date range: {}\n", report.meta.date_range));
    md.push_str(&format!("- Generated at: {}\n", insight.analyzed_at));
    md.push_str(&format!("- Model: {}\n", insight.model_used));
    md.push_str(&format!("- Items analyzed: {}\n", insight.content_count));
    md.push('\n');

    md.push_str("## At a Glance\n\n");
    for item in &report.at_a_glance {
        md.push_str(&format!("- **{}**: {}\n", item.highlight, item.text));
    }
    md.push('\n');

    md.push_str("## Info Diet\n\n");
    md.push_str(&format!("- Alert: {}\n", report.info_diet.alert));
    md.push_str(&format!(
        "- Depth ratio: {} (deep {:.0}%, shallow {:.0}%)\n",
        report.info_diet.depth_ratio.label,
        report.info_diet.depth_ratio.deep,
        report.info_diet.depth_ratio.shallow
    ));
    md.push_str(&format!(
        "- Dominant topic: {} ({:.0}%) - {}\n",
        report.info_diet.dominant_topic.name,
        report.info_diet.dominant_topic.percent,
        report.info_diet.dominant_topic.label
    ));
    if let Some(language_ratio) = &report.info_diet.language_ratio {
        md.push_str(&format!(
            "- Language ratio: Chinese {:.0}%, English {:.0}%\n",
            language_ratio.chinese, language_ratio.english
        ));
    }
    md.push('\n');
    md.push_str("| Source | Count | Percent |\n");
    md.push_str("|---|---:|---:|\n");
    for source in &report.info_diet.sources {
        md.push_str(&format!(
            "| {} | {} | {:.0}% |\n",
            escape_table_cell(&source.name),
            source.count,
            source.percent
        ));
    }
    md.push('\n');

    md.push_str("## Subconscious Themes\n\n");
    for item in &report.subconscious {
        md.push_str(&format!("### {}\n\n{}\n\n", item.title, item.body));
        if let Some(count) = item.evidence_count {
            md.push_str(&format!("Evidence count: {}\n\n", count));
        }
    }

    md.push_str("## Graveyard\n\n");
    md.push_str(&format!("{}\n\n", report.graveyard.alert));
    if let Some(count) = report.graveyard.forgotten_count {
        md.push_str(&format!("- Forgotten items: {}\n", count));
    }
    if let Some(percent) = report.graveyard.forgotten_percent {
        md.push_str(&format!("- Forgotten ratio: {:.0}%\n", percent));
    }
    if report.graveyard.forgotten_count.is_some() || report.graveyard.forgotten_percent.is_some() {
        md.push('\n');
    }
    for pick in &report.graveyard.top_picks {
        md.push_str(&format!("### {}. {}\n\n", pick.rank, pick.title));
        md.push_str(&format!("{}\n\n", pick.reason));
        if !pick.tags.is_empty() {
            md.push_str(&format!("- Tags: {}\n", pick.tags.join(", ")));
        }
        if let Some(source) = &pick.source {
            md.push_str(&format!("- Source: {}\n", source));
        }
        if let Some(date) = &pick.date {
            md.push_str(&format!("- Date: {}\n", date));
        }
        md.push('\n');
    }

    md.push_str("## Blind Spots\n\n");
    for item in &report.blind_spots {
        md.push_str(&format!("### {}\n\n{}\n\n", item.title, item.body));
    }

    md.push_str("## Suggested Actions\n\n");
    for item in &report.actions {
        md.push_str(&format!("### {}\n\n{}\n\n", item.title, item.desc));
        if !item.action_ref.trim().is_empty() {
            md.push_str(&format!("- Reference: {}\n", item.action_ref));
        }
        if !item.time.trim().is_empty() {
            md.push_str(&format!("- Time: {}\n", item.time));
        }
        md.push('\n');
    }

    md.push_str("## Activity Heatmap\n\n");
    md.push_str("| Date | Count | Peak |\n");
    md.push_str("|---|---:|---|\n");
    for day in &report.heatmap {
        md.push_str(&format!(
            "| {} | {} | {} |\n",
            day.date,
            day.count,
            if day.is_peak { "yes" } else { "" }
        ));
    }
    md.push('\n');

    md.push_str("## Topic Cloud\n\n");
    md.push_str("| Topic | Percent |\n");
    md.push_str("|---|---:|\n");
    for topic in &report.topic_cloud {
        md.push_str(&format!(
            "| {} | {:.0}% |\n",
            escape_table_cell(&topic.name),
            topic.percent
        ));
    }
    md.push('\n');

    md.push_str("## Verdict\n\n");
    md.push_str(&format!("{}\n\n", report.verdict.text));
    if !report.verdict.highlights.is_empty() {
        md.push_str("Highlights:\n\n");
        for highlight in &report.verdict.highlights {
            md.push_str(&format!("- {}\n", highlight));
        }
        md.push('\n');
    }

    md.push_str("---\n\n");
    md.push_str(&format!(
        "OpenWiki - {} - {} items - {} active days / {} days\n",
        report.footer.date_range, report.footer.total, report.footer.active_days, report.footer.total_days
    ));

    md
}

fn date_part(value: &str) -> String {
    value.get(0..10).unwrap_or(value).to_string()
}

fn sanitize_filename_part(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches('-');
    if trimmed.is_empty() {
        "report".to_string()
    } else {
        trimmed.to_string()
    }
}

fn escape_table_cell(value: &str) -> String {
    value.replace('|', "\\|").replace('\n', " ")
}
