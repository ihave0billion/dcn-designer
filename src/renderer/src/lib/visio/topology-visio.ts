// Phase 13 — pure mapper: Topology-tab scene → Visio drawing ops.
//
// Takes the device-level scene exactly as the Topology tab lays it out
// (tile positions in px, auto or user-dragged) and draws it with the
// vsdx writer: one front panel per device (Cisco master, product photo or
// generated schematic), straight links from distinct landing points on the
// panel edges, labels above spines/IPNs and below leaves, port labels at
// the line ends, a title block, a legend and a notes box. No I/O here — the
// caller has already registered masters and loaded image bytes — so the
// geometry is unit-testable.
//
// Paper policy: 17×11 in (tabloid landscape) at 1:12 when the scene fits;
// otherwise 34×22 in (ANSI D, portrait when the scene is taller than wide)
// at 1:12; beyond that the paper stays ANSI D and the drawing scale rises
// (1:24, 1:48, …) until it fits. Text is paper-sized, so labels stay
// legible at any scale; they are shrunk/truncated to their tile width so a
// hostname never runs into its neighbour.
//
// Coordinates: scene px grow DOWNWARD (screen); Visio drawing inches grow
// UPWARD from the page's bottom-left. Y is flipped here, once.
//
// NOTE: TILE_W/TILE_H duplicate topology-hierarchy.ts on purpose — that
// module imports through the `@/` alias, which the Node smoke script
// cannot resolve. Keep them in sync (a test guards the values).

import { buildSchematicPanel, type SchematicPortGroup } from './schematic-panel'
import {
  Diagram,
  type Page,
  type Rect,
  type ShapeRef,
  imagePixelSize,
  pointTouchesRect,
  rectsOverlap
} from './vsdx-writer'

export const IN_PER_PX = 0.25
/** Scene tile footprint in px — must match topology-hierarchy.ts. */
export const SCENE_TILE_W = 124
export const SCENE_TILE_H = 100

/** Paper sizes (inches) the mapper may pick, in order of preference. */
export const PAPER_TABLOID = { w: 17, h: 11 }
export const PAPER_ANSI_D = { w: 34, h: 22 }
/** Drawing scales tried on ANSI D once 1:12 no longer fits. */
export const DRAWING_SCALES = [12, 16, 24, 32, 36, 48, 64, 96, 128, 192, 256, 384]

/** Per-line port labels are drawn only up to this many links on a device. */
export const PORT_LABEL_MAX_PER_DEVICE = 12
/** Per-line count/speed labels are drawn only up to this many links on a page. */
export const EDGE_LABEL_MAX_EDGES = 40

export const COLOR_FABRIC = '#0070C0'
export const COLOR_IPN = '#B85450'
export const COLOR_MUTED = '#595959'
/** Phase 14 — the skill's peer-link red (solid; IPN links are the same red, dashed). */
export const COLOR_PEER_LINK = '#B85450'
export const COLOR_SERVER = '#7F7F7F'
export const COLOR_SERVER_FILL = '#D9D9D9'

export type TopologyVisioRole = 'spine' | 'leaf' | 'ipn' | 'server' | null

/** Phase 14 — how an edge is drawn. */
export type TopologyVisioEdgeKind = 'fabric' | 'ipn' | 'vpc-peer-link' | 'server'

/** Port group of a schematic panel (re-exported for the orchestration layer). */
export type SchematicGroup = SchematicPortGroup

export type ResolvedPanel =
  | { kind: 'master'; masterName: string }
  | { kind: 'image'; bytes: Uint8Array; imageKind: 'png' | 'jpeg'; widthIn?: number }
  | { kind: 'schematic'; ru: number; groups: SchematicGroup[]; modelId?: string }
  // Phase 14 — generic server box when the UCS pack has no master for the model.
  | { kind: 'server-box'; ru: number; modelId: string }

/** Generic server box: 19 in wide, RU-tall, like a chassis. */
export const SERVER_BOX_W = 19

export interface TopologyVisioNode {
  id: string
  label: string
  sublabel: string | null
  role: TopologyVisioRole
  /** Scene px, tile TOP-LEFT (TILE_W × TILE_H). */
  x: number
  y: number
  panel: ResolvedPanel
  /** Smart switch (DPU) — drawn with a small badge. */
  smart: boolean
  /** Model id, used for the schematic label. */
  modelId?: string
}

