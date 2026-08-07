import type { TopologyGraph, TopologyRole } from '@/lib/topology-extractor'

// Phase 9 — hand-rolled SVG topology layout for the PDF export.
//
// PROJECT_PLAN pins two renderers on ONE data source: react-flow for the
// interactive canvas, a hand-rolled SVG for print. This module is the print
// half. It deliberately produces *pure geometry* — plain numbers, no JSX and
// no react-pdf import — so the layout can be unit-tested and snapshotted
// without a PDF engine (Open Risk #3: the two renderers must not drift).
//
// The interactive canvas uses elkjs for layered auto-layout. That's overkill
// here and it's async, so print uses a deterministic layered layout instead:
//
//   IPN row (spans all pods)
//   ┌ pod 0 ────────────────┐
//   │ spine row             │
//   │ leaf rows (wrapped)   │
//   └───────────────────────┘
//   ┌ pod 1 ────────────────┐  …
//
// Single-pod designs are laid out as one unlabelled block, so the same code
// path serves both without a branch at the call site.

export interface PdfTopologyNodeBox {
  id: string
  role: TopologyRole
  label: string
  x: number
  y: number
  w: number
  h: number
  pod_index: number | null
}

export interface PdfTopologyEdgeLine {
  /** `${source}->${target}`; port-level links are collapsed to device pairs. */
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  /** How many port-level cable links this one line stands for. */
  count: number
}

export interface PdfTopologyPodBox {
  pod_index: number
  label: string
  x: number
  y: number
  w: number
  h: number
}

export interface PdfTopologyLayout {
  width: number
  height: number
  nodes: PdfTopologyNodeBox[]
  edges: PdfTopologyEdgeLine[]
  pods: PdfTopologyPodBox[]
  /** Non-null when edges were dropped to keep the drawing legible. */
  edges_omitted: { pairs: number; links: number } | null
  /** Node counts by role, for the caption under the diagram. */
  counts: { spine: number; leaf: number; ipn: number }
}

export interface PdfTopologyOptions {
  /** Drawing width in PDF points. */
  width: number
  /** Skip drawing edges past this many unique device pairs. */
  maxEdgePairs?: number
}

const IDEAL_NODE_W = 46
const MIN_NODE_W = 11
const NODE_H = 16
const NODE_GAP = 4
const ROW_GAP = 26
const POD_PAD = 8
const POD_GAP = 14
const IPN_GAP = 30

/** Past this many unique device pairs the diagram is a solid block of ink. */
const DEFAULT_MAX_EDGE_PAIRS = 700

interface RowPlan {
  perRow: number
  nodeW: number
  rows: number
}

/**
 * Fit `count` boxes into `width`: wrap into as few rows as the minimum box
 * width allows, then balance the rows so the last one isn't a lone straggler.
 */
function planRows(count: number, width: number): RowPlan {
  if (count <= 0) return { perRow: 0, nodeW: IDEAL_NODE_W, rows: 0 }
  const maxPerRow = Math.max(1, Math.floor((width + NODE_GAP) / (MIN_NODE_W + NODE_GAP)))
  const rows = Math.ceil(count / maxPerRow)
  const perRow = Math.ceil(count / rows)
  const nodeW = Math.min(IDEAL_NODE_W, (width - (perRow - 1) * NODE_GAP) / perRow)
  return { perRow, nodeW, rows }
}

/** Place a group of nodes as centred, wrapped rows starting at `top`. */
function layoutGroup(
  items: Array<{ id: string; role: TopologyRole; label: string; pod_index: number | null }>,
  left: number,
  top: number,
  width: number,
  out: PdfTopologyNodeBox[]
): number {
  if (items.length === 0) return top
  const { perRow, nodeW } = planRows(items.length, width)
  let y = top
  for (let i = 0; i < items.length; i += perRow) {
    const slice = items.slice(i, i + perRow)
    const rowW = slice.length * nodeW + (slice.length - 1) * NODE_GAP
    let x = left + (width - rowW) / 2
    for (const item of slice) {
      out.push({
        id: item.id,
        role: item.role,
        label: item.label,
        x,
        y,
        w: nodeW,
        h: NODE_H,
        pod_index: item.pod_index
      })
      x += nodeW + NODE_GAP
    }
    y += NODE_H + ROW_GAP
  }
  // The trailing ROW_GAP belongs to the caller's spacing, not the group's.
  return y - ROW_GAP
}

