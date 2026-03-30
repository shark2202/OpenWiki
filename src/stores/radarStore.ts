import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import {
  getAttentionInsights,
  triggerAttentionAnalysis,
  type RadarStatus,
  type AttentionAnalysis,
} from "../services/radarService";

interface RadarState {
  status: RadarStatus["status"];
  analysis: AttentionAnalysis | null;
  contentCount: number;
  hasNewContent: boolean;
  errorMessage: string | null;
  isLoading: boolean;
  selectedInsight: { type: string; index: number } | null;

  loadRadar: () => Promise<void>;
  triggerAnalysis: () => Promise<void>;
  selectInsight: (type: string, index: number) => void;
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
  selectedInsight: null,

  loadRadar: async () => {
    set({ isLoading: true });
    try {
      const result = await getAttentionInsights();
      let analysis: AttentionAnalysis | null = null;
      if (result.insight?.analysis_json) {
        try {
          analysis = JSON.parse(result.insight.analysis_json) as AttentionAnalysis;
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

  selectInsight: (type: string, index: number) => {
    set({ selectedInsight: { type, index } });
  },

  clearSelection: () => {
    set({ selectedInsight: null });
  },

  setupEventListener: async () => {
    const unlisten = await listen<string>("attention-analysis-complete", () => {
      get().loadRadar();
    });
    return unlisten;
  },
}));
