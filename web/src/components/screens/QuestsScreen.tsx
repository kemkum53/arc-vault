"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Icon, Chip } from "@/components/ui";
import { TRADERS } from "@/lib/constants";
import { useT } from "@/lib/i18n";
import type { DisplayQuest, TraderKey } from "@/lib/types";

interface QuestsScreenProps {
  quests: DisplayQuest[];
}

const NODE_W = 160;
const NODE_H = 44;
const GAP_X = 32;
const GAP_Y = 56;
const PAD = 60;

interface NodePos {
  quest: DisplayQuest;
  x: number;
  y: number;
}

function layoutTree(quests: DisplayQuest[]): { nodes: NodePos[]; width: number; height: number } {
  const maxDepth = Math.max(...quests.map(q => q.depth), 0);

  const columns: DisplayQuest[][] = [];
  for (let d = 0; d <= maxDepth; d++) {
    columns[d] = quests.filter(q => q.depth === d);
  }

  const maxCol = Math.max(...columns.map(c => c.length), 1);
  const totalWidth = maxCol * NODE_W + (maxCol - 1) * GAP_X + PAD * 2;

  const nodes: NodePos[] = [];
  for (let d = 0; d <= maxDepth; d++) {
    const col = columns[d];
    const colWidth = col.length * NODE_W + (col.length - 1) * GAP_X;
    const startX = (totalWidth - colWidth) / 2;
    const y = PAD + d * (NODE_H + GAP_Y);
    col.forEach((q, i) => {
      nodes.push({ quest: q, x: startX + i * (NODE_W + GAP_X), y });
    });
  }

  const width = totalWidth;
  const height = PAD * 2 + (maxDepth + 1) * NODE_H + maxDepth * GAP_Y;

  return { nodes, width, height };
}