export interface TopologyVisioEdge {
  id: string
  /** Phase 14 — omitted = fabric (or ipn when an end is an IPN router). */
  kind?: TopologyVisioEdgeKind
  source: string
  target: string
  count: number
  speeds: number[]
  label: string
  /** Per cable link: port on the source device (a) and on the target (b). */
  ports: Array<{ a: string; b: string }>
}

/** Phase 14 — a vPC pair drawn as a dashed bracket around its two panels. */
export interface TopologyVisioPair {
  id: string
  memberIds: string[]
  label: string
}

export interface TopologyVisioPage {
  title: string
  /** Printed under the title, e.g. where the positions came from. */
  subtitle?: string
  nodes: TopologyVisioNode[]
  edges: TopologyVisioEdge[]
  /** Phase 14 — pairs WITHOUT a peer-link (ACI / peer-link off); others show as red lines. */
  pairs?: TopologyVisioPair[]
  orientation: 'vertical' | 'horizontal'
}

export interface TopologyVisioInput {
  projectName: string
  customer: string
  /** ISO timestamp; the date part is printed. */
  generatedAt: string
  /** Printed in the title block, e.g. "DCN Designer v1.3". */
  generator?: string
  /** Substitution log from the model resolver — listed in the notes box. */
  substitutions: string[]
  pages: TopologyVisioPage[]
}

export interface TopologyVisioOptions {
  inPerPx?: number
}

/** The sheet chosen for one page: paper size and drawing scale. */
export interface TopologySheet {
  title: string
  paperWidthIn: number
  paperHeightIn: number
  drawingScale: number
  /** e.g. "34×22 in at 1:24". */
  label: string
}

export interface TopologyVisioResult {
  pages: Page[]
  sheets: TopologySheet[]
  /** Validation findings (endpoints not touching, overlaps, omitted labels). */
  problems: string[]
}

// ── Paper-space constants (inches of paper; × k for drawing inches) ──
const P_SIDE = 0.67
const P_TITLE_H = 1.15
const P_FOOTER_H = 1.5
const P_TOP = P_TITLE_H + 0.5
const P_BOTTOM = P_FOOTER_H + 0.5
/** Vertical room for the labels above the top row and below the bottom row. */
const P_LABEL_ALLOWANCE = 0.45

// ── helpers ──────────────────────────────────────────────────────────

/** Rough printed width of `s` in drawing inches (Calibri-ish, `pt` paper points). */
export function textWidthIn(s: string, pt: number, k: number, bold = false): number {
  const longest = Math.max(...s.split('\n').map((l) => l.length))
  return (longest * (bold ? 0.62 : 0.55) * pt * k) / 72
}

/**
 * Shrink a label between maxPt and minPt so it prints within `maxWidthIn`.
 * When even minPt overflows, break it in two at the last hyphen / dot /
 * underscore that fits ("smart-sw-\nleaf12"); as a last resort truncate
 * with an ellipsis. Never lets Visio wrap mid-word.
 */
export function fitText(
  s: string,
  maxWidthIn: number,
  k: number,
  maxPt: number,
  minPt: number,
  bold = false
): { text: string; pt: number } {
  const fits = (t: string, pt: number): boolean => textWidthIn(t, pt, k, bold) <= maxWidthIn
  let pt = maxPt
  while (pt > minPt && !fits(s, pt)) pt -= 0.5
  if (fits(s, pt)) return { text: s, pt }
  // two lines at the break that keeps both halves inside the width
  const breaks = [...s.matchAll(/[-._ ]/g)].map((m) => m.index! + 1).reverse()
  for (const i of breaks) {
    const two = `${s.slice(0, i)}\n${s.slice(i)}`
    if (fits(two, pt)) return { text: two.replace(/ \n/, '\n'), pt }
  }
  const perChar = textWidthIn('x', pt, k, bold)
  const keep = Math.max(1, Math.floor(maxWidthIn / perChar) - 1)
  return { text: s.slice(0, keep) + '…', pt }
}

/** "Eth1/49", "Eth1/50", "Eth1/52" → "Eth1/49-50,52"; mixed prefixes joined with ", ". */
export function collapsePorts(ports: string[]): string {
  const uniq = [...new Set(ports)]
  const groups = new Map<string, { nums: number[]; raw: string[] }>()
  for (const p of uniq) {
    const m = /^(.*?)(\d+)$/.exec(p)
    if (!m) {
      groups.set(p, { nums: [], raw: [p] })
      continue
    }
    const g = groups.get(m[1]) ?? { nums: [], raw: [] }
    g.nums.push(Number(m[2]))
    groups.set(m[1], g)
  }
  const parts: string[] = []
  for (const [prefix, g] of groups) {
    if (g.nums.length === 0) {
      parts.push(...g.raw)
      continue
    }
    const nums = [...new Set(g.nums)].sort((a, b) => a - b)
    const runs: string[] = []
    let start = nums[0]
    let prev = nums[0]
    for (const n of nums.slice(1).concat([NaN])) {
      if (n === prev + 1) {
        prev = n
        continue
      }
      runs.push(start === prev ? String(start) : `${start}-${prev}`)
      start = prev = n
    }
    parts.push(prefix + runs.join(','))
  }
  return parts.join(', ')
}

