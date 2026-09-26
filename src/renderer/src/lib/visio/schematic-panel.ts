// Phase 13 — generated schematic front panel.
//
// The universal fallback when a switch model has no Cisco stencil master
// and no product photo: a native Visio group (chassis + port cages + model
// label) built from the library's port groups. No copyright, editable in
// Visio, and `schematicGeometry` is pure so the PDF can draw the same
// rectangles.
//
// All geometry is in drawing inches, LOCAL to the chassis: origin at the
// chassis' bottom-left, x to the right, y up (Visio convention).

import type { Diagram, Rect, ShapeRef, ShapeSink } from './vsdx-writer'

export type PortKind = 'sfp' | 'qsfp' | 'rj45'

export interface SchematicPortGroup {
  ports: number
  speedG: number
  kind?: PortKind
}

export interface SchematicSpec {
  modelId: string
  /** Rack units (1 → 1.75 in tall). */
  ru: number
  groups: SchematicPortGroup[]
}

export interface SchematicPort extends Rect {
  group: number
  index: number
  row: number
  speedG: number
  kind: PortKind
  fill: string
}

export interface SchematicGeometry {
  /** Chassis outline (0,0)–(w,h). */
  chassis: Rect
  /** Rack-mount ears left and right. */
  ears: Rect[]
  ports: SchematicPort[]
  /** Bezel / LED area left of the ports (optional text). */
  labelBox: Rect
  /** 1 when everything fitted natively; < 1 when cages were shrunk to fit. */
  scale: number
  w: number
  h: number
}

export const CHASSIS_W_IN = 19
export const RU_IN = 1.75

/** Colour by speed band (matches the topology tab's speed legend spirit). */
export function speedFill(speedG: number): string {
  if (speedG <= 1) return '#A6A6A6'
  if (speedG <= 10) return '#7F7F7F'
  if (speedG <= 25) return '#5B9BD5'
  if (speedG <= 40) return '#70AD47'
  if (speedG <= 100) return '#0070C0'
  if (speedG <= 200) return '#7030A0'
  if (speedG <= 400) return '#ED7D31'
  return '#C00000'
}

export function inferPortKind(g: SchematicPortGroup): PortKind {
  if (g.kind) return g.kind
  if (g.speedG >= 40) return 'qsfp'
  if (g.speedG <= 1) return 'rj45'
  return 'sfp'
}

// Real-world pitches: SFP cages sit on ~0.56 in centres (24 columns ≈ 13.4 in),
// QSFP/QSFP-DD on ~0.78 in. A 48+6 SE1U-style panel therefore fills ~18 in of
// the 19 in chassis, which is why the label area is narrow.
const CAGE: Record<PortKind, { w: number; h: number }> = {
  sfp: { w: 0.5, h: 0.42 },
  rj45: { w: 0.5, h: 0.42 },
  qsfp: { w: 0.7, h: 0.55 }
}
const GAP = 0.06
const GROUP_GAP = 0.5
const EAR_W = 0.35
const LABEL_W = 1.6
const PORT_AREA_X0 = EAR_W + LABEL_W + 0.2
const PORT_AREA_X1 = CHASSIS_W_IN - EAR_W - 0.3

/** Rows a group is laid out in: 2 for dense SFP/RJ45 blocks, 1 for small QSFP rows. */
export function rowsFor(g: SchematicPortGroup): number {
  const kind = inferPortKind(g)
  if (kind === 'qsfp') return g.ports > 36 ? 2 : 1
  return g.ports > 24 ? 2 : 1
}

