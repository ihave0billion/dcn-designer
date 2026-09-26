import { describe, it, expect } from 'vitest'
import type { TopologyGraph, TopologyNode, TopologyEdge } from './topology-extractor'
import {
  buildFabrics,
  buildScene,
  deviceStatus,
  drillInto,
  edgeLabel,
  GROUP_ID,
  layoutScene,
  matchesFilter,
  parentLevel,
  parseFilter,
  TILE_H,
  TILE_W,
  TIER_GAP,
  worstStatus
} from './topology-hierarchy'

function dev(
  id: string,
  role: TopologyNode['role'],
  extra: Partial<TopologyNode> = {}
): TopologyNode {
  return {
    id,
    role,
    model_id: role === 'spine' ? 'N9K-SPINE' : role === 'ipn' ? 'N9K-IPN' : 'N9K-LEAF',
    rack: null,
    label: id.replace('-', ' '),
    ru: null,
    power_w: null,
    pod_index: null,
    usedPorts: ['Eth1/1'],
    ...extra
  }
}

function link(id: string, a: string, b: string, speed = 400): TopologyEdge {
  return {
    id,
    source: a,
    sourcePort: 'Eth1/1',
    target: b,
    targetPort: 'Eth1/49',
    speed_g: speed,
    optic_id: null,
    patch_panel_id: null,
    label: '',
    length_m: null
  }
}

// 2 spines, 3 leaves, every leaf dual-homed → 6 cables.
function singlePod(): TopologyGraph {
  const nodes = [
    dev('spine-1', 'spine'),
    dev('spine-2', 'spine'),
    dev('leaf-1', 'leaf', { pod_index: 0 }),
    dev('leaf-2', 'leaf', { pod_index: 0 }),
    dev('leaf-10', 'leaf', { pod_index: 1 })
  ]
  const edges: TopologyEdge[] = []
  let i = 0
  for (const s of ['spine-1', 'spine-2'])
    for (const l of ['leaf-1', 'leaf-2', 'leaf-10']) edges.push(link(`link-${++i}`, s, l))
  return { nodes, edges, orphanDeviceIds: [] }
}

// Two pods with 2 spines + 2 leaves each, plus 2 IPN routers wired to every spine.
function multiPod(): TopologyGraph {
  const nodes = [
    dev('ipn-1', 'ipn'),
    dev('ipn-2', 'ipn'),
    dev('spine-1', 'spine', { pod_index: 0 }),
    dev('spine-2', 'spine', { pod_index: 0 }),
    dev('spine-3', 'spine', { pod_index: 1 }),
    dev('spine-4', 'spine', { pod_index: 1 }),
    dev('leaf-1', 'leaf', { pod_index: 0 }),
    dev('leaf-2', 'leaf', { pod_index: 0 }),
    dev('leaf-3', 'leaf', { pod_index: 1 }),
    dev('leaf-4', 'leaf', { pod_index: 1 })
  ]
  const edges: TopologyEdge[] = []
  let i = 0
  for (const s of ['spine-1', 'spine-2']) for (const l of ['leaf-1', 'leaf-2']) edges.push(link(`l${++i}`, s, l))
  for (const s of ['spine-3', 'spine-4']) for (const l of ['leaf-3', 'leaf-4']) edges.push(link(`l${++i}`, s, l))
  for (const ipn of ['ipn-1', 'ipn-2'])
    for (const s of ['spine-1', 'spine-2', 'spine-3', 'spine-4']) edges.push(link(`l${++i}`, s, ipn, 100))
  return { nodes, edges, orphanDeviceIds: [] }
}

describe('buildFabrics', () => {
  it('single-pod design is one fabric named after the project (leaf pairing index ignored)', () => {
    const fabrics = buildFabrics(singlePod(), 'SITE-A')
    expect(fabrics).toHaveLength(1)
    expect(fabrics[0]).toMatchObject({ id: 'fabric', label: 'SITE-A', podIndex: null })
    expect(fabrics[0].spineIds).toEqual(['spine-1', 'spine-2'])
    expect(fabrics[0].leafIds).toEqual(['leaf-1', 'leaf-2', 'leaf-10'])
  })

  it('multi-pod design yields one fabric per spine pod, leaves follow their pod', () => {
    const fabrics = buildFabrics(multiPod(), 'X')
    expect(fabrics.map((f) => f.label)).toEqual(['Pod 1', 'Pod 2'])
    expect(fabrics[0].spineIds).toEqual(['spine-1', 'spine-2'])
    expect(fabrics[1].leafIds).toEqual(['leaf-3', 'leaf-4'])
  })
})

