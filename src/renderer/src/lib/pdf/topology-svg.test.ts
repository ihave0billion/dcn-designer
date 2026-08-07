import { describe, it, expect } from 'vitest'
import { layoutTopologyForPdf } from './topology-svg'
import type { TopologyEdge, TopologyGraph, TopologyNode, TopologyRole } from '@/lib/topology-extractor'

function node(
  id: string,
  role: TopologyRole,
  pod_index: number | null = null
): TopologyNode {
  return {
    id,
    role,
    model_id: 'N9K-C9364D-GX2A',
    rack: 'Rack A',
    label: id,
    ru: 2,
    power_w: 1200,
    pod_index,
    usedPorts: []
  }
}

function edge(id: string, source: string, target: string): TopologyEdge {
  return {
    id,
    source,
    sourcePort: 'Eth1/1',
    target,
    targetPort: 'Eth1/49',
    speed_g: 400,
    optic_id: null,
    patch_panel_id: null,
    label: '',
    length_m: null
  }
}

function graph(nodes: TopologyNode[], edges: TopologyEdge[] = []): TopologyGraph {
  return { nodes, edges, orphanDeviceIds: [] }
}

const WIDTH = 720

describe('layoutTopologyForPdf', () => {
  it('stacks spines above leaves and draws no pod boxes on a single-pod design', () => {
    const layout = layoutTopologyForPdf(
      graph([node('spine-1', 'spine'), node('spine-2', 'spine'), node('leaf-1', 'leaf'), node('leaf-2', 'leaf')]),
      { width: WIDTH }
    )

    expect(layout.pods).toEqual([])
    expect(layout.counts).toEqual({ spine: 2, leaf: 2, ipn: 0 })

    const spineY = layout.nodes.filter((n) => n.role === 'spine').map((n) => n.y)
    const leafY = layout.nodes.filter((n) => n.role === 'leaf').map((n) => n.y)
    expect(Math.max(...spineY)).toBeLessThan(Math.min(...leafY))
  })

  it('puts IPN routers above every pod and boxes each pod', () => {
    const layout = layoutTopologyForPdf(
      graph([
        node('ipn-1', 'ipn'),
        node('spine-1', 'spine', 0),
        node('leaf-1', 'leaf', 0),
        node('spine-2', 'spine', 1),
        node('leaf-2', 'leaf', 1)
      ]),
      { width: WIDTH }
    )

    expect(layout.pods.map((p) => p.label)).toEqual(['Pod 1', 'Pod 2'])
    const ipn = layout.nodes.find((n) => n.id === 'ipn-1')!
    expect(ipn.y).toBe(0)
    // Every pod box starts below the IPN row.
    for (const pod of layout.pods) expect(pod.y).toBeGreaterThan(ipn.y + ipn.h)
    // Pod boxes don't overlap.
    expect(layout.pods[0].y + layout.pods[0].h).toBeLessThanOrEqual(layout.pods[1].y)
    // Each pod's members sit inside its box.
    for (const pod of layout.pods) {
      const members = layout.nodes.filter((n) => n.pod_index === pod.pod_index)
      expect(members.length).toBeGreaterThan(0)
      for (const m of members) {
        expect(m.y).toBeGreaterThanOrEqual(pod.y)
        expect(m.y + m.h).toBeLessThanOrEqual(pod.y + pod.h)
      }
    }
  })

  it('wraps a wide leaf row and keeps every box inside the drawing width', () => {
    const leaves = Array.from({ length: 111 }, (_, i) => node(`leaf-${i + 1}`, 'leaf'))
    const layout = layoutTopologyForPdf(graph([node('spine-1', 'spine'), ...leaves]), {
      width: WIDTH
    })

    const leafBoxes = layout.nodes.filter((n) => n.role === 'leaf')
    expect(leafBoxes).toHaveLength(111)
    // More than one distinct row.
    expect(new Set(leafBoxes.map((n) => n.y)).size).toBeGreaterThan(1)
    for (const box of layout.nodes) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.w).toBeLessThanOrEqual(WIDTH + 0.001)
    }
    expect(layout.height).toBeGreaterThan(0)
  })

  it('collapses port-level links to one line per device pair, carrying the count', () => {
    const layout = layoutTopologyForPdf(
      graph(
        [node('spine-1', 'spine'), node('leaf-1', 'leaf'), node('leaf-2', 'leaf')],
        [
          edge('l1', 'spine-1', 'leaf-1'),
          edge('l2', 'spine-1', 'leaf-1'),
          edge('l3', 'spine-1', 'leaf-1'),
          edge('l4', 'spine-1', 'leaf-2')
        ]
      ),
      { width: WIDTH }
    )

    expect(layout.edges).toHaveLength(2)
    expect(layout.edges.find((e) => e.id === 'spine-1->leaf-1')?.count).toBe(3)
    expect(layout.edges.find((e) => e.id === 'spine-1->leaf-2')?.count).toBe(1)
    expect(layout.edges_omitted).toBeNull()
  })

  it('anchors each line on the facing edge of its boxes', () => {
    const layout = layoutTopologyForPdf(
      graph([node('spine-1', 'spine'), node('leaf-1', 'leaf')], [edge('l1', 'spine-1', 'leaf-1')]),
      { width: WIDTH }
    )
    const spine = layout.nodes.find((n) => n.id === 'spine-1')!
    const leaf = layout.nodes.find((n) => n.id === 'leaf-1')!
    const line = layout.edges[0]

    // Leaves render below spines, so the line leaves the spine's bottom and
    // arrives at the leaf's top — it must not cut through either box.
    expect(line.y1).toBe(spine.y + spine.h)
    expect(line.y2).toBe(leaf.y)
    expect(line.x1).toBe(spine.x + spine.w / 2)
    expect(line.x2).toBe(leaf.x + leaf.w / 2)
  })

  it('drops edges past the pair cap and reports what it dropped', () => {
    const leaves = Array.from({ length: 10 }, (_, i) => node(`leaf-${i + 1}`, 'leaf'))
    const edges = leaves.flatMap((l, i) => [
      edge(`a${i}`, 'spine-1', l.id),
      edge(`b${i}`, 'spine-1', l.id)
    ])
    const layout = layoutTopologyForPdf(graph([node('spine-1', 'spine'), ...leaves], edges), {
      width: WIDTH,
      maxEdgePairs: 5
    })

    expect(layout.edges).toEqual([])
    expect(layout.edges_omitted).toEqual({ pairs: 10, links: 20 })
    // Nodes are still drawn — only the wiring is suppressed.
    expect(layout.nodes).toHaveLength(11)
  })

  it('skips edges whose endpoints are not laid out', () => {
    const layout = layoutTopologyForPdf(
      graph([node('spine-1', 'spine')], [edge('l1', 'spine-1', 'ghost-9')]),
      { width: WIDTH }
    )
    expect(layout.edges).toEqual([])
  })

  it('is deterministic — same graph in, same geometry out', () => {
    const g = graph(
      [node('spine-1', 'spine', 0), node('leaf-1', 'leaf', 0), node('leaf-2', 'leaf', 0)],
      [edge('l1', 'spine-1', 'leaf-1'), edge('l2', 'spine-1', 'leaf-2')]
    )
    expect(layoutTopologyForPdf(g, { width: WIDTH })).toEqual(
      layoutTopologyForPdf(g, { width: WIDTH })
    )
  })

  it('handles an empty graph without producing geometry', () => {
    const layout = layoutTopologyForPdf(graph([]), { width: WIDTH })
    expect(layout).toMatchObject({
      nodes: [],
      edges: [],
      pods: [],
      height: 0,
      counts: { spine: 0, leaf: 0, ipn: 0 }
    })
  })
})