export function schematicGeometry(spec: SchematicSpec): SchematicGeometry {
  const w = CHASSIS_W_IN
  const h = RU_IN * Math.max(1, spec.ru)
  const chassis: Rect = { x0: 0, y0: 0, x1: w, y1: h }
  const ears: Rect[] = [
    { x0: 0, y0: 0, x1: EAR_W, y1: h },
    { x0: w - EAR_W, y0: 0, x1: w, y1: h }
  ]
  const labelBox: Rect = { x0: EAR_W + 0.1, y0: 0.15, x1: EAR_W + 0.1 + LABEL_W, y1: h - 0.15 }

  // Natural width of every group side by side.
  const layouts = spec.groups.map((g) => {
    const kind = inferPortKind(g)
    const rows = rowsFor(g)
    const cols = Math.ceil(g.ports / rows)
    const cage = CAGE[kind]
    return { g, kind, rows, cols, cage, width: cols * cage.w + (cols - 1) * GAP }
  })
  const natural = layouts.reduce((s, l) => s + l.width, 0) + Math.max(0, layouts.length - 1) * GROUP_GAP
  const available = PORT_AREA_X1 - PORT_AREA_X0
  const scale = natural > available ? available / natural : 1

  const ports: SchematicPort[] = []
  let x = PORT_AREA_X0
  layouts.forEach((l, gi) => {
    const cw = l.cage.w * scale
    const ch = Math.min(l.cage.h, (h - 0.3 - (l.rows - 1) * GAP) / l.rows)
    const gap = GAP * scale
    const blockH = l.rows * ch + (l.rows - 1) * GAP
    const yTop = h / 2 + blockH / 2
    for (let i = 0; i < l.g.ports; i++) {
      const row = l.rows === 1 ? 0 : i % l.rows
      const col = l.rows === 1 ? i : Math.floor(i / l.rows)
      const x0 = x + col * (cw + gap)
      const y1 = yTop - row * (ch + GAP)
      ports.push({
        x0,
        y0: y1 - ch,
        x1: x0 + cw,
        y1,
        group: gi,
        index: i,
        row,
        speedG: l.g.speedG,
        kind: l.kind,
        fill: speedFill(l.g.speedG)
      })
    }
    x += l.width * scale + GROUP_GAP * scale
  })

  return { chassis, ears, ports, labelBox, scale, w, h }
}

export interface SchematicPanelOptions {
  /** Chassis fill / line colours. */
  fill?: string
  line?: string
  /**
   * Text printed on the bezel (left of the ports). Off by default: text is
   * paper-sized, so even 3pt covers ~4 drawing inches at 1:12 and the model
   * id would spill over the cages — the device label under the panel names
   * the model instead.
   */
  text?: string
  /** Bezel text size in paper points. Default 3. */
  fontPt?: number
}

/**
 * Draw the schematic panel as one native group centred at (x, y) on the
 * sink (a page). Returns the group's ShapeRef (bbox = chassis).
 */
export function buildSchematicPanel(
  diag: Diagram,
  sink: ShapeSink,
  spec: SchematicSpec & { x: number; y: number },
  opts: SchematicPanelOptions = {}
): ShapeRef {
  const geo = schematicGeometry(spec)
  const fill = opts.fill ?? '#F2F2F2'
  const line = opts.line ?? '#404040'
  const c = (r: Rect): { x: number; y: number; w: number; h: number } => ({
    x: (r.x0 + r.x1) / 2,
    y: (r.y0 + r.y1) / 2,
    w: r.x1 - r.x0,
    h: r.y1 - r.y0
  })
  return diag.group(sink, spec.x, spec.y, geo.w, geo.h, (g) => {
    const ch = c(geo.chassis)
    diag.box(g, ch.x, ch.y, ch.w, ch.h, { fill, line, weight: 0.012 })
    for (const ear of geo.ears) {
      const e = c(ear)
      diag.box(g, e.x, e.y, e.w, e.h, { fill: '#D9D9D9', line, weight: 0.006 })
    }
    for (const p of geo.ports) {
      const r = c(p)
      diag.box(g, r.x, r.y, r.w, r.h, { fill: p.fill, line: '#262626', weight: 0.004 })
    }
    // Bezel (status LEDs / branding area) left of the ports.
    const lb = c(geo.labelBox)
    diag.box(g, lb.x, lb.y, lb.w, lb.h, { fill: '#3A3A3A', line: '#262626', weight: 0.004 })
    if (opts.text) diag.text(g, lb.x, lb.y, lb.w, lb.h, opts.text, { fontPt: opts.fontPt ?? 3, color: '#FFFFFF' })
  })
}
