import { describe, expect, it } from 'vitest'
import { buildPdfScenePages, rectEdgePoint, PANEL_W, SERVER_W, PAIR_PAD } from './topology-scene'
import { TILE_H, TILE_W } from '@/lib/topology-hierarchy'
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
        kind: 'uplink' as const,
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
    expect(page.counts).toEqual({ spine: 2, leaf: 2, ipn: 0, server: 0 })
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
      show_servers: false,
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

describe('buildPdfScenePages — vPC pairs + servers (Phase 14)', () => {
  const paired = (peerLink: boolean): TopologyGraph => ({
    ...graph,
    nodes: graph.nodes.map((n) => (n.role === 'leaf' ? { ...n, pair_id: 'pair-1', pair_peer: n.id === 'leaf-1' ? 'leaf-2' : 'leaf-1' } : n)),
    pairs: [{ id: 'pair-1', members: ['leaf-1', 'leaf-2'] }],
    edges: [
      ...graph.edges,
      ...(peerLink
        ? [1, 2].map((k) => ({ id: `pl-${k}`, kind: 'vpc-peer-link' as const, source: 'leaf-1', sourcePort: `Eth1/4${8 + k}`, target: 'leaf-2', targetPort: `Eth1/4${8 + k}`, speed_g: 400, optic_id: null, patch_panel_id: null, label: '', length_m: null }))
        : [])
    ]
  })
  const serverInfo = () => ({ model_id: 'UCS-C220-M7', label: 'UCS C220 M7', nics: 2, nic_speed_g: 25, ru: 1 })

  it('draws the peer-link as one red-kind edge between the leaves and counts it', () => {
    const [page] = buildPdfScenePages(paired(true), 'Acme', null)
    const pl = page.edges.filter((e) => e.kind === 'vpc-peer-link')
    expect(pl).toHaveLength(1)
    expect(pl[0]).toMatchObject({ source: 'leaf-1', target: 'leaf-2', count: 2, dashed: false })
    expect(page.peerLinks).toBe(1)
    expect(page.pairs).toEqual([])
    expect(page.edges.filter((e) => e.kind === 'fabric')).toHaveLength(4)
  })

  it('brackets a pair that has no peer-link, padded around both tiles', () => {
    const [page] = buildPdfScenePages(paired(false), 'Acme', null)
    expect(page.peerLinks).toBe(0)
    expect(page.pairs).toHaveLength(1)
    const p = page.pairs[0]
    const a = page.nodes.find((n) => n.id === 'leaf-1')!
    const b = page.nodes.find((n) => n.id === 'leaf-2')!
    // the bracket spans both tiles (tile = panel centre ± TILE_W/2) plus padding
    expect(p.x).toBeCloseTo(Math.min(a.x + a.w / 2, b.x + b.w / 2) - TILE_W / 2 - PAIR_PAD, 5)
    expect(p.w).toBeCloseTo(Math.abs(a.x - b.x) + TILE_W + 2 * PAIR_PAD, 5)
    expect(p.h).toBeCloseTo(TILE_H + 2 * PAIR_PAD, 5)
    expect(p.label).toBe('vPC pair')
  })

  it('adds one server symbol per pair under the leaves with two NIC lines when show_servers is on', () => {
    const off = buildPdfScenePages(paired(true), 'Acme', null, { serverInfo })
    expect(off[0].nodes.some((n) => n.kind === 'server')).toBe(false)
    const [page] = buildPdfScenePages(paired(true), 'Acme', null, { showServers: true, serverInfo })
    const servers = page.nodes.filter((n) => n.kind === 'server')
    expect(servers).toHaveLength(1)
    expect(servers[0]).toMatchObject({ id: 'server:pair-1', label: 'UCS C220 M7', sublabel: '2×25G', modelId: 'UCS-C220-M7', w: SERVER_W })
    expect(page.counts.server).toBe(1)
    const leafY = page.nodes.find((n) => n.id === 'leaf-1')!.y
    expect(servers[0].y).toBeGreaterThan(leafY)
    const lines = page.edges.filter((e) => e.kind === 'server')
    expect(lines.map((e) => e.source).sort()).toEqual(['leaf-1', 'leaf-2'])
    expect(lines.every((e) => e.target === 'server:pair-1' && e.count === 1)).toBe(true)
  })
})