export function layoutTopologyForPdf(
  graph: TopologyGraph,
  { width, maxEdgePairs = DEFAULT_MAX_EDGE_PAIRS }: PdfTopologyOptions
): PdfTopologyLayout {
  const ipns = graph.nodes.filter((n) => n.role === 'ipn')
  const spines = graph.nodes.filter((n) => n.role === 'spine')
  const leaves = graph.nodes.filter((n) => n.role === 'leaf')

  const boxes: PdfTopologyNodeBox[] = []
  const pods: PdfTopologyPodBox[] = []
  let y = 0

  // IPN routers sit above every pod — they are the thing the pods share.
  if (ipns.length > 0) {
    y = layoutGroup(
      ipns.map((n) => ({ id: n.id, role: n.role, label: n.label, pod_index: null })),
      0,
      y,
      width,
      boxes
    )
    y += IPN_GAP
  }

  // Group spines + leaves by pod. `null` pod_index (single-pod designs and
  // pre-9b fixtures) collapses into one implied pod keyed -1.
  const podKeys = [
    ...new Set([...spines, ...leaves].map((n) => n.pod_index ?? -1))
  ].sort((a, b) => a - b)

  const multiPod = podKeys.length > 1 || podKeys[0] !== -1

  for (const key of podKeys) {
    const podSpines = spines.filter((n) => (n.pod_index ?? -1) === key)
    const podLeaves = leaves.filter((n) => (n.pod_index ?? -1) === key)
    if (podSpines.length === 0 && podLeaves.length === 0) continue

    const innerLeft = multiPod ? POD_PAD : 0
    const innerWidth = multiPod ? width - POD_PAD * 2 : width
    const blockTop = y
    let inner = multiPod ? y + POD_PAD + (key >= 0 ? 10 : 0) : y

    inner = layoutGroup(
      podSpines.map((n) => ({ id: n.id, role: n.role, label: n.label, pod_index: n.pod_index ?? null })),
      innerLeft,
      inner,
      innerWidth,
      boxes
    )
    if (podSpines.length > 0 && podLeaves.length > 0) inner += ROW_GAP
    inner = layoutGroup(
      podLeaves.map((n) => ({ id: n.id, role: n.role, label: n.label, pod_index: n.pod_index ?? null })),
      innerLeft,
      inner,
      innerWidth,
      boxes
    )

    const blockBottom = inner + NODE_H + (multiPod ? POD_PAD : 0)
    if (multiPod && key >= 0) {
      pods.push({
        pod_index: key,
        label: `Pod ${key + 1}`,
        x: 0,
        y: blockTop,
        w: width,
        h: blockBottom - blockTop
      })
    }
    y = blockBottom + POD_GAP
  }

  const height = Math.max(0, y - POD_GAP)
  const byId = new Map(boxes.map((b) => [b.id, b]))

  // Collapse port-level links to one line per device pair — a 111-leaf fabric
  // has ~500 links but only ~220 pairs, and the extra lines land on identical
  // coordinates anyway.
  const pairCounts = new Map<string, { source: string; target: string; count: number }>()
  for (const e of graph.edges) {
    const key = `${e.source}->${e.target}`
    const existing = pairCounts.get(key)
    if (existing) existing.count += 1
    else pairCounts.set(key, { source: e.source, target: e.target, count: 1 })
  }

  let edges: PdfTopologyEdgeLine[] = []
  let omitted: PdfTopologyLayout['edges_omitted'] = null

  if (pairCounts.size > maxEdgePairs) {
    omitted = { pairs: pairCounts.size, links: graph.edges.length }
  } else {
    for (const [id, pair] of pairCounts) {
      const a = byId.get(pair.source)
      const b = byId.get(pair.target)
      if (!a || !b) continue
      // Anchor on the facing edge of each box so lines don't cut through them.
      const aBelow = a.y < b.y
      edges.push({
        id,
        x1: a.x + a.w / 2,
        y1: aBelow ? a.y + a.h : a.y,
        x2: b.x + b.w / 2,
        y2: aBelow ? b.y : b.y + b.h,
        count: pair.count
      })
    }
    // Deterministic order so snapshots are stable across Map iteration.
    edges = edges.sort((p, q) => p.id.localeCompare(q.id))
  }

  return {
    width,
    height,
    nodes: boxes,
    edges,
    pods,
    edges_omitted: omitted,
    counts: { spine: spines.length, leaf: leaves.length, ipn: ipns.length }
  }
}
