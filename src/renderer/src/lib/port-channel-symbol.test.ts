import { describe, expect, it } from 'vitest'
import { bundleGeometry, bundlePath, peerLinkEndpoints } from './port-channel-symbol'

describe('bundleGeometry', () => {
  it('draws n straight parallel lines centred on the a→b axis', () => {
    const g = bundleGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 2, { gap: 6 })
    expect(g.lines).toHaveLength(2)
    expect(g.lines[0]).toEqual([
      { x: 0, y: -3 },
      { x: 100, y: -3 }
    ])
    expect(g.lines[1]).toEqual([
      { x: 0, y: 3 },
      { x: 100, y: 3 }
    ])
    expect(g.mid).toEqual({ x: 50, y: 0 })
    expect(g.angleDeg).toBe(0)
  })

  it('sizes the ring for the member count and puts the label below a horizontal bundle', () => {
    const g = bundleGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 2, { gap: 6, ringPad: 5, ringRx: 20, labelGap: 10 })
    expect(g.rx).toBe(20)
    expect(g.ry).toBe(3 + 5)
    expect(g.labelAnchor).toEqual({ x: 50, y: 8 + 10 })
    // A single cable still gets a ring the pad wide.
    expect(bundleGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 1, { ringPad: 5 }).ry).toBe(5)
    // Defaults: a tall oval across the cables (ry > rx), like the Cisco glyph.
    const d = bundleGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 2)
    expect(d.ry).toBeGreaterThan(d.rx)
  })

  it('puts the label to the right of a vertical bundle whichever way it runs', () => {
    const down = bundleGeometry({ x: 10, y: 0 }, { x: 10, y: 80 }, 2)
    const up = bundleGeometry({ x: 10, y: 80 }, { x: 10, y: 0 }, 2)
    expect(down.normal).toEqual({ x: 1, y: 0 })
    expect(up.normal).toEqual({ x: 1, y: 0 })
    expect(down.labelAnchor.x).toBeGreaterThan(10)
    expect(up.labelAnchor.x).toBeGreaterThan(10)
    expect(Math.abs(down.angleDeg)).toBe(90)
  })

  it('keeps the label below the bundle when a and b are swapped', () => {
    const lr = bundleGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 2)
    const rl = bundleGeometry({ x: 100, y: 0 }, { x: 0, y: 0 }, 2)
    expect(lr.labelAnchor.y).toBeGreaterThan(0)
    expect(rl.labelAnchor.y).toBeGreaterThan(0)
  })

  it('shifts a per-cable edge sideways and sizes its ring for all siblings', () => {
    const g = bundleGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 1, { gap: 6, offset: 3, ringLines: 2, ringPad: 5 })
    expect(g.lines).toEqual([
      [
        { x: 0, y: 3 },
        { x: 100, y: 3 }
      ]
    ])
    expect(g.ry).toBe(8)
    // The ring stays on the bundle axis (offset 3 back to the centre line is
    // the sibling's job) — mid follows the offset so a lone edge is centred.
    expect(g.mid.y).toBe(3)
  })

  it('survives coincident endpoints', () => {
    const g = bundleGeometry({ x: 5, y: 5 }, { x: 5, y: 5 }, 2)
    expect(g.lines.every(([p, q]) => Number.isFinite(p.x) && Number.isFinite(q.y))).toBe(true)
    expect(g.angleDeg).toBe(0)
  })

  it('renders one M/L sub-path per line', () => {
    const g = bundleGeometry({ x: 0, y: 0 }, { x: 10, y: 0 }, 2, { gap: 2 })
    expect(bundlePath(g)).toBe('M 0 -1 L 10 -1 M 0 1 L 10 1')
  })
})

describe('peerLinkEndpoints', () => {
  // Vertical layout: source handle = bottom-centre of the source icon box,
  // target handle = top-centre of the target box. Two 56 px tiles on one
  // row, 100 px apart: the cables run from the source's right side to the
  // target's left side, at mid-height.
  it('joins the facing sides of two tiles on one row (vertical layout)', () => {
    const [a, b] = peerLinkEndpoints({ sourceX: 28, sourceY: 56, targetX: 128, targetY: 0 }, false)
    expect(a).toEqual({ x: 56, y: 28 })
    expect(b).toEqual({ x: 100, y: 28 })
  })

  it('flips sides when the target sits left of the source', () => {
    const [a, b] = peerLinkEndpoints({ sourceX: 128, sourceY: 56, targetX: 28, targetY: 0 }, false)
    expect(a).toEqual({ x: 100, y: 28 })
    expect(b).toEqual({ x: 56, y: 28 })
  })

  it('levels the bundle when the tiles are a few pixels apart, but not when they are on different rows', () => {
    // Target dragged 6 px lower than the source: both ends at the mean height.
    const [a, b] = peerLinkEndpoints({ sourceX: 28, sourceY: 56, targetX: 128, targetY: 6 }, false)
    expect(a).toEqual({ x: 56, y: 31 })
    expect(b).toEqual({ x: 100, y: 31 })
    // Target a whole row lower: the bundle really slants.
    const [c, d] = peerLinkEndpoints({ sourceX: 28, sourceY: 56, targetX: 128, targetY: 100 }, false)
    expect(c.y).toBe(28)
    expect(d.y).toBe(128)
    // Horizontal layout: level on x.
    const [e, f] = peerLinkEndpoints({ sourceX: 56, sourceY: 28, targetX: 4, targetY: 128 }, true)
    expect(e.x).toBe(30)
    expect(f.x).toBe(30)
  })

  it('joins bottom to top when the layout is horizontal', () => {
    // Source handle = right-centre, target handle = left-centre; tiles
    // stacked 100 px apart in one column.
    const [a, b] = peerLinkEndpoints({ sourceX: 56, sourceY: 28, targetX: 0, targetY: 128 }, true)
    expect(a).toEqual({ x: 28, y: 56 })
    expect(b).toEqual({ x: 28, y: 100 })
  })
})