function QuestTooltip({ quest, x, y }: { quest: DisplayQuest; x: number; y: number }) {
  const trader = TRADERS[quest.trader as TraderKey] || { color: "var(--fg-3)", name: quest.traderName };

  return (
    <div style={{
      position: "fixed", left: x + 12, top: y - 10,
      background: "var(--bg-2)", border: `1px solid ${trader.color}50`,
      borderRadius: "var(--radius-md)", padding: "14px 16px",
      width: 280, zIndex: 100,
      boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
      pointerEvents: "none",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          padding: "2px 8px", borderRadius: 999, fontFamily: "var(--font-mono)",
          fontSize: 9, fontWeight: 700, color: trader.color, background: `${trader.color}1f`,
          textTransform: "uppercase", letterSpacing: "0.14em",
        }}>{trader.name}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-5)" }}>{quest.map}</span>
        {quest.completed && <Icon name="check-circle-2" size={13} style={{ color: "#4caf50", marginLeft: "auto" }} />}
      </div>
      <div style={{
        fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14,
        color: "var(--fg-1)", lineHeight: 1.3,
      }}>{quest.name}</div>
      {quest.objective && (
        <div style={{
          fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--fg-3)",
          lineHeight: 1.45, maxHeight: 54, overflow: "hidden",
        }}>{quest.objective}</div>
      )}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        fontFamily: "var(--font-mono)", fontSize: 11,
      }}>
        <span style={{ color: "var(--fg-4)" }}>+{quest.xp.toLocaleString()} xp</span>
        <div style={{
          flex: 1, height: 4, background: "var(--bg-4)", borderRadius: 2, overflow: "hidden",
        }}>
          <div style={{
            height: "100%", borderRadius: 2,
            width: `${quest.target > 0 ? (quest.progress / quest.target) * 100 : 0}%`,
            background: quest.completed ? "#4caf50" : trader.color,
          }} />
        </div>
        <span style={{ color: quest.completed ? "#4caf50" : "var(--fg-4)" }}>
          {quest.progress}/{quest.target}
        </span>
      </div>
      {quest.reward.length > 0 && (
        <div style={{
          display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 4,
          borderTop: "1px solid var(--border)",
        }}>
          {quest.reward.map((r, i) => (
            <span key={i} style={{
              padding: "2px 6px", background: "rgba(255,255,255,0.03)",
              border: "1px solid var(--border-strong)", borderRadius: 3,
              fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)",
            }}>{r.qty ? `${r.qty}x ` : ""}{r.item}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function QuestsScreen({ quests }: QuestsScreenProps) {
  const t = useT();
  const [traderFilter, setTraderFilter] = useState("all");
  const [hovered, setHovered] = useState<{ quest: DisplayQuest; mx: number; my: number } | null>(null);
  const [, forceRender] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(0.65);
  const panRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const zoom = zoomRef.current;
  const pan = panRef.current;

  const rerender = useCallback(() => forceRender(n => n + 1), []);

  const traders = [
    { id: "all", name: t("quest.all"), color: "var(--fg-2)" },
    { id: "shani", name: "Shani", color: TRADERS.shani.color },
    { id: "celeste", name: "Celeste", color: TRADERS.celeste.color },
    { id: "apollo", name: "Apollo", color: TRADERS.apollo.color },
    { id: "lance", name: "Lance", color: TRADERS.lance.color },
    { id: "tian", name: "Tian Wen", color: TRADERS.tian.color },
  ];

  const completed = quests.filter(q => q.completed);
  const inProgress = quests.filter(q => !q.completed);

  const { nodes, width, height } = layoutTree(quests);
  const nodeById = new Map(nodes.map(n => [n.quest.id, n]));

  // Native wheel event for preventDefault
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const oldZoom = zoomRef.current;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(2, Math.max(0.15, oldZoom * factor));
      const scale = newZoom / oldZoom;
      panRef.current = {
        x: mx - scale * (mx - panRef.current.x),
        y: my - scale * (my - panRef.current.y),
      };
      zoomRef.current = newZoom;
      rerender();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [rerender]);

  // Pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    draggingRef.current = true;
    dragStartRef.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (draggingRef.current) {
      panRef.current = { x: e.clientX - dragStartRef.current.x, y: e.clientY - dragStartRef.current.y };
      rerender();
    }
  }, [rerender]);

  const handleMouseUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  // Fit to screen
  const fitToScreen = useCallback(() => {
    if (!containerRef.current) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const scaleX = cw / width;
    const scaleY = ch / height;
    const newZoom = Math.min(scaleX, scaleY, 1) * 0.9;
    zoomRef.current = newZoom;
    panRef.current = {
      x: (cw - width * newZoom) / 2,
      y: (ch - height * newZoom) / 2,
    };
    rerender();
  }, [width, height, rerender]);

  useEffect(() => {
    fitToScreen();
  }, [fitToScreen]);

  // Edges
  const edges: { from: NodePos; to: NodePos; color: string; dimmed: boolean }[] = [];
  for (const node of nodes) {
    const q = node.quest;
    const trader = TRADERS[q.trader as TraderKey] || { color: "var(--fg-3)" };
    for (const nxtId of q.nextQuests) {
      const toNode = nodeById.get(nxtId);
      if (toNode) {
        const dim = traderFilter !== "all" && q.trader !== traderFilter && toNode.quest.trader !== traderFilter;
        edges.push({ from: node, to: toNode, color: trader.color, dimmed: dim });
      }
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      {/* Filter bar */}
      <div style={{
        display: "flex", gap: 8, padding: "10px 14px", flexWrap: "wrap",
        background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
        flexShrink: 0, alignItems: "center",
      }}>
        {traders.map(t => {
          const active = t.id === traderFilter;
          return (
            <button key={t.id} onClick={() => setTraderFilter(t.id)} style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px",
              border: `1px solid ${active ? t.color : "var(--border-strong)"}`,
              background: active ? `${t.color}1a` : "transparent", borderRadius: 999,
              color: active ? t.color : "var(--fg-3)",
              fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 11, cursor: "pointer",
              transition: "all 180ms",
            }}>
              {t.id !== "all" && <span style={{ width: 7, height: 7, borderRadius: 999, background: t.color }} />}
              {t.name}
            </button>
          );
        })}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <Chip tone="brand">{inProgress.length} {t("quest.active")}</Chip>
          <Chip tone="success">{completed.length} {t("quest.completed")}</Chip>
        </div>
      </div>

      {/* Tree canvas */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { draggingRef.current = false; setHovered(null); }}
        style={{
          flex: 1, overflow: "hidden", background: "var(--bg-0)",
          border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
          position: "relative",
          cursor: draggingRef.current ? "grabbing" : "grab",
          userSelect: "none",
        }}
      >
        <svg
          width="100%"
          height="100%"
          style={{ position: "absolute", inset: 0 }}
        >
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Grid dots */}
            <defs>
              <pattern id="grid" width={40} height={40} patternUnits="userSpaceOnUse">
                <circle cx={20} cy={20} r={0.8} fill="var(--fg-5)" opacity={0.3} />
              </pattern>
            </defs>
            <rect x={-2000} y={-2000} width={width + 4000} height={height + 4000} fill="url(#grid)" />

            {/* Arrow marker */}
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                <path d="M 0 0 L 8 3 L 0 6 z" fill="var(--fg-4)" opacity={0.5} />
              </marker>
              <marker id="arrowhead-hl" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                <path d="M 0 0 L 8 3 L 0 6 z" fill="currentColor" />
              </marker>
            </defs>

            {/* Edges */}
            {edges.map((edge, i) => {
              const x1 = edge.from.x + NODE_W / 2;
              const y1 = edge.from.y + NODE_H;
              const x2 = edge.to.x + NODE_W / 2;
              const y2 = edge.to.y;
              const midY = (y1 + y2) / 2;

              const isHighlighted = hovered && (edge.from.quest.id === hovered.quest.id || edge.to.quest.id === hovered.quest.id);
              const bothCompleted = edge.from.quest.completed && edge.to.quest.completed;

              return (
                <path
                  key={i}
                  d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                  fill="none"
                  stroke={isHighlighted ? edge.color : bothCompleted ? "#4caf50" : edge.dimmed ? "var(--fg-5)" : "var(--fg-4)"}
                  strokeWidth={isHighlighted ? 3 : 2}
                  opacity={edge.dimmed ? 0.08 : isHighlighted ? 0.95 : bothCompleted ? 0.35 : 0.4}
                  markerEnd={isHighlighted ? "url(#arrowhead-hl)" : "url(#arrowhead)"}
                  style={isHighlighted ? { color: edge.color } : undefined}
                />
              );
            })}

            {/* Nodes */}
            {nodes.map(node => {
              const q = node.quest;
              const trader = TRADERS[q.trader as TraderKey] || { color: "var(--fg-3)", name: q.traderName };
              const dimmed = traderFilter !== "all" && q.trader !== traderFilter;
              const isHovered = hovered?.quest.id === q.id;
              const done = q.completed;

              return (
                <g
                  key={q.id}
                  onMouseEnter={(e) => !draggingRef.current && setHovered({ quest: q, mx: e.clientX, my: e.clientY })}
                  onMouseMove={(e) => !draggingRef.current && hovered?.quest.id === q.id && setHovered({ quest: q, mx: e.clientX, my: e.clientY })}
                  onMouseLeave={() => setHovered(h => h?.quest.id === q.id ? null : h)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Glow */}
                  {isHovered && !dimmed && (
                    <rect
                      x={node.x - 3} y={node.y - 3}
                      width={NODE_W + 6} height={NODE_H + 6}
                      rx={9} fill="none"
                      stroke={done ? "#4caf50" : trader.color} strokeWidth={1.5} opacity={0.4}
                    />
                  )}
                  {/* Card */}
                  <rect
                    x={node.x} y={node.y}
                    width={NODE_W} height={NODE_H}
                    rx={6}
                    fill={dimmed ? "var(--bg-1)" : done ? "rgba(76,175,80,0.08)" : "var(--bg-2)"}
                    stroke={dimmed ? "var(--border)" : done ? "#4caf50" : isHovered ? `${trader.color}80` : "var(--border)"}
                    strokeWidth={done ? 1.5 : 1}
                    opacity={dimmed ? 0.2 : done ? 0.75 : 1}
                  />
                  {/* Left accent */}
                  <rect
                    x={node.x} y={node.y}
                    width={3} height={NODE_H}
                    rx={1}
                    fill={done ? "#4caf50" : trader.color}
                    opacity={dimmed ? 0.15 : done ? 0.6 : 0.7}
                  />
                  {/* Completed badge */}
                  {done && !dimmed && (
                    <>
                      <rect
                        x={node.x + NODE_W - 28} y={node.y + 6}
                        width={22} height={14} rx={3}
                        fill="rgba(76,175,80,0.18)" stroke="#4caf50" strokeWidth={0.8}
                      />
                      <text x={node.x + NODE_W - 17} y={node.y + 16} textAnchor="middle" fill="#4caf50" fontSize={9} fontWeight={700}>✓</text>
                    </>
                  )}
                  {/* Name */}
                  <text
                    x={node.x + 10} y={node.y + 18}
                    fill={dimmed ? "var(--fg-5)" : done ? "var(--fg-3)" : "var(--fg-1)"}
                    fontSize={11} fontWeight={done ? 500 : 600}
                    fontFamily="var(--font-ui)"
                    textDecoration={done ? "line-through" : undefined}
                  >
                    {q.name.length > (done ? 15 : 18) ? q.name.slice(0, done ? 13 : 16) + "…" : q.name}
                  </text>
                  {/* Trader label */}
                  <text
                    x={node.x + 10} y={node.y + 34}
                    fill={dimmed ? "var(--fg-5)" : done ? "#4caf50" : trader.color}
                    fontSize={9} fontFamily="var(--font-mono)"
                    opacity={dimmed ? 0.3 : done ? 0.5 : 0.65}
                  >
                    {trader.name}
                  </text>
                  {/* XP */}
                  {!dimmed && (
                    <text
                      x={node.x + NODE_W - (done ? 32 : 8)} y={node.y + 34}
                      fill={done ? "var(--fg-5)" : "var(--fg-5)"} fontSize={8} fontFamily="var(--font-mono)"
                      textAnchor="end"
                      opacity={done ? 0.5 : 1}
                    >
                      +{q.xp}xp
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Zoom controls */}
        <div style={{
          position: "absolute", left: 14, bottom: 14,
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          <button onClick={() => { zoomRef.current = Math.min(2, zoom + 0.15); rerender(); }} className="av-icon-btn" style={{ width: 32, height: 32 }}>
            <Icon name="plus" size={14} />
          </button>
          <button onClick={() => { zoomRef.current = Math.max(0.15, zoom - 0.15); rerender(); }} className="av-icon-btn" style={{ width: 32, height: 32 }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>−</span>
          </button>
          <button onClick={fitToScreen} className="av-icon-btn" style={{ width: 32, height: 32 }} title={t("quest.fitScreen")}>
            <Icon name="monitor" size={14} />
          </button>
        </div>

        {/* Zoom label */}
        <div style={{
          position: "absolute", right: 14, bottom: 14,
          fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-5)",
          background: "var(--bg-2)", padding: "3px 8px", borderRadius: 4,
          border: "1px solid var(--border)",
        }}>
          {Math.round(zoom * 100)}%
        </div>

        {/* Tooltip */}
        {hovered && !draggingRef.current && (
          <QuestTooltip quest={hovered.quest} x={hovered.mx} y={hovered.my} />
        )}
      </div>
    </div>
  );
}
