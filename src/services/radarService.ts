import { invoke } from "@tauri-apps/api/core";

export interface RadarStatus {
  status: "fresh" | "analyzing" | "stale" | "empty" | "no_api_key" | "not_enough_content" | "error";
  insight: AttentionInsight | null;
  has_new_content: boolean;
}

export interface AttentionInsight {
  id: number;
  analysis_json: string | null;
  status: string;
  error_message: string | null;
  analyzed_at: string;
  window_start: string;
  window_end: string;
  content_count: number;
  model_used: string;
  is_current: boolean;
}

// v2 Briefing types
export interface BriefingTopic {
  id: string;
  rank: number;
  insight_title: string;
  deep_analysis: string;
  key_findings: string[];
  suggestion: string | null;
  evidence_indices: number[];
  content_count: number;
  span_days: number;
  trend: "growing" | "emerging" | "stable" | "fading";
  tag: "核心关注" | "次要关注" | "新兴关注" | "背景关注";
}

export interface BriefingAnalysis {
  format_version: number;
  topics: BriefingTopic[];
  meta: {
    total_content: number;
    window_days: number;
    analysis_depth: string;
  };
  id_map: Record<string, string>;
}

export async function getAttentionInsights(): Promise<RadarStatus> {
  return invoke<RadarStatus>("get_attention_insights");
}

export async function triggerAttentionAnalysis(): Promise<void> {
  return invoke("trigger_attention_analysis");
}
