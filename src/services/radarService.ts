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

export interface AttentionAnalysis {
  analysis: {
    recurring_threads: RecurringThread[];
    unexpected_connections: UnexpectedConnection[];
    new_obsessions: NewObsession[];
  };
  id_map: string[];
}

export interface RecurringThread {
  topic: string;
  title: string;
  why_now: string;
  evidence: EvidenceItem[];
}

export interface UnexpectedConnection {
  title: string;
  why_now: string;
  group_a: EvidenceGroup;
  group_b: EvidenceGroup;
}

export interface EvidenceGroup {
  topic: string;
  evidence: EvidenceItem[];
}

export interface NewObsession {
  topic: string;
  title: string;
  why_now: string;
  since_days: number;
  evidence: EvidenceItem[];
}

export interface EvidenceItem {
  index: number;
  title: string;
  date: string;
}

export async function getAttentionInsights(): Promise<RadarStatus> {
  return invoke<RadarStatus>("get_attention_insights");
}

export async function triggerAttentionAnalysis(): Promise<void> {
  return invoke("trigger_attention_analysis");
}
