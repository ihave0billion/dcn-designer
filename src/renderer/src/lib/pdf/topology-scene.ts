import type { TopologyLayoutFile } from '@/schemas/topology-layout'
import type { TopologyGraph, TopologyRole } from '@/lib/topology-extractor'
import {
  buildFabrics,
  buildScene,
  TILE_H,
  TILE_W,
  type Fabric,
  type Orientation,
  type SceneEdgeKind,
  type SceneNodeKind
} from '@/lib/topology-hierarchy'
import { resolveScenePositions } from '@/lib/topology-scene-positions'
import type { ServerInfoResolver } from '@/lib/server-symbols'

// Phase 13 — the PDF Topology page(s), built from the SAME scene geometry
// as the Topology tab and the Visio export (device level, one page per
// fabric, positions = the tab's auto layout overridden by the user's saved
// drags — the tab's row shape is kept as-is; the report sizes its sheet to it).
// Pure: numbers in scene pixels, no react-pdf import, unit-testable.
//
// A device is drawn as its front panel — the rasterised stencil master or
// product photo when the caller supplies one, a coloured chassis rectangle
// otherwise — centred in the tile, label above spines/IPNs and below leaves,
// as on screen. Edges are device-to-device with a count label.

export interface PanelImage {
  /** data: URL */
  url: string
  /** width / height of the raster */
  aspect: number
}

/** Tallest a panel may be so the label rows still clear the neighbours. */
export const MAX_PANEL_H = TILE_H - 24

export interface PdfSceneNode {
  id: string
  /** Phase 14 — 'server' tiles are the Show-servers symbols. */
  kind: SceneNodeKind
  label: string
  sublabel: string | null
  role: TopologyRole | null
  modelId: string
  /** Panel rectangle in scene px. */
  x: number
  y: number
  w: number
  h: number
  /** Label anchor (centre x, baseline y) and whether it sits above the panel. */
  labelX: number
  labelY: number
  labelAbove: boolean
  smart: boolean
  /** data: URL of a PNG/JPEG front view, or null → draw a chassis rect. */
  image: string | null
}

export interface PdfSceneEdge {
  id: string
  /** Phase 14 — fabric / ipn / vpc-peer-link (red) / server (thin). */
  kind: SceneEdgeKind
  source: string
  target: string
  x1: number
  y1: number
  x2: number
  y2: number
  count: number
  label: string
  dashed: boolean
}

/** Phase 14 — a vPC pair drawn as a bracket (no peer-link between the members). */
export interface PdfScenePair {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
}

export interface PdfScenePage {
  title: string
  subtitle: string
  fabricId: string
  width: number
  height: number
  nodes: PdfSceneNode[]
  edges: PdfSceneEdge[]
  pairs: PdfScenePair[]
  counts: Record<'spine' | 'leaf' | 'ipn' | 'server', number>
  /** Phase 14 — peer-link bundles drawn on this page. */
  peerLinks: number
  /** Set when the wiring would obscure the page; edges are then not drawn. */
  edgesOmitted: { links: number; pairs: number } | null
  custom: boolean
}

export interface PdfSceneOptions {
  orientation?: Orientation
  /** model_id → front view. Missing = chassis rectangle. */
  images?: ReadonlyMap<string, PanelImage>
  /** RU per model, for the chassis height; default 1. */
  ruOf?: (modelId: string) => number | null
  /** Beyond this many device pairs the links are omitted (legibility). */
  maxEdges?: number
  /**
   * Tiles per row for the automatic layout. Default = the Topology tab's
   * ROW_MAX, so the page has the same shape as the expanded tab (the report
   * grows its sheet instead of re-wrapping the rows).
   */
  rowMax?: number
  /** Phase 14 — draw the Show-servers symbols (topology_layout.yaml show_servers). */
  showServers?: boolean
  serverInfo?: ServerInfoResolver
}

/** Server symbol footprint (a generic 1RU box when there is no artwork). */
export const SERVER_W = 64
export const SERVER_H = 20
/** Padding of the pair bracket around its member tiles. */
export const PAIR_PAD = 6

