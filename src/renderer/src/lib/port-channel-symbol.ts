// Phase 15 — the vPC peer-link drawn the way engineers draw a port-channel:
// the member cables as straight parallel lines between the two switches and
// the Cisco port-channel oval across their middle — a tall ellipse whose
// long axis runs ACROSS the cables, centred on the bundle. No text: the oval
// is the peer-link. Shared by the on-screen topology, the PDF report and the
// Visio export so the three agree on the symbol.

export interface Pt {
  x: number
  y: number
}

export interface BundleOptions {
  /** Distance between neighbouring member lines (px / drawing units). */
  gap?: number
  /** Extra sideways shift of the whole bundle (per-cable edges fan with this). */
  offset?: number
  /** How many lines the ring is sized for (defaults to `lines`). */
  ringLines?: number
  /** Half-width of the oval along the cables (the short axis). */
  ringRx?: number
  /** Clearance beyond the outermost line, across the cables (the long axis grows with it). */
  ringPad?: number
  /** Distance from the ring to the label anchor, across the cables. */
  labelGap?: number
}

export interface BundleGeometry {
  /** One straight segment per member line, sideways-offset around the axis. */
  lines: Array<[Pt, Pt]>
  /** Midpoint of the a→b axis (centre of the ring). */
  mid: Pt
  /** Rotation of the axis in degrees, screen orientation (y down). */
  angleDeg: number
  /** Ring radii: rx along the cables, ry across them. */
  rx: number
  ry: number
  /**
   * Where a label goes: just outside the ring, on the side that points "down"
   * (or right for a vertical bundle) so it never sits on the switches.
   */
  labelAnchor: Pt
  /** Unit normal used for the label side (down / right). */
  normal: Pt
}

/**
 * Straight parallel lines from a to b plus the ring parameters. Degenerate
 * inputs (a === b) fall back to a horizontal axis so callers never divide by
 * zero.
 */
export function bundleGeometry(a: Pt, b: Pt, lines: number, opts: BundleOptions = {}): BundleGeometry {
  const gap = opts.gap ?? 5
  const offset = opts.offset ?? 0
  const rx = opts.ringRx ?? 6
  const ringPad = opts.ringPad ?? 9
  const labelGap = opts.labelGap ?? 12
  const n = Math.max(1, Math.floor(lines))
  const ringLines = Math.max(n, Math.floor(opts.ringLines ?? n))

  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  const ux = len > 0 ? dx / len : 1
  const uy = len > 0 ? dy / len : 0
  // Normal pointing down (screen y grows downward); for a purely vertical
  // axis point it right, so labels sit below a horizontal bundle and to the
  // right of a vertical one.
  let nx = -uy
  let ny = ux
  if (ny < 0 || (ny === 0 && nx < 0)) {
    nx = -nx
    ny = -ny
  }
  // Squash -0 so callers comparing / serialising the normal see plain zeros.
  nx += 0
  ny += 0

  const segs: Array<[Pt, Pt]> = []
  for (let i = 0; i < n; i++) {
    const d = (i - (n - 1) / 2) * gap + offset
    segs.push([
      { x: a.x + nx * d, y: a.y + ny * d },
      { x: b.x + nx * d, y: b.y + ny * d }
    ])
  }
  const mid = { x: (a.x + b.x) / 2 + nx * offset, y: (a.y + b.y) / 2 + ny * offset }
  const ry = ((ringLines - 1) * gap) / 2 + ringPad
  const angleDeg = (Math.atan2(uy, ux) * 180) / Math.PI
  return {
    lines: segs,
    mid,
    angleDeg,
    rx,
    ry,
    labelAnchor: { x: mid.x + nx * (ry + labelGap), y: mid.y + ny * (ry + labelGap) },
    normal: { x: nx, y: ny }
  }
}

/** SVG path for the member lines: one `M … L …` sub-path per line. */
export function bundlePath(g: BundleGeometry): string {
  return g.lines.map(([p, q]) => `M ${p.x} ${p.y} L ${q.x} ${q.y}`).join(' ')
}

/**
 * Where a peer-link leaves its two switch tiles on screen. React-flow only
 * hands us the flow handles — the source's bottom-centre and the target's
 * top-centre in the vertical layout (right / left when horizontal). Both
 * ends are leaves in the same row, so the cables run between the *facing*
 * sides of the two icon boxes instead: right side of the left one to the
 * left side of the right one (bottom → top when the layout is horizontal).
 * `box` is the icon tile size the handles sit on.
 *
 * Tiles are free-drag, so two members of a pair are often a few pixels
 * apart vertically; a bundle that follows that would slant and tilt the
 * oval. When the two centres are within half a tile of each other the
 * bundle is levelled at their mean, which still lands on both side edges.
 */
export function peerLinkEndpoints(
  h: { sourceX: number; sourceY: number; targetX: number; targetY: number },
  horizontal: boolean,
  box = 56
): [Pt, Pt] {
  const half = box / 2
  if (!horizontal) {
    const sc = { x: h.sourceX, y: h.sourceY - half }
    const tc = { x: h.targetX, y: h.targetY + half }
    const level = Math.abs(sc.y - tc.y) <= half
    const y = (sc.y + tc.y) / 2
    const sign = tc.x >= sc.x ? 1 : -1
    return [
      { x: sc.x + sign * half, y: level ? y : sc.y },
      { x: tc.x - sign * half, y: level ? y : tc.y }
    ]
  }
  const sc = { x: h.sourceX - half, y: h.sourceY }
  const tc = { x: h.targetX + half, y: h.targetY }
  const level = Math.abs(sc.x - tc.x) <= half
  const x = (sc.x + tc.x) / 2
  const sign = tc.y >= sc.y ? 1 : -1
  return [
    { x: level ? x : sc.x, y: sc.y + sign * half },
    { x: level ? x : tc.x, y: tc.y - sign * half }
  ]
}
