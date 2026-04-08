import { useEffect, useRef, useCallback, useState, useMemo, Component, type ReactNode } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useWikiStore } from "../../stores/wikiStore";
import { WikiPageDetail } from "./WikiPageDetail";

// Error boundary to prevent graph crashes from taking down the entire app
class GraphErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center py-16 gap-2">
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>图谱渲染出错</p>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{this.state.error}</p>
          <button onClick={() => this.setState({ error: null })}
            className="mt-2 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ color: "#F97316", backgroundColor: "#F9731615", border: "1px solid #F9731630" }}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const TYPE_COLORS: Record<string, string> = {
  concept: "#F97316",
  entity: "#2563EB",
  source: "#16A34A",
  comparison: "#CA8A04",
  overview: "#7C3AED",
};

interface GraphNode {
  id: string;
  title: string;
  page_type: string;
  status: string;
  confidence: number;
  edge_count: number;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  relation: string;
  weight: number;
}

function WikiGraphViewInner() {
  const { graphData, isLoadingGraph, loadGraph, selectedPage, selectPage, clearSelection, deletePage } = useWikiStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    // Use ResizeObserver as single source of truth — it fires after layout
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        const h = Math.floor(entry.contentRect.height);
        if (w > 0 && h > 0) {
          setDimensions({ width: w, height: h });
        }
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const handleNodeClick = useCallback((node: GraphNode) => {
    selectPage(node.id);
  }, [selectPage]);

  const nodeCanvasObject = useCallback((node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label = node.title;
    const nodeRadius = Math.max(6, 5 + (node.edge_count || 0) * 2);
    const color = TYPE_COLORS[node.page_type] || "#A8A29E";
    const alpha = node.status === "needs_recompile" ? 0.5 : 1.0;

    // Node circle
    ctx.beginPath();
    ctx.arc(node.x || 0, node.y || 0, nodeRadius, 0, 2 * Math.PI);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Label — only show when zoomed in enough to read
    if (globalScale > 0.6) {
      const fontSize = Math.min(12 / globalScale, 14);
      ctx.font = `${fontSize}px 'Plus Jakarta Sans', sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const isDark = document.documentElement.classList.contains("dark");
      const labelAlpha = Math.min((globalScale - 0.6) / 0.4, 1); // fade in between 0.6-1.0
      ctx.fillStyle = isDark
        ? `rgba(250, 250, 248, ${0.8 * labelAlpha})`
        : `rgba(28, 25, 23, ${0.8 * labelAlpha})`;
      ctx.fillText(label, node.x || 0, (node.y || 0) + nodeRadius + 2);
    }
  }, []);

  // useMemo MUST be before any early returns to keep hook count stable
  const graphInput = useMemo(() => {
    if (!graphData || graphData.nodes.length === 0) return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
    return {
      nodes: graphData.nodes.map((n) => ({ ...n })) as GraphNode[],
      links: graphData.edges.map((e) => ({
        source: e.source,
        target: e.target,
        relation: e.relation,
        weight: e.weight,
      })) as GraphLink[],
    };
  }, [graphData]);

  // Configure forces: moderate repulsion + center pull for compact circular layout
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;
    fg.d3Force("charge")?.strength(-120).distanceMax(350);
    fg.d3Force("link")?.distance(50);
    fg.d3Force("center")?.strength(0.1);
    fg.d3ReheatSimulation();
  }, [graphInput]);

  if (isLoadingGraph) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (graphInput.nodes.length === 0) {
    return (
      <div className="text-center py-16">
        <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
          知识库还没有页面，暂无图谱可展示
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative rounded-xl overflow-hidden" style={{
      height: "calc(100vh - 170px)",
      backgroundColor: document.documentElement.classList.contains("dark") ? "#1C1917" : "#F5F5F0",
      border: "1px solid var(--color-border, #E7E5E4)",
      marginTop: 8,
    }}>
      {/* Legend */}
      <div className="absolute top-3 left-3 z-10 flex gap-3">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
              {type === "concept" ? "概念" : type === "entity" ? "实体" : type === "source" ? "来源" : type === "comparison" ? "对比" : "总览"}
            </span>
          </div>
        ))}
      </div>

      <ForceGraph2D
        ref={graphRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphInput}
        nodeId="id"
        nodeCanvasObject={nodeCanvasObject as any}
        nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
          const r = Math.max(6, 5 + (node.edge_count || 0) * 2);
          ctx.beginPath();
          ctx.arc(node.x || 0, node.y || 0, r + 4, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        onNodeClick={handleNodeClick as any}
        linkColor={() => document.documentElement.classList.contains("dark") ? "rgba(168, 162, 158, 0.3)" : "rgba(120, 113, 108, 0.4)"}
        linkWidth={0.5}
        cooldownTicks={200}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        dagLevelDistance={80}
        enableZoomInteraction={true}
        enablePanInteraction={true}
        backgroundColor={document.documentElement.classList.contains("dark") ? "#1C1917" : "#F5F5F0"}
        onEngineStop={() => {}}
      />

      {selectedPage && (
        <WikiPageDetail
          page={selectedPage}
          onClose={clearSelection}
          onDelete={(id) => { deletePage(id); clearSelection(); loadGraph(); }}
        />
      )}
    </div>
  );
}

// Wrapped export with error boundary
const _WikiGraphViewInner = WikiGraphViewInner;
export function WikiGraphView() {
  return (
    <GraphErrorBoundary>
      <_WikiGraphViewInner />
    </GraphErrorBoundary>
  );
}