describe('buildScene', () => {
  it('fabrics level: one globe tile with the whole design folded into it, no edges', () => {
    const g = singlePod()
    const scene = buildScene(g, buildFabrics(g, 'SITE-A'), { kind: 'fabrics' }, { aggregate: true })
    expect(scene.nodes).toHaveLength(1)
    expect(scene.nodes[0]).toMatchObject({ kind: 'fabric', label: 'SITE-A', count: 5, status: 'healthy' })
    expect(scene.edges).toEqual([])
    expect(scene.breadcrumb.map((c) => c.label)).toEqual(['All fabrics'])
  })

  it('fabric level: Spines + Leaves stacks joined by one aggregated edge', () => {
    const g = singlePod()
    const scene = buildScene(g, buildFabrics(g, 'SITE-A'), { kind: 'fabric', fabricId: 'fabric' }, { aggregate: true })
    const ids = scene.nodes.map((n) => n.id).sort()
    expect(ids).toEqual([GROUP_ID('fabric', 'leaf'), GROUP_ID('fabric', 'spine')].sort())
    const spines = scene.nodes.find((n) => n.id === GROUP_ID('fabric', 'spine'))!
    expect(spines).toMatchObject({ kind: 'group', count: 2, tier: 1, sublabel: 'N9K-SPINE' })
    expect(scene.edges).toHaveLength(1)
    expect(scene.edges[0]).toMatchObject({
      source: GROUP_ID('fabric', 'spine'),
      target: GROUP_ID('fabric', 'leaf'),
      count: 6,
      label: '6 × 400G'
    })
    expect(scene.breadcrumb.map((c) => c.label)).toEqual(['All fabrics', 'SITE-A'])
  })

  it('devices level: every switch is a tile; aggregate folds parallel cables per pair', () => {
    const g = singlePod()
    const fabrics = buildFabrics(g, 'SITE-A')
    const agg = buildScene(g, fabrics, { kind: 'devices', fabricId: 'fabric' }, { aggregate: true })
    expect(agg.nodes.filter((n) => n.kind === 'device')).toHaveLength(5)
    expect(agg.edges).toHaveLength(6) // 2 spines × 3 leaves, one cable each → same count
    const raw = buildScene(g, fabrics, { kind: 'devices', fabricId: 'fabric' }, { aggregate: false })
    expect(raw.edges).toHaveLength(6)
    expect(raw.edges.every((e) => e.source.startsWith('spine'))).toBe(true) // spine on top
    expect(agg.breadcrumb.map((c) => c.label)).toEqual(['All fabrics', 'SITE-A', 'Switches'])
  })

  it('multi-pod: IPNs are external tiles at every level and link to fabrics / spines', () => {
    const g = multiPod()
    const fabrics = buildFabrics(g, 'X')
    const top = buildScene(g, fabrics, { kind: 'fabrics' }, { aggregate: true })
    expect(top.nodes.map((n) => n.kind).sort()).toEqual(['fabric', 'fabric', 'ipn', 'ipn'])
    // 2 IPN × 2 pods aggregated pairs
    expect(top.edges).toHaveLength(4)
    expect(top.edges.every((e) => e.source.startsWith('ipn'))).toBe(true)
    expect(top.edges[0].count).toBe(2)

    const pod1 = buildScene(g, fabrics, { kind: 'fabric', fabricId: 'pod-0' }, { aggregate: true })
    // The other pod shows up as an external globe because the IPNs reach it (ND does the same).
    expect(pod1.nodes.map((n) => n.id).sort()).toEqual(
      ['ipn-1', 'ipn-2', 'pod-1', GROUP_ID('pod-0', 'spine'), GROUP_ID('pod-0', 'leaf')].sort()
    )
    expect(pod1.nodes.find((n) => n.id === 'pod-1')).toMatchObject({ kind: 'fabric', tier: 0 })
    // ipn→spines (2 edges) + spines→leaves (1) + ipn→pod-1 (2)
    expect(pod1.edges).toHaveLength(5)
  })

  it('status rolls up: an orphan device turns its group and fabric minor', () => {
    const g = singlePod()
    g.nodes.push(dev('ghost-1', 'leaf', { model_id: 'unknown' }))
    g.edges.push(link('link-x', 'spine-1', 'ghost-1'))
    const fabrics = buildFabrics(g, 'SITE-A')
    expect(deviceStatus(g.nodes.at(-1)!, g)).toBe('minor')
    const top = buildScene(g, fabrics, { kind: 'fabrics' }, { aggregate: true })
    expect(top.nodes[0].status).toBe('minor')
    const mid = buildScene(g, fabrics, { kind: 'fabric', fabricId: 'fabric' }, { aggregate: true })
    expect(mid.nodes.find((n) => n.id === GROUP_ID('fabric', 'leaf'))!.status).toBe('minor')
    expect(mid.nodes.find((n) => n.id === GROUP_ID('fabric', 'spine'))!.status).toBe('healthy')
  })

  it('an unwired device among wired peers is a warning', () => {
    const g = singlePod()
    g.nodes.push(dev('leaf-99', 'leaf', { usedPorts: [] }))
    expect(deviceStatus(g.nodes.at(-1)!, g)).toBe('warning')
    expect(worstStatus(['healthy', 'warning', 'minor'])).toBe('minor')
  })
})