export interface SheetChoice {
  paperW: number
  paperH: number
  scale: number
}

/** Pick paper + drawing scale for a scene of `extentW × extentH` drawing inches (at 1:12 geometry). */
export function chooseSheet(extentW: number, extentH: number): SheetChoice {
  const fits = (paperW: number, paperH: number, scale: number): boolean =>
    extentW / scale + 2 * P_SIDE <= paperW && extentH / scale + P_TOP + P_BOTTOM + 2 * P_LABEL_ALLOWANCE <= paperH
  const portrait = extentH > extentW
  const d = portrait ? { w: PAPER_ANSI_D.h, h: PAPER_ANSI_D.w } : PAPER_ANSI_D
  if (fits(PAPER_TABLOID.w, PAPER_TABLOID.h, 12)) return { paperW: PAPER_TABLOID.w, paperH: PAPER_TABLOID.h, scale: 12 }
  for (const scale of DRAWING_SCALES) if (fits(d.w, d.h, scale)) return { paperW: d.w, paperH: d.h, scale }
  const last = DRAWING_SCALES[DRAWING_SCALES.length - 1]
  return { paperW: d.w, paperH: d.h, scale: last }
}

export function sheetLabel(s: SheetChoice): string {
  return `${s.paperW}×${s.paperH} in at 1:${s.scale}`
}

interface PlacedNode {
  node: TopologyVisioNode
  cx: number
  cy: number
  rect: Rect
  panelRef: ShapeRef
  labelRect: Rect | null
}

type Side = 'top' | 'bottom' | 'left' | 'right'

/**
 * Which panel edge a link leaves from. Links follow the scene's flow — top/
 * bottom edges in the vertical layout, left/right in the horizontal one — like
 * the on-screen handles, even when the far end is mostly sideways (a wide row
 * of leaves under two centred spines). Only a peer on the same row falls back
 * to the geometric side.
 */
function sideTowards(from: PlacedNode, tx: number, ty: number, orientation: 'vertical' | 'horizontal'): Side {
  const dx = tx - from.cx
  const dy = ty - from.cy
  if (orientation === 'vertical' && Math.abs(dy) > 1e-6) return dy > 0 ? 'top' : 'bottom'
  if (orientation === 'horizontal' && Math.abs(dx) > 1e-6) return dx > 0 ? 'right' : 'left'
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? 'top' : 'bottom'
  return dx >= 0 ? 'right' : 'left'
}

/** Outward unit normal of a panel side. */
function normalOf(side: Side): { x: number; y: number } {
  return side === 'top' ? { x: 0, y: 1 } : side === 'bottom' ? { x: 0, y: -1 } : side === 'right' ? { x: 1, y: 0 } : { x: -1, y: 0 }
}

function panelSize(diag: Diagram, n: TopologyVisioNode): { w: number; h: number } {
  const p = n.panel
  if (p.kind === 'master') {
    if (diag.hasMaster(p.masterName)) return diag.masterSize(p.masterName)
    return { w: 19, h: 1.75 }
  }
  if (p.kind === 'image') {
    const w = p.widthIn ?? 19
    const px = imagePixelSize(p.bytes)
    return { w, h: (w * px.h) / px.w }
  }
  if (p.kind === 'server-box') return { w: SERVER_BOX_W, h: 1.75 * Math.max(1, p.ru) }
  return { w: 19, h: 1.75 * Math.max(1, p.ru) }
}

function edgeKindOf(e: TopologyVisioEdge, a: PlacedNode, b: PlacedNode): TopologyVisioEdgeKind {
  if (e.kind) return e.kind
  return a.node.role === 'ipn' || b.node.role === 'ipn' ? 'ipn' : 'fabric'
}

