import { describe, it, expect } from 'vitest'
import type { TopologyGraph, TopologyNode, TopologyEdge } from './topology-extractor'
import type { SceneNode } from './topology-hierarchy'
import {
  buildFabrics,
  buildScene,
  deviceStatus,
  drillInto,
  edgeLabel,
  GROUP_ID,
  layoutScene,
  ROW_MAX,
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

function link(id: string, a: string, b: string, speed = 400, kind: TopologyEdge['kind'] = 'uplink'): TopologyEdge {
  return {
    id,
    kind,
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
    const fabrics = buildFabrics(singlePod(), 'FAB-A')
    expect(fabrics).toHaveLength(1)
    expect(fabrics[0]).toMatchObject({ id: 'fabric', label: 'FAB-A', podIndex: null })
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
    const scene = buildScene(g, buildFabrics(g, 'FAB-A'), { kind: 'fabrics' }, { aggregate: true })
    expect(scene.nodes).toHaveLength(1)
    expect(scene.nodes[0]).toMatchObject({ kind: 'fabric', label: 'FAB-A', count: 5, status: 'healthy' })
    expect(scene.edges).toEqual([])
    expect(scene.breadcrumb.map((c) => c.label)).toEqual(['All fabrics'])
  })

  it('fabric level: Spines + Leaves stacks joined by one aggregated edge', () => {
    const g = singlePod()
    const scene = buildScene(g, buildFabrics(g, 'FAB-A'), { kind: 'fabric', fabricId: 'fabric' }, { aggregate: true })
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
    expect(scene.breadcrumb.map((c) => c.label)).toEqual(['All fabrics', 'FAB-A'])
  })

  it('devices level: every switch is a tile; aggregate folds parallel cables per pair', () => {
    const g = singlePod()
    const fabrics = buildFabrics(g, 'FAB-A')
    const agg = buildScene(g, fabrics, { kind: 'devices', fabricId: 'fabric' }, { aggregate: true })
    expect(agg.nodes.filter((n) => n.kind === 'device')).toHaveLength(5)
    expect(agg.edges).toHaveLength(6) // 2 spines × 3 leaves, one cable each → same count
    const raw = buildScene(g, fabrics, { kind: 'devices', fabricId: 'fabric' }, { aggregate: false })
    expect(raw.edges).toHaveLength(6)
    expect(raw.edges.every((e) => e.source.startsWith('spine'))).toBe(true) // spine on top
    expect(agg.breadcrumb.map((c) => c.label)).toEqual(['All fabrics', 'FAB-A', 'Switches'])
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
    const fabrics = buildFabrics(g, 'FAB-A')
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
    const fabrics = buildFabrics(g, 'FAB-A')
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
    const scene = buildScene(g, buildFabrics(g, 'FAB-A'), { kind: 'devices', fabricId: 'fabric' }, { aggregate: true })
    const pos = layoutScene(scene.nodes, 'vertical')
    expect(pos.get('spine-1')!.y).toBe(0)
    expect(pos.get('leaf-1')!.y).toBe(TILE_H + TIER_GAP)
    // natural sort: leaf 2 before leaf 10
    expect(pos.get('leaf-2')!.x).toBeLessThan(pos.get('leaf-10')!.x)
    // spines (2) centred over leaves (3): spine row starts half a stride in
    const stride = TILE_W + 14
    expect(pos.get('spine-1')!.x).toBeCloseTo(stride / 2)
  })

  it('wraps a tier past ROW_MAX into balanced rows below it', () => {
    const nodes = [
      dev('spine-1', 'spine'),
      dev('spine-2', 'spine'),
      ...Array.from({ length: 45 }, (_, i) => dev(`leaf-${i + 1}`, 'leaf'))
    ]
    const g: TopologyGraph = { nodes, edges: [], orphanDeviceIds: [] }
    const scene = buildScene(g, buildFabrics(g, 'X'), { kind: 'devices', fabricId: 'fabric' }, { aggregate: true })
    const pos = layoutScene(scene.nodes, 'vertical')
    expect(ROW_MAX).toBe(40)
    const rowY = new Set([...pos.entries()].filter(([id]) => id.startsWith('leaf')).map(([, p]) => p.y))
    expect(rowY.size).toBe(2) // 45 leaves → two rows (23 + 22)
    const [y1, y2] = [...rowY].sort((a, b) => a - b)
    expect(y2 - y1).toBe(TILE_H + TIER_GAP)
    const firstRow = [...pos.entries()].filter(([, p]) => p.y === y1).length
    expect(firstRow).toBe(23)
    expect(pos.get('leaf-1')!.y).toBe(y1)
    expect(pos.get('leaf-45')!.y).toBe(y2)
    // 40 or fewer stays on one row
    const small = buildScene(singlePod(), buildFabrics(singlePod(), 'X'), { kind: 'devices', fabricId: 'fabric' }, { aggregate: true })
    const smallPos = layoutScene(small.nodes, 'vertical')
    expect(new Set([...smallPos.entries()].filter(([id]) => id.startsWith('leaf')).map(([, p]) => p.y)).size).toBe(1)
  })

  it('horizontal layout transposes axes', () => {
    const g = singlePod()
    const scene = buildScene(g, buildFabrics(g, 'FAB-A'), { kind: 'devices', fabricId: 'fabric' }, { aggregate: true })
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

// ── Phase 14: vPC pairs + servers ────────────────────────────────────

// 2 spines, 3 leaves; leaf-1 + leaf-2 are a vPC pair with a 2×400G peer-link.
function pairedPod(withPeerLink = true): TopologyGraph {
  const g = singlePod()
  g.nodes = g.nodes.map((n) =>
    n.id === 'leaf-1' || n.id === 'leaf-2'
      ? { ...n, pair_id: 'pair-1', pair_peer: n.id === 'leaf-1' ? 'leaf-2' : 'leaf-1' }
      : n
  )
  g.pairs = [{ id: 'pair-1', members: ['leaf-1', 'leaf-2'] }]
  if (withPeerLink) {
    g.edges.push(link('pl-1', 'leaf-1', 'leaf-2', 400, 'vpc-peer-link'))
    g.edges.push(link('pl-2', 'leaf-1', 'leaf-2', 400, 'vpc-peer-link'))
  }
  return g
}

const serverInfo = (leaf: { model_id: string }) =>
  leaf.model_id === 'N9K-LEAF'
    ? { model_id: 'UCS-C220-M7', label: 'UCS C220 M7', nics: 2, nic_speed_g: 25, ru: 1 }
    : null

describe('buildScene — vPC pairs (Phase 14)', () => {
  it('device level: the peer-link is its own red edge, aggregated as one 2 × 400G bundle', () => {
    const g = pairedPod()
    const scene = buildScene(g, buildFabrics(g, 'F'), { kind: 'devices', fabricId: 'fabric' }, { aggregate: true })
    const pl = scene.edges.filter((e) => e.kind === 'vpc-peer-link')
    expect(pl).toHaveLength(1)
    expect(pl[0]).toMatchObject({ source: 'leaf-1', target: 'leaf-2', count: 2, label: '2 × 400G peer-link' })
    expect(scene.edges.filter((e) => e.kind === 'fabric')).toHaveLength(6)
    // The pair is listed; with a peer-link drawn it needs no bracket.
    expect(scene.pairs).toEqual([{ id: 'pair-1', kind: 'vpc', memberIds: ['leaf-1', 'leaf-2'], label: 'vPC pair', bracket: false }])
  })

  it('fabric / fabrics levels fold the peer-link away (both ends land on the same tile)', () => {
    const g = pairedPod()
    const f = buildFabrics(g, 'F')
    expect(buildScene(g, f, { kind: 'fabric', fabricId: 'fabric' }, { aggregate: true }).edges.every((e) => e.kind === 'fabric')).toBe(true)
    expect(buildScene(g, f, { kind: 'fabrics' }, { aggregate: true }).edges).toEqual([])
    expect(buildScene(g, f, { kind: 'fabric', fabricId: 'fabric' }, { aggregate: true }).pairs).toEqual([])
  })

  it('ACI-style pair (no peer-link) gets a bracket instead', () => {
    const g = pairedPod(false)
    const scene = buildScene(g, buildFabrics(g, 'F'), { kind: 'devices', fabricId: 'fabric' }, { aggregate: true })
    expect(scene.edges.some((e) => e.kind === 'vpc-peer-link')).toBe(false)
    expect(scene.pairs[0].bracket).toBe(true)
  })

  it('per-cable mode keeps each peer-link cable as its own edge', () => {
    const g = pairedPod()
    const scene = buildScene(g, buildFabrics(g, 'F'), { kind: 'devices', fabricId: 'fabric' }, { aggregate: false })
    expect(scene.edges.filter((e) => e.kind === 'vpc-peer-link')).toHaveLength(2)
  })
})

describe('buildScene — server symbols (Phase 14)', () => {
  it('off by default: no server tiles', () => {
    const g = pairedPod()
    const scene = buildScene(g, buildFabrics(g, 'F'), { kind: 'devices', fabricId: 'fabric' }, { aggregate: true, serverInfo })
    expect(scene.nodes.some((n) => n.kind === 'server')).toBe(false)
  })

  it('one symbol per pair (two lines, one per leaf) and one per unpaired leaf (one line per NIC)', () => {
    const g = pairedPod()
    const scene = buildScene(g, buildFabrics(g, 'F'), { kind: 'devices', fabricId: 'fabric' }, { aggregate: true, showServers: true, serverInfo })
    const servers = scene.nodes.filter((n) => n.kind === 'server')
    expect(servers.map((n) => n.id).sort()).toEqual(['server:leaf-10', 'server:pair-1'])
    const pairSym = servers.find((n) => n.id === 'server:pair-1')!
    expect(pairSym).toMatchObject({ label: 'UCS C220 M7', sublabel: '2×25G', tier: 3, memberIds: ['leaf-1', 'leaf-2'] })
    expect(pairSym.server).toMatchObject({ dual: true, modelId: 'UCS-C220-M7', nicSpeedG: 25 })
    const single = servers.find((n) => n.id === 'server:leaf-10')!
    expect(single.server?.dual).toBe(false)
    const lines = scene.edges.filter((e) => e.kind === 'server')
    // pair: leaf-1 + leaf-2 → symbol; single leaf-10: 2 NICs → 2 lines
    expect(lines.filter((e) => e.target === 'server:pair-1').map((e) => e.source).sort()).toEqual(['leaf-1', 'leaf-2'])
    expect(lines.filter((e) => e.target === 'server:leaf-10')).toHaveLength(2)
    expect(lines.every((e) => e.label === '25G' && e.count === 1)).toBe(true)
  })

  it('generic symbol when the tier has no server model', () => {
    const g = pairedPod()
    const generic = () => ({ model_id: null, label: 'Servers', nics: 1, nic_speed_g: 25, ru: 1 })
    const scene = buildScene(g, buildFabrics(g, 'F'), { kind: 'devices', fabricId: 'fabric' }, { aggregate: true, showServers: true, serverInfo: generic })
    const sym = scene.nodes.find((n) => n.id === 'server:leaf-10')!
    expect(sym).toMatchObject({ label: 'Servers', sublabel: '25G NIC' })
    expect(scene.edges.filter((e) => e.target === 'server:leaf-10')).toHaveLength(1)
  })

  it('layout centres a server symbol under its leaves, one tier below them', () => {
    const g = pairedPod()
    const scene = buildScene(g, buildFabrics(g, 'F'), { kind: 'devices', fabricId: 'fabric' }, { aggregate: true, showServers: true, serverInfo })
    const pos = layoutScene(scene.nodes)
    const l1 = pos.get('leaf-1')!
    const l2 = pos.get('leaf-2')!
    expect(pos.get('server:pair-1')).toEqual({ x: (l1.x + l2.x) / 2, y: l1.y + TILE_H + TIER_GAP })
    expect(pos.get('server:leaf-10')).toEqual({ x: pos.get('leaf-10')!.x, y: l1.y + TILE_H + TIER_GAP })
  })

  it('wrapped leaf rows each get their own server slot, so symbols never land on the next row', () => {
    const g = pairedPod()
    const scene = buildScene(g, buildFabrics(g, 'F'), { kind: 'devices', fabricId: 'fabric' }, { aggregate: true, showServers: true, serverInfo })
    // wrap at 2 → leaf rows [leaf-1, leaf-2] and [leaf-10]; each has servers
    const pos = layoutScene(scene.nodes, 'vertical', 2)
    const y = (id: string) => pos.get(id)!.y
    expect(y('server:pair-1')).toBe(y('leaf-1') + TILE_H + TIER_GAP)
    expect(y('leaf-10')).toBe(y('server:pair-1') + TILE_H + TIER_GAP)
    expect(y('server:leaf-10')).toBe(y('leaf-10') + TILE_H + TIER_GAP)
  })

  it('a vPC pair never straddles a row break when a tier wraps', () => {
    // 6 paired leaves + 1 odd, wrap at 3 → rows [1,2], [3,4], [5,6,7]: a pair is never split
    const tile = (i: number): SceneNode => ({
      id: `leaf-${i}`,
      kind: 'device',
      label: `leaf-${i}`,
      sublabel: null,
      role: 'leaf',
      memberIds: [`leaf-${i}`],
      count: 1,
      status: 'healthy',
      fabricId: 'f',
      device: { ...dev(`leaf-${i}`, 'leaf'), pair_id: i <= 6 ? `pair-${Math.ceil(i / 2)}` : null },
      tier: 2
    })
    const nodes = [1, 2, 3, 4, 5, 6, 7].map(tile)
    const pos = layoutScene(nodes, 'vertical', 3)
    for (const [a, b] of [[1, 2], [3, 4], [5, 6], [6, 7]]) expect(pos.get(`leaf-${a}`)!.y).toBe(pos.get(`leaf-${b}`)!.y)
    expect(new Set([...pos.values()].map((p) => p.y)).size).toBe(3)
  })
})