/** Panel width as a fraction of the tile; a 19" chassis at the tile's scale. */
export const PANEL_W = 110
/** 1RU at the panel's scale (19 in → 110 px ⇒ 1.75 in → ~10 px). */
export const RU_PX = 10
export const MIN_PANEL_H = 14
export const LABEL_GAP = 4
export const PAGE_PAD = 24
export const DEFAULT_MAX_EDGES = 400

/** Intersection of the segment centre→target with the axis-aligned rect around centre. */
export function rectEdgePoint(
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  tx: number,
  ty: number
): { x: number; y: number } {
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx)
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy)
  const s = Math.min(sx, sy)
  return { x: cx + dx * s, y: cy + dy * s }
}

export function buildPdfScenePages(
  graph: TopologyGraph,
  fabricName: string,
  layoutFile: TopologyLayoutFile | null,
  opts: PdfSceneOptions = {}
): PdfScenePage[] {
  const orientation = opts.orientation ?? 'vertical'
  const maxEdges = opts.maxEdges ?? DEFAULT_MAX_EDGES
  const fabrics: Fabric[] = buildFabrics(graph, fabricName)
  const multi = fabrics.length > 1
  const pages: PdfScenePage[] = []

  for (const fabric of fabrics) {
    const scene = buildScene(
      graph,
      fabrics,
      { kind: 'devices', fabricId: fabric.id },
      { aggregate: true, showServers: opts.showServers, serverInfo: opts.serverInfo }
    )
    // Saved drag positions win as-is; otherwise the automatic layout is the
    // Topology tab's own (same ROW_MAX) — never re-wrapped for paper, so the
    // page keeps the shape of the expanded tab (v1.6.3: the user rejected
    // the 14-per-row re-wrap that turned one leaf row into four).
    const { positions, custom } = resolveScenePositions(scene, layoutFile, orientation, { rowMax: opts.rowMax })

    const nodes: PdfSceneNode[] = []
    const counts = { spine: 0, leaf: 0, ipn: 0, server: 0 }
    for (const n of scene.nodes) {
      const p = positions.get(n.id) ?? { x: 0, y: 0 }
      const modelId =
        n.kind === 'server'
          ? (n.server?.modelId ?? 'server')
          : n.device?.model_id ?? (n.kind === 'ipn' ? (n.sublabel ?? 'unknown') : 'unknown')
      const ru = n.kind === 'server' ? (n.server?.ru ?? 1) : opts.ruOf?.(modelId) ?? 1
      const img = opts.images?.get(modelId) ?? null
      let w = n.kind === 'server' ? SERVER_W : PANEL_W
      let h = n.kind === 'server' ? Math.max(SERVER_H, RU_PX * ru) : Math.max(MIN_PANEL_H, RU_PX * ru)
      if (img) {
        // Keep the raster's shape: a front panel is ~11:1, an isometric photo ~1.25:1.
        h = Math.max(MIN_PANEL_H, w / img.aspect)
        if (h > MAX_PANEL_H) {
          h = MAX_PANEL_H
          w = h * img.aspect
        }
      }
      const cx = p.x + TILE_W / 2
      const cy = p.y + TILE_H / 2
      const labelAbove = orientation === 'vertical' && (n.role === 'spine' || n.role === 'ipn')
      const x = cx - w / 2
      const y = cy - h / 2
      if (n.role) counts[n.role] += 1
      if (n.kind === 'server') counts.server += 1
      nodes.push({
        id: n.id,
        kind: n.kind,
        label: n.label,
        sublabel: n.sublabel,
        role: n.role,
        modelId,
        x,
        y,
        w,
        h,
        labelX: cx,
        labelY: labelAbove ? y - LABEL_GAP : y + h + LABEL_GAP,
        labelAbove,
        smart: !!n.device?.smart,
        image: img?.url ?? null
      })
    }
    const byId = new Map(nodes.map((n) => [n.id, n]))

    const edges: PdfSceneEdge[] = []
    let omitted: PdfScenePage['edgesOmitted'] = null
    const peerLinks = scene.edges.filter((e) => e.kind === 'vpc-peer-link').length
    if (scene.edges.length > maxEdges) {
      omitted = { links: scene.edges.reduce((a, e) => a + e.count, 0), pairs: scene.edges.length }
    } else {
      for (const e of scene.edges) {
        const a = byId.get(e.source)
        const b = byId.get(e.target)
        if (!a || !b) continue
        const acx = a.x + a.w / 2
        const acy = a.y + a.h / 2
        const bcx = b.x + b.w / 2
        const bcy = b.y + b.h / 2
        let p1 = rectEdgePoint(acx, acy, a.w / 2, a.h / 2, bcx, bcy)
        let p2 = rectEdgePoint(bcx, bcy, b.w / 2, b.h / 2, acx, acy)
        // Phase 15 — a peer-link between two panels on (roughly) the same
        // row is levelled at their mean height so the port-channel oval
        // stands upright; free-drag layouts leave pairs a few px apart.
        if (e.kind === 'vpc-peer-link' && Math.abs(acy - bcy) <= Math.min(a.h, b.h) / 2 && Math.abs(acx - bcx) > (a.w + b.w) / 2) {
          const y = (acy + bcy) / 2
          const left = acx <= bcx
          p1 = { x: left ? a.x + a.w : a.x, y }
          p2 = { x: left ? b.x : b.x + b.w, y }
        }
        edges.push({
          id: e.id,
          kind: e.kind,
          source: e.source,
          target: e.target,
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
          count: e.count,
          label: e.label,
          dashed: a.role === 'ipn' || b.role === 'ipn'
        })
      }
    }

    // Phase 14 — bracket around the two tiles of a pair that has no peer-link.
    const pairs: PdfScenePair[] = []
    for (const p of scene.pairs) {
      if (!p.bracket) continue
      const tiles = p.memberIds.map((id) => positions.get(id)).filter((t): t is NonNullable<typeof t> => !!t)
      if (tiles.length < 2) continue
      const x0 = Math.min(...tiles.map((t) => t.x)) - PAIR_PAD
      const y0 = Math.min(...tiles.map((t) => t.y)) - PAIR_PAD
      const x1 = Math.max(...tiles.map((t) => t.x + TILE_W)) + PAIR_PAD
      const y1 = Math.max(...tiles.map((t) => t.y + TILE_H)) + PAIR_PAD
      pairs.push({ id: p.id, label: p.label, x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
    }

    // Page extent from the geometry (labels included), padded, origin shifted to 0.
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      minX = Math.min(minX, n.x)
      maxX = Math.max(maxX, n.x + n.w)
      minY = Math.min(minY, n.labelAbove ? n.labelY - 12 : n.y)
      maxY = Math.max(maxY, n.labelAbove ? n.y + n.h : n.labelY + 12)
    }
    for (const p of pairs) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x + p.w)
      maxY = Math.max(maxY, p.y + p.h)
    }
    if (nodes.length === 0) {
      minX = minY = 0
      maxX = maxY = 1
    }
    const dx = PAGE_PAD - minX
    const dy = PAGE_PAD - minY
    for (const n of nodes) {
      n.x += dx
      n.y += dy
      n.labelX += dx
      n.labelY += dy
    }
    for (const e of edges) {
      e.x1 += dx
      e.y1 += dy
      e.x2 += dx
      e.y2 += dy
    }
    for (const p of pairs) {
      p.x += dx
      p.y += dy
    }

    pages.push({
      title: multi ? `Topology — ${fabric.label}` : 'Topology',
      subtitle: custom
        ? 'Device level, positions as arranged on the Topology tab'
        : 'Device level, automatic layout (Topology tab)',
      fabricId: fabric.id,
      width: maxX - minX + PAGE_PAD * 2,
      height: maxY - minY + PAGE_PAD * 2,
      nodes,
      edges,
      pairs,
      counts,
      peerLinks,
      edgesOmitted: omitted,
      custom
    })
  }
  return pages
}
