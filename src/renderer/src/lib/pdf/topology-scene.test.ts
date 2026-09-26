import { describe, expect, it } from 'vitest'
import { buildPdfScenePages, rectEdgePoint, PANEL_W } from './topology-scene'
import type { TopologyGraph, TopologyNode } from '@/lib/topology-extractor'
import { TOPOLOGY_LAYOUT_GENERATOR } from '@/schemas/topology-layout'

function dev(id: string, role: TopologyNode['role'], model = 'N9K-C9364D-GX2A'): TopologyNode {
  return { id, role, model_id: model, rack: 'A', label: id, ru: 1, power_w: null, pod_index: null, usedPorts: [] }
}

const graph: TopologyGraph = {
  nodes: [dev('spine-1', 'spine'), dev('spine-2', 'spine'), dev('leaf-1', 'leaf', 'N9K-C93400LD-H1'), dev('leaf-2', 'leaf', 'N9K-C93400LD-H1')],
  edges: ['spine-1', 'spine-2'].flatMap((s) =>
    ['leaf-1', 'leaf-2'].flatMap((l) =>
      [1, 2].map((k) => ({
        id: `${s}-${l}-${k}`,
        source: s,
        sourcePort: `Eth1/${k}`,
        target: l,
        targetPort: `Eth1/4${k}`,
        speed_g: 100,
        optic_id: null,
        patch_panel_id: null,
        label: '',
        length_m: null
      }))
    )
  ),
  orphanDeviceIds: []
}

describe('buildPdfScenePages', () => {
  it('draws one page per fabric with spines above leaves and 4 device-pair edges', () => {
    const [page] = buildPdfScenePages(graph, 'Acme', null)
    expect(page.title).toBe('Topology')
    expect(page.nodes).toHaveLength(4)
    expect(page.edges).toHaveLength(4)
    expect(page.edges.every((e) => e.count === 2)).toBe(true)
    const spine = page.nodes.find((n) => n.id === 'spine-1')!
    const leaf = page.nodes.find((n) => n.id === 'leaf-1')!
    expect(spine.y).toBeLessThan(leaf.y)
    expect(spine.labelAbove).toBe(true)
    expect(leaf.labelAbove).toBe(false)
    expect(page.counts).toEqual({ spine: 2, leaf: 2, ipn: 0 })
    expect(page.width).toBeGreaterThan(PANEL_W * 2)
  })

  it('edge endpoints sit on the panel rectangles', () => {
    const [page] = buildPdfScenePages(graph, 'Acme', null)
    const byId = new Map(page.nodes.map((n) => [n.id, n]))
    for (const e of page.edges) {
      const a = byId.get(e.source)!
      const b = byId.get(e.target)!
      expect(a.role).toBe('spine')
      expect(b.role).toBe('leaf')
      expect(e.y1).toBeCloseTo(a.y + a.h, 5) // leaves the spine through its bottom edge
      expect(e.y2).toBeCloseTo(b.y, 5) // enters the leaf through its top edge
    }
  })

  it('honours saved positions and reports the page as custom', () => {
    const [auto] = buildPdfScenePages(graph, 'Acme', null)
    const [page] = buildPdfScenePages(graph, 'Acme', {
      schema_version: 1,
      source: 'user',
      seeded_at: null,
      forked_at: null,
      positions: [],
      generator: TOPOLOGY_LAYOUT_GENERATOR,
      scene_positions: [{ scene: 'devices:fabric|vertical', node_id: 'leaf-2', x: 900, y: 700 }]
    })
    expect(page.custom).toBe(true)
    const moved = page.nodes.find((n) => n.id === 'leaf-2')!
    const was = auto.nodes.find((n) => n.id === 'leaf-2')!
    expect(moved.y).toBeGreaterThan(was.y)
    expect(page.height).toBeGreaterThan(auto.height)
  })

  it('attaches images by model and omits edges past the threshold', () => {
    const images = new Map([['N9K-C9364D-GX2A', { url: 'data:image/png;base64,AAAA', aspect: 11 }]])
    const [page] = buildPdfScenePages(graph, 'Acme', null, { images, maxEdges: 2, ruOf: () => 2 })
    expect(page.nodes.find((n) => n.id === 'spine-1')!.image).toBe('data:image/png;base64,AAAA')
    expect(page.nodes.find((n) => n.id === 'leaf-1')!.image).toBeNull()
    expect(page.edges).toHaveLength(0)
    expect(page.edgesOmitted).toEqual({ links: 8, pairs: 4 })
    expect(page.nodes.find((n) => n.id === 'leaf-1')!.h).toBe(20)
    expect(page.nodes.find((n) => n.id === 'spine-1')!.h).toBe(14)
  })

  it('keeps a photo\'s aspect and caps its height', () => {
    const images = new Map([['N9K-C9364D-GX2A', { url: 'data:image/jpeg;base64,AAAA', aspect: 1.25 }]])
    const [page] = buildPdfScenePages(graph, 'Acme', null, { images })
    const s = page.nodes.find((n) => n.id === 'spine-1')!
    expect(s.h).toBe(76)
    expect(s.w).toBeCloseTo(95, 5)
  })

  it('wraps a wide automatic layout into rows for paper, but not a custom layout', () => {
    const many: TopologyGraph = {
      nodes: [dev('spine-1', 'spine'), ...Array.from({ length: 24 }, (_, i) => dev(`leaf-${i + 1}`, 'leaf'))],
      edges: [],
      orphanDeviceIds: []
    }
    const [auto] = buildPdfScenePages(many, 'Acme', null)
    expect(new Set(auto.nodes.filter((n) => n.role === 'leaf').map((n) => n.y)).size).toBe(2) // 12 + 12
    const [wide] = buildPdfScenePages(many, 'Acme', null, { rowMax: 40 })
    expect(new Set(wide.nodes.filter((n) => n.role === 'leaf').map((n) => n.y)).size).toBe(1)
  })

  it('rectEdgePoint lands on the rectangle border', () => {
    expect(rectEdgePoint(0, 0, 10, 5, 0, 100)).toEqual({ x: 0, y: 5 })
    expect(rectEdgePoint(0, 0, 10, 5, 100, 0)).toEqual({ x: 10, y: 0 })
    const p = rectEdgePoint(0, 0, 10, 5, 100, 100)
    expect(p).toEqual({ x: 5, y: 5 })
  })
})
