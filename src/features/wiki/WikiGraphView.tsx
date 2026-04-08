import { useEffect, useRef, useCallback, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useWikiStore } from "../../stores/wikiStore";
import { WikiPageDetail } from "./WikiPageDetail";

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

export function WikiGraphView() {
  const { graphData, isLoadingGraph, loadGraph, selectedPage, selectPage, clearSelection, deletePage } = useWikiStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: Math.max(entry.contentRect.height, 400),
        });
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const handleNodeClick = useCallback((node: GraphNode) => {
    selectPage(node.id);
  }, [selectPage]);

  const nodeCanvasObject = useCallback((node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label = node.title;
    const fontSize = Math.max(11 / globalScale, 3);
    const nodeRadius = Math.max(4, 3 + (node.edge_count || 0) * 1.5);
    const color = TYPE_COLORS[node.page_type] || "#A8A29E";
    const alpha = node.status === "needs_recompile" ? 0.5 : 1.0;

    // Node circle
    ctx.beginPath();
    ctx.arc(node.x || 0, node.y || 0, nodeRadius, 0, 2 * Math.PI);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Label
    ctx.font = `${fontSize}px 'Plus Jakarta Sans', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(28, 25, 23, 0.8)";
    ctx.fillText(label, node.x || 0, (node.y || 0) + nodeRadius + 2);
  }, []);

  if (isLoadingGraph) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="text-center py-16">
        <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
          知识库还没有页面，暂无图谱可展示
        </p>
      </div>
    );
  }

  const nodes: GraphNode[] = graphData.nodes.map((n) => ({ ...n }));
  const links: GraphLink[] = graphData.edges.map((e) => ({
    source: e.source,
    target: e.target,
    relation: e.relation,
    weight: e.weight,
  }));

  return (
    <div ref={containerRef} className="relative rounded-xl overflow-hidden" style={{
      height: "calc(100vh - 200px)",
      backgroundColor: "var(--color-surface-raised, #F5F5F0)",
      border: "1px solid var(--color-border, #E7E5E4)",
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
        width={dimensions.width}
        height={dimensions.height}
        graphData={{ nodes, links }}
        nodeId="id"
        nodeCanvasObject={nodeCanvasObject as any}
        nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
          const r = Math.max(4, 3 + (node.edge_count || 0) * 1.5);
          ctx.beginPath();
          ctx.arc(node.x || 0, node.y || 0, r + 4, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        onNodeClick={handleNodeClick as any}
        linkColor={() => "rgba(168, 162, 158, 0.3)"}
        linkWidth={1}
        cooldownTicks={100}
        enableZoomInteraction={true}
        enablePanInteraction={true}
        backgroundColor="transparent"
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