/** Build every page of the drawing into `diag`. */
export function buildTopologyDiagram(
  input: TopologyVisioInput,
  diag: Diagram,
  opts: TopologyVisioOptions = {}
): TopologyVisioResult {
  const inPerPx = opts.inPerPx ?? IN_PER_PX
  const problems: string[] = []
  const pages: Page[] = []
  const sheets: TopologySheet[] = []

  for (const [pi, spec] of input.pages.entries()) {
    const pageProblems: string[] = []
    const pfx = input.pages.length > 1 ? `[${spec.title}] ` : ''
    const title = spec.title || `Page ${pi + 1}`

    // ── scene extent (tile centres, px) → drawing inches at 1:12 geometry ──
    const centres = spec.nodes.map((n) => ({ n, cx: n.x + SCENE_TILE_W / 2, cy: n.y + SCENE_TILE_H / 2 }))
    const sizes = new Map(spec.nodes.map((n) => [n.id, panelSize(diag, n)]))
    const minCx = centres.length ? Math.min(...centres.map((c) => c.cx)) : 0
    const maxCx = centres.length ? Math.max(...centres.map((c) => c.cx)) : 0
    const minCy = centres.length ? Math.min(...centres.map((c) => c.cy)) : 0
    const maxCy = centres.length ? Math.max(...centres.map((c) => c.cy)) : 0
    const maxPanelW = Math.max(19, ...[...sizes.values()].map((s) => s.w))
    const maxPanelH = Math.max(1.75, ...[...sizes.values()].map((s) => s.h))
    const extentW = (maxCx - minCx) * inPerPx + maxPanelW
    const extentH = (maxCy - minCy) * inPerPx + maxPanelH

    const sheet = chooseSheet(extentW, extentH)
    const k = sheet.scale
    const pageW = sheet.paperW * k
    const pageH = sheet.paperH * k
    const page = diag.addPage(title, pageW, pageH, 1, k)
    pages.push(page)
    sheets.push({ title, paperWidthIn: sheet.paperW, paperHeightIn: sheet.paperH, drawingScale: k, label: sheetLabel(sheet) })

    const mSide = P_SIDE * k
    const mTop = (P_TOP + P_LABEL_ALLOWANCE) * k
    const mBottom = (P_BOTTOM + P_LABEL_ALLOWANCE) * k
    // Centre the drawing both ways in the area between title block and footer.
    const offX = (pageW - extentW) / 2 + maxPanelW / 2 - minCx * inPerPx
    const freeH = pageH - mTop - mBottom - extentH
    const topY = pageH - mTop - Math.max(0, freeH) / 2 - maxPanelH / 2
    const toX = (cx: number): number => offX + cx * inPerPx
    const toY = (cy: number): number => topY - (cy - minCy) * inPerPx

    // Labels may use the tile stride (minus a gap) so neighbours never touch.
    const strideIn = SCENE_TILE_W * inPerPx
    const labelMaxW = strideIn - 1.5

    // ── panels + labels ──
    const placed = new Map<string, PlacedNode>()
    let smartMark = false // a text-less DPU mark was drawn → explain it in the legend
    for (const { n, cx, cy } of centres) {
      const x = toX(cx)
      const y = toY(cy)
      const size = sizes.get(n.id)!
      const labelAbove = spec.orientation === 'vertical' && (n.role === 'spine' || n.role === 'ipn')
      let ref: ShapeRef
      if (n.panel.kind === 'master' && diag.hasMaster(n.panel.masterName)) {
        ref = diag.drop(page, n.panel.masterName, x, y)
      } else if (n.panel.kind === 'image') {
        ref = diag.image(page, { bytes: n.panel.bytes, kind: n.panel.imageKind }, x, y, { w: size.w })
      } else if (n.panel.kind === 'server-box') {
        // Generic server: a grey chassis with the model printed inside.
        const modelText = fitText(n.panel.modelId, size.w - 0.4, k, 7, 4.5, true)
        ref = diag.box(page, x, y, size.w, size.h, {
          fill: COLOR_SERVER_FILL,
          line: COLOR_SERVER,
          weight: 0.012,
          text: modelText.text,
          fontPt: modelText.pt,
          bold: true,
          textColor: '#262626'
        })
      } else {
        if (n.panel.kind === 'master') {
          pageProblems.push(`${n.id}: master '${n.panel.masterName}' not registered — drew a schematic panel`)
        }
        const groups = n.panel.kind === 'schematic' ? n.panel.groups : []
        const ru = n.panel.kind === 'schematic' ? n.panel.ru : 1
        const modelId = (n.panel.kind === 'schematic' && n.panel.modelId) || n.modelId || n.sublabel || n.id
        ref = buildSchematicPanel(diag, page, { modelId, ru, groups, x, y })
      }

      const lab = fitText(n.label, labelMaxW, k, 8, 5, true)
      const sub = n.sublabel ? fitText(n.sublabel, labelMaxW, k, 6, 5) : null
      const th = diag.textHeight(page, lab.text, lab.pt)
      const sh = sub ? diag.textHeight(page, sub.text, sub.pt) : 0
      const gap = 0.06 * k
      const lw = Math.max(size.w, labelMaxW)
      let labelRect: Rect | null
      if (!labelAbove) {
        const ly = ref.y0 - gap - th / 2
        diag.text(page, x, ly, lw, th, lab.text, { fontPt: lab.pt, bold: true })
        if (sub) diag.text(page, x, ly - th / 2 - sh / 2, lw, sh, sub.text, { fontPt: sub.pt, color: COLOR_MUTED })
        labelRect = { x0: x - lw / 2, y0: ly - th / 2 - sh, x1: x + lw / 2, y1: ly + th / 2 }
      } else {
        const sy = ref.y1 + gap + sh / 2
        if (sub) diag.text(page, x, sy, lw, sh, sub.text, { fontPt: sub.pt, color: COLOR_MUTED })
        const ly = ref.y1 + gap + sh + th / 2
        diag.text(page, x, ly, lw, th, lab.text, { fontPt: lab.pt, bold: true })
        labelRect = { x0: x - lw / 2, y0: ref.y1 + gap, x1: x + lw / 2, y1: ly + th / 2 }
      }
      if (n.smart) {
        // DPU badge inside the panel's right end. Paper-sized when the panel
        // is tall enough to carry "DPU" text; otherwise a purple mark sized to
        // the panel (the legend explains it) so it never spills over the label.
        const panelH = ref.y1 - ref.y0
        const bh = Math.min(0.1 * k, panelH * 0.8)
        const fontPt = ((bh / k) * 72) / 1.6
        const withText = fontPt >= 4.5
        const bw = withText ? 0.27 * k : bh
        diag.box(page, ref.x1 - bw / 2 - panelH * 0.1, ref.y0 + panelH / 2, bw, bh, {
          ...(withText ? { text: 'DPU', fontPt: Math.min(6, fontPt), bold: true, textColor: '#FFFFFF' } : {}),
          fill: '#7030A0',
          line: '#7030A0'
        })
        smartMark = smartMark || !withText
      }
      placed.set(n.id, { node: n, cx: x, cy: y, rect: { x0: ref.x0, y0: ref.y0, x1: ref.x1, y1: ref.y1 }, panelRef: ref, labelRect })
    }

    // ── landing points: each link gets its own spot on the panel edge ──
    // Group a device's links by the side they leave from, sort by the far
    // end's position along that edge, spread them evenly.
    interface Landing {
      x: number
      y: number
      side: Side
      slot: number
      of: number
    }
    const landings = new Map<string, Landing>() // `${edgeId}|${nodeId}`
    const linksOf = new Map<string, TopologyVisioEdge[]>()
    for (const e of spec.edges) {
      if (!placed.has(e.source) || !placed.has(e.target)) continue
      for (const id of [e.source, e.target]) linksOf.set(id, [...(linksOf.get(id) ?? []), e])
    }
    for (const [nodeId, links] of linksOf) {
      const me = placed.get(nodeId)!
      const bySide = new Map<Side, Array<{ e: TopologyVisioEdge; along: number }>>()
      for (const e of links) {
        const other = placed.get(e.source === nodeId ? e.target : e.source)!
        const side = sideTowards(me, other.cx, other.cy, spec.orientation)
        const along = side === 'top' || side === 'bottom' ? other.cx : other.cy
        bySide.set(side, [...(bySide.get(side) ?? []), { e, along }])
      }
      for (const [side, arr] of bySide) {
        arr.sort((a, b) => a.along - b.along || a.e.id.localeCompare(b.e.id))
        const n = arr.length
        arr.forEach(({ e }, i) => {
          const t = (i + 1) / (n + 1)
          const r = me.rect
          const pt =
            side === 'top'
              ? { x: r.x0 + t * (r.x1 - r.x0), y: r.y1 }
              : side === 'bottom'
                ? { x: r.x0 + t * (r.x1 - r.x0), y: r.y0 }
                : side === 'right'
                  ? { x: r.x1, y: r.y0 + t * (r.y1 - r.y0) }
                  : { x: r.x0, y: r.y0 + t * (r.y1 - r.y0) }
          landings.set(`${e.id}|${nodeId}`, { ...pt, side, slot: i, of: n })
        })
      }
    }

    // ── label policies ──
    const edgeLabels = new Set(spec.edges.map((e) => e.label).filter(Boolean))
    const uniformEdgeLabel = edgeLabels.size === 1 ? [...edgeLabels][0] : null
    const drawEdgeLabels = !uniformEdgeLabel && spec.edges.length <= EDGE_LABEL_MAX_EDGES
    if (!uniformEdgeLabel && spec.edges.length > EDGE_LABEL_MAX_EDGES && edgeLabels.size > 0) {
      pageProblems.push(`link labels omitted: ${spec.edges.length} links exceed the ${EDGE_LABEL_MAX_EDGES}-link limit — see the Links tab`)
    }
    const portLabelsOff = new Set<string>()
    for (const [nodeId, links] of linksOf) {
      if (links.length > PORT_LABEL_MAX_PER_DEVICE && links.some((e) => e.ports.length > 0)) {
        portLabelsOff.add(nodeId)
        pageProblems.push(`port labels omitted on ${nodeId} (${links.length} links) — see Links tab`)
      }
    }

    // ── vPC pair brackets (Phase 14, decision 11) ──
    let bracketsDrawn = 0
    for (const p of spec.pairs ?? []) {
      const members = p.memberIds.map((id) => placed.get(id)).filter((m): m is PlacedNode => !!m)
      if (members.length < 2) continue
      const pad = 0.25 * k
      const x0 = Math.min(...members.map((m) => Math.min(m.rect.x0, m.labelRect?.x0 ?? m.rect.x0))) - pad
      const x1 = Math.max(...members.map((m) => Math.max(m.rect.x1, m.labelRect?.x1 ?? m.rect.x1))) + pad
      const y0 = Math.min(...members.map((m) => Math.min(m.rect.y0, m.labelRect?.y0 ?? m.rect.y0))) - pad
      const y1 = Math.max(...members.map((m) => Math.max(m.rect.y1, m.labelRect?.y1 ?? m.rect.y1))) + pad
      diag.box(page, (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, {
        transparent: true,
        line: COLOR_PEER_LINK,
        weight: 0.012,
        pattern: 2
      })
      const lh = diag.textHeight(page, p.label, 6)
      const lw = textWidthIn(p.label, 6, k) + 0.2 * k
      diag.text(page, x0 + lw / 2 + 0.05 * k, y0 - lh / 2, lw, lh, p.label, { fontPt: 6, color: COLOR_PEER_LINK, bold: true })
      bracketsDrawn += 1
    }

    // ── links ──
    const portLabelRects: Array<Rect & { owner: string }> = []
    const portPt = 4
    let peerLinksDrawn = 0
    let serverLinesDrawn = 0
    for (const e of spec.edges) {
      const a = placed.get(e.source)
      const b = placed.get(e.target)
      if (!a || !b) {
        pageProblems.push(`link ${e.id}: endpoint missing on this page (${!a ? e.source : e.target})`)
        continue
      }
      const la = landings.get(`${e.id}|${e.source}`)!
      const lb = landings.get(`${e.id}|${e.target}`)!
      const kind = edgeKindOf(e, a, b)
      if (kind === 'vpc-peer-link') peerLinksDrawn += 1
      if (kind === 'server') serverLinesDrawn += 1
      diag.line(page, la.x, la.y, lb.x, lb.y, {
        color: kind === 'ipn' ? COLOR_IPN : kind === 'vpc-peer-link' ? COLOR_PEER_LINK : kind === 'server' ? COLOR_SERVER : COLOR_FABRIC,
        weight: kind === 'vpc-peer-link' ? 0.02 : kind === 'server' ? 0.01 : 0.014,
        pattern: kind === 'ipn' ? 2 : 1
      })
      if (!pointTouchesRect(la.x, la.y, a.rect) || !pointTouchesRect(lb.x, lb.y, b.rect)) {
        pageProblems.push(`link ${e.id}: endpoint does not touch a device panel`)
      }
      const dx = lb.x - la.x
      const dy = lb.y - la.y
      const len = Math.hypot(dx, dy) || 1
      const ux = dx / len
      const uy = dy / len
      const nx = -uy
      const ny = ux

      // Peer-link bundles are always labelled (they are few) and carry their
      // ports in that one label — two per-end labels would collide in the
      // gap between neighbouring leaves; server lines are never labelled
      // (decision 8).
      let label = e.label
      if (kind === 'vpc-peer-link' && e.ports.length > 0) {
        const pa = collapsePorts(e.ports.map((p) => p.a))
        const pb = collapsePorts(e.ports.map((p) => p.b))
        label = `${label} · ${pa === pb ? pa : `${pa} ↔ ${pb}`}`
      }
      if (kind !== 'server' && label && (drawEdgeLabels || kind === 'vpc-peer-link')) {
        const lh = diag.textHeight(page, label, 6)
        const lw = textWidthIn(label, 6, k) + 0.5 * k
        diag.text(page, la.x + dx * 0.5 + nx * 0.12 * k, la.y + dy * 0.5 + ny * 0.12 * k, lw, lh, label, {
          fontPt: 6,
          color: kind === 'vpc-peer-link' ? COLOR_PEER_LINK : COLOR_FABRIC
        })
      }

      // Port labels: one per end, that pair's ports collapsed, sitting just
      // outside the panel along the line. Neighbouring landing points are
      // closer than a label is wide, so labels step further out in cycles.
      const placePort = (nodeId: string, land: Landing, text: string, dirX: number, dirY: number): void => {
        if (!text || portLabelsOff.has(nodeId)) return
        const lh = diag.textHeight(page, text, portPt)
        const lw = textWidthIn(text, portPt, k) + 0.1 * k
        const r = placed.get(nodeId)!.rect
        const edgeLen = land.side === 'top' || land.side === 'bottom' ? r.x1 - r.x0 : r.y1 - r.y0
        const spacing = edgeLen / (land.of + 1)
        const across = land.side === 'top' || land.side === 'bottom' ? lw : lh
        const levels = Math.max(1, Math.min(land.of, Math.ceil(across / spacing) + 1))
        const step = (land.side === 'top' || land.side === 'bottom' ? lh : lw) + 0.05 * k
        const d = 0.08 * k + (land.slot % levels) * step + (land.side === 'top' || land.side === 'bottom' ? lh / 2 : lw / 2)
        const nrm = normalOf(land.side)
        // Outward along the panel normal (keeps the label off the panel), then
        // nudged sideways along the line so it hugs its own link.
        const px = land.x + nrm.x * d + (dirX - nrm.x * (dirX * nrm.x + dirY * nrm.y)) * 0.5
        const py = land.y + nrm.y * d + (dirY - nrm.y * (dirX * nrm.x + dirY * nrm.y)) * 0.5
        diag.text(page, px, py, lw, lh, text, { fontPt: portPt, color: COLOR_MUTED })
        portLabelRects.push({ x0: px - lw / 2, y0: py - lh / 2, x1: px + lw / 2, y1: py + lh / 2, owner: nodeId })
      }
      if (e.ports.length > 0 && kind !== 'server' && kind !== 'vpc-peer-link') {
        placePort(e.source, la, collapsePorts(e.ports.map((p) => p.a)), ux, uy)
        placePort(e.target, lb, collapsePorts(e.ports.map((p) => p.b)), -ux, -uy)
      }
    }

    // ── overlap validation ──
    const all = [...placed.values()]
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const A = all[i]
        const B = all[j]
        if (rectsOverlap(A.rect, B.rect)) pageProblems.push(`overlap: ${A.node.id} and ${B.node.id} panels`)
        if (A.labelRect && rectsOverlap(A.labelRect, B.rect)) pageProblems.push(`overlap: ${A.node.id} label over ${B.node.id}`)
        if (B.labelRect && rectsOverlap(B.labelRect, A.rect)) pageProblems.push(`overlap: ${B.node.id} label over ${A.node.id}`)
        if (A.labelRect && B.labelRect && rectsOverlap(A.labelRect, B.labelRect)) {
          pageProblems.push(`overlap: ${A.node.id} and ${B.node.id} labels`)
        }
      }
      for (const pr of portLabelRects) {
        if (rectsOverlap(pr, all[i].rect)) {
          pageProblems.push(`overlap: a port label sits on ${all[i].node.id}`)
          break
        }
      }
    }
    for (let i = 0; i < portLabelRects.length; i++) {
      for (let j = i + 1; j < portLabelRects.length; j++) {
        if (rectsOverlap(portLabelRects[i], portLabelRects[j], 0.01)) {
          pageProblems.push(`overlap: port labels on ${portLabelRects[i].owner} and ${portLabelRects[j].owner}`)
        }
      }
    }

    // ── title block (paper-sized) ──
    const titleH = P_TITLE_H * k
    const titleY = pageH - titleH / 2
    const date = input.generatedAt.slice(0, 10)
    const generator = input.generator ?? 'DCN Designer'
    const tw = pageW - 2 * mSide
    diag.text(page, mSide + tw / 2, titleY + 0.18 * k, tw, diag.textHeight(page, title, 14), title, {
      fontPt: 14,
      bold: true,
      align: 'left'
    })
    const sub = `${input.projectName}  ·  ${input.customer || 'no customer'}  ·  ${date}  ·  ${generator}  ·  ${spec.subtitle ?? 'positions from the Topology tab'}  ·  ${sheetLabel(sheet)}`
    diag.text(page, mSide + tw / 2, titleY - 0.22 * k, tw, diag.textHeight(page, sub, 7), sub, {
      fontPt: 7,
      align: 'left',
      color: COLOR_MUTED
    })
    diag.line(page, mSide, pageH - titleH, pageW - mSide, pageH - titleH, { color: '#BFBFBF', weight: 0.008 })

    // ── legend (bottom-left) ──
    const legendW = 4.6 * k
    const legendH = (P_FOOTER_H - 0.35) * k
    const lx = mSide + legendW / 2
    const ly = 0.2 * k + legendH / 2
    diag.box(page, lx, ly, legendW, legendH, { fill: '#FFFFFF', line: '#BFBFBF', weight: 0.008 })
    diag.text(page, lx, ly + legendH / 2 - 0.12 * k, legendW - 0.2 * k, 0.18 * k, 'Legend', { fontPt: 7, bold: true, align: 'left' })
    const rows: Array<[string, string, number]> = [
      [uniformEdgeLabel ? `Fabric link (spine ↔ leaf) — every link ${uniformEdgeLabel}` : 'Fabric link (spine ↔ leaf); label = links × speed', COLOR_FABRIC, 1],
      ['Inter-pod link (IPN), dashed', COLOR_IPN, 2],
      ...(peerLinksDrawn ? ([['vPC peer-link (leaf ↔ leaf), red', COLOR_PEER_LINK, 1]] as Array<[string, string, number]>) : []),
      ...(bracketsDrawn ? ([['vPC pair without a peer-link (bracket)', COLOR_PEER_LINK, 2]] as Array<[string, string, number]>) : []),
      ...(serverLinesDrawn ? ([['Server NIC (one line per NIC; symbol per leaf or per vPC pair)', COLOR_SERVER, 1]] as Array<[string, string, number]>) : []),
      ...(smartMark ? ([['Purple mark on a panel = smart switch (DPU)', '#7030A0', 1]] as Array<[string, string, number]>) : [])
    ]
    // Up to six rows (Phase 14 added peer-link / bracket / server) at a
    // 0.15 in pitch fit the 1.15 in box; the panel-kind note moved to Notes.
    rows.forEach(([txt, col, pat], i) => {
      const ry = ly + legendH / 2 - 0.3 * k - i * 0.15 * k
      diag.line(page, lx - legendW / 2 + 0.12 * k, ry, lx - legendW / 2 + 0.62 * k, ry, { color: col, weight: 0.014, pattern: pat })
      diag.text(page, lx + 0.33 * k, ry, legendW - 0.85 * k, 0.14 * k, txt, { fontPt: 5.5, align: 'left' })
    })
    const kinds = new Set(spec.nodes.map((n) => n.panel.kind))
    const kindText = [
      kinds.has('master') && 'Cisco stencil masters',
      kinds.has('image') && 'product photos',
      kinds.has('schematic') && 'generated schematic panels',
      kinds.has('server-box') && 'generic server boxes'
    ]
      .filter(Boolean)
      .join(' · ')

    // ── notes (bottom-right) ──
    const notesW = 5.8 * k
    const nx0 = pageW - mSide - notesW / 2
    diag.box(page, nx0, ly, notesW, legendH, { fill: '#FFFFFF', line: '#BFBFBF', weight: 0.008 })
    const noteLines = [
      'Notes',
      ...(input.substitutions.length ? input.substitutions : ['No stencil substitutions.']),
      ...pageProblems.filter((p) => p.includes('omitted')),
      ...(kindText ? [`Device panels: ${kindText}`] : [])
    ]
    const shown = noteLines.slice(0, 6)
    if (noteLines.length > 6) shown.push(`… ${noteLines.length - 6} more (see the Export tab)`)
    diag.text(page, nx0, ly, notesW - 0.2 * k, legendH - 0.1 * k, shown.join('\n'), { fontPt: 6, align: 'left' })

    problems.push(...pageProblems.map((p) => pfx + p))
  }

  return { pages, sheets, problems }
}
