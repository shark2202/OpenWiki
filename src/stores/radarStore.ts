import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import {
  getAttentionInsights,
  triggerAttentionAnalysis,
  type RadarStatus,
  type BriefingAnalysis,
} from "../services/radarService";

interface RadarState {
  status: RadarStatus["status"];
  analysis: BriefingAnalysis | null;
  contentCount: number;
  hasNewContent: boolean;
  errorMessage: string | null;
  isLoading: boolean;
  selectedTopicIndex: number | null;

  loadRadar: () => Promise<void>;
  triggerAnalysis: () => Promise<void>;
  selectTopic: (index: number) => void;
  clearSelection: () => void;
  setupEventListener: () => Promise<() => void>;
}

export const useRadarStore = create<RadarState>((set, get) => ({
  status: "empty",
  analysis: null,
  contentCount: 0,
  hasNewContent: false,
  errorMessage: null,
  isLoading: true,
  selectedTopicIndex: null,

  loadRadar: async () => {
    set({ isLoading: true });
    try {
      const result = await getAttentionInsights();
      let analysis: BriefingAnalysis | null = null;
      if (result.insight?.analysis_json) {
        try {
          const raw = JSON.parse(result.insight.analysis_json);
          analysis = normalizeAnalysis(raw);
        } catch {
          analysis = null;
        }
      }

      set({
        status: result.status,
        analysis,
        contentCount: result.insight?.content_count ?? 0,
        hasNewContent: result.has_new_content,
        errorMessage: result.insight?.error_message ?? null,
        isLoading: false,
      });

      // Auto-trigger analysis if stale or empty
      if (result.status === "stale" || result.status === "empty") {
        get().triggerAnalysis();
      }
    } catch (e) {
      set({
        isLoading: false,
        status: "error",
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }
  },

  triggerAnalysis: async () => {
    set({ status: "analyzing" });
    try {
      await triggerAttentionAnalysis();
    } catch (e) {
      set({
        status: "error",
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }
  },

  selectTopic: (index: number) => {
    set({ selectedTopicIndex: index });
  },

  clearSelection: () => {
    set({ selectedTopicIndex: null });
  },

  setupEventListener: async () => {
    try {
      const unlisten = await listen<string>("attention-analysis-complete", () => {
        get().loadRadar();
      });
      return unlisten;
    } catch (e) {
      console.error("Failed to setup radar event listener:", e);
      return () => {};
    }
  },
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeAnalysis(raw: any): BriefingAnalysis | null {
  // v2 format: has "topics" key
  if (raw.topics && Array.isArray(raw.topics)) {
    return {
      format_version: raw.format_version ?? 2,
      topics: raw.topics.map((t: any) => ({
        id: t.id ?? "",
        rank: t.rank ?? 1,
        insight_title: t.insight_title ?? "",
        deep_analysis: t.deep_analysis ?? "",
        key_findings: Array.isArray(t.key_findings) ? t.key_findings : [],
        suggestion: t.suggestion ?? null,
        evidence_indices: Array.isArray(t.evidence_indices) ? t.evidence_indices : [],
        content_count: t.content_count ?? 0,
        span_days: t.span_days ?? 0,
        trend: t.trend ?? "stable",
        tag: t.tag ?? "核心关注",
      })),
      meta: {
        total_content: raw.meta?.total_content ?? 0,
        window_days: raw.meta?.window_days ?? 14,
        analysis_depth: raw.meta?.analysis_depth ?? "deep",
      },
      id_map: raw.id_map ?? {},
    };
  }

  // v1 format fallback: has "analysis.recurring_threads"
  const a = raw.analysis || raw;
  if (a.recurring_threads) {
    // Convert v1 to v2-like structure for display
    const topics: any[] = [];
    (a.recurring_threads || []).forEach((t: any, i: number) => {
      topics.push({
        id: `v1_thread_${i}`,
        rank: i + 1,
        insight_title: t.title || t.topic || "",
        deep_analysis: t.why_now || t.summary || t.description || "",
        key_findings: [],
        suggestion: null,
        evidence_indices: (t.evidence || []).map((e: any) => e.index ?? 0),
        content_count: (t.evidence || []).length,
        span_days: 14,
        trend: "stable" as const,
        tag: "核心关注" as const,
      });
    });
    return {
      format_version: 1,
      topics: topics.slice(0, 3),
      meta: { total_content: 0, window_days: 14, analysis_depth: "shallow" },
      id_map: raw.id_map ?? {},
    };
  }

  return null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