describe('navigation helpers', () => {
  it('drills fabric → fabric level → devices, and parentLevel walks back', () => {
    const g = singlePod()
    const fabrics = buildFabrics(g, 'SITE-A')
    const top = buildScene(g, fabrics, { kind: 'fabrics' }, { aggregate: true })
    const l1 = drillInto(top.nodes[0], top.level)!
    expect(l1).toEqual({ kind: 'fabric', fabricId: 'fabric' })
    const mid = buildScene(g, fabrics, l1, { aggregate: true })
    const l2 = drillInto(mid.nodes[0], l1)!
    expect(l2).toEqual({ kind: 'devices', fabricId: 'fabric' })
    const leafScene = buildScene(g, fabrics, l2, { aggregate: true })
    expect(drillInto(leafScene.nodes[0], l2)).toBeNull()
    expect(parentLevel(l2)).toEqual(l1)
    expect(parentLevel(l1)).toEqual({ kind: 'fabrics' })
    expect(parentLevel({ kind: 'fabrics' })).toBeNull()
  })
})

describe('layoutScene', () => {
  it('rows by tier, natural label order, rows centred on the widest', () => {
    const g = singlePod()
    const scene = buildScene(g, buildFabrics(g, 'SITE-A'), { kind: 'devices', fabricId: 'fabric' }, { aggregate: true })
    const pos = layoutScene(scene.nodes, 'vertical')
    expect(pos.get('spine-1')!.y).toBe(0)
    expect(pos.get('leaf-1')!.y).toBe(TILE_H + TIER_GAP)
    // natural sort: leaf 2 before leaf 10
    expect(pos.get('leaf-2')!.x).toBeLessThan(pos.get('leaf-10')!.x)
    // spines (2) centred over leaves (3): spine row starts half a stride in
    const stride = TILE_W + 14
    expect(pos.get('spine-1')!.x).toBeCloseTo(stride / 2)
  })

  it('horizontal layout transposes axes', () => {
    const g = singlePod()
    const scene = buildScene(g, buildFabrics(g, 'SITE-A'), { kind: 'devices', fabricId: 'fabric' }, { aggregate: true })
    const v = layoutScene(scene.nodes, 'vertical')
    const h = layoutScene(scene.nodes, 'horizontal')
    for (const id of v.keys()) {
      expect(h.get(id)).toEqual({ x: v.get(id)!.y, y: v.get(id)!.x })
    }
  })
})

describe('filter', () => {
  it('parses attribute clauses and falls back to name-contains', () => {
    expect(parseFilter('model=N9K-C93; rack contains R1, leaf 3')).toEqual([
      { attr: 'model', op: '=', value: 'N9K-C93' },
      { attr: 'rack', op: 'contains', value: 'R1' },
      { attr: 'name', op: 'contains', value: 'leaf 3' }
    ])
    expect(parseFilter('role!=spine')).toEqual([{ attr: 'role', op: '!=', value: 'spine' }])
  })

  it('matches case-insensitively', () => {
    const n = dev('leaf-3', 'leaf', { rack: 'Rack-1' })
    expect(matchesFilter(n, parseFilter('LEAF 3'))).toBe(true)
    expect(matchesFilter(n, parseFilter('rack contains rack-1'))).toBe(true)
    expect(matchesFilter(n, parseFilter('role=spine'))).toBe(false)
    expect(matchesFilter(n, parseFilter('model !contains LEAF'))).toBe(false)
  })
})

describe('edgeLabel', () => {
  it('formats single, uniform, and mixed-speed bundles', () => {
    expect(edgeLabel({ count: 1, speeds: [400], totalG: 400 })).toBe('400G')
    expect(edgeLabel({ count: 4, speeds: [400], totalG: 1600 })).toBe('4 × 400G')
    expect(edgeLabel({ count: 3, speeds: [400, 100], totalG: 900 })).toBe('3 links · 900G')
  })
})
