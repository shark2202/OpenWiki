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

// v2 Briefing types (kept for backwards compat)
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

// v3 RadarReport types
export interface RadarMeta {
  date_range: string;
  total_items: number;
  active_days: number;
  annotated_items: number;
  annotation_rate: string;
  source_count: number;
}

export interface Glance {
  text: string;
  highlight: string;
}

export interface DietSource {
  name: string;
  count: number;
  percent: number;
  color: string;
}

export interface DepthRatio {
  deep: number;
  shallow: number;
  label: string;
}

export interface DominantTopic {
  name: string;
  percent: number;
  label: string;
}

export interface InfoDiet {
  sources: DietSource[];
  depth_ratio: DepthRatio;
  dominant_topic: DominantTopic;
  language_ratio?: { chinese: number; english: number };
  alert: string;
}

export interface SubconsciousItem {
  title: string;
  body: string;
  evidence_count?: number;
}

export interface GraveyardPick {
  rank: number;
  title: string;
  reason: string;
  tags: string[];
  source?: string;
  date?: string;
}

export interface Graveyard {
  forgotten_count?: number;
  forgotten_percent?: number;
  alert: string;
  top_picks: GraveyardPick[];
}

export interface BlindSpot {
  title: string;
  body: string;
}

export interface Action {
  icon: string;
  title: string;
  desc: string;
  ref: string;
  time: string;
}

export interface HeatmapDay {
  date: string;
  count: number;
  is_peak: boolean;
}

export interface TopicItem {
  name: string;
  percent: number;
}

export interface Verdict {
  text: string;
  highlights: string[];
}

export interface Footer {
  date_range: string;
  total: number;
  active_days: number;
  total_days: number;
}

export interface RadarReport {
  meta: RadarMeta;
  at_a_glance: Glance[];
  info_diet: InfoDiet;
  subconscious: SubconsciousItem[];
  graveyard: Graveyard;
  blind_spots: BlindSpot[];
  actions: Action[];
  heatmap: HeatmapDay[];
  topic_cloud: TopicItem[];
  verdict: Verdict;
  footer: Footer;
}

export async function getAttentionInsights(): Promise<RadarStatus> {
  return invoke<RadarStatus>("get_attention_insights");
}

export async function triggerAttentionAnalysis(): Promise<void> {
  return invoke("trigger_attention_analysis");
}

export async function exportCurrentRadarReport(): Promise<string> {
  return invoke<string>("export_current_radar_report");
}
