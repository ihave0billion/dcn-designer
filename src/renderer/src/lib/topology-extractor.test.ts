import { describe, it, expect } from 'vitest'
import { extractTopology, comparePortNames } from './topology-extractor'
import type { DesignResult } from '@domain'
import type { CableLink } from '@/schemas/cable-links'

// Compact design fixture for topology tests. We only care about the
// shape that extractTopology actually reads (rack_layout + tiers + spine).
function makeDesign(opts: {
  spines?: number
  leaves?: number
  servers?: number
  withRackLayout?: boolean
}): DesignResult {
  const {
    spines = 2,
    leaves = 2,
    servers = 0,
    withRackLayout = true
  } = opts

  const tier = {
    speed_tier_label: '25G',
    leaf_model_id: 'N9K-LEAF',
    endpoint_count_input: leaves * 48,
    switch_count_input: null,
    leaves_required: leaves,
    endpoints_supported: leaves * 48,
    host_ports_per_leaf: 48,
    host_speed_g: 25,
    effective_uplink_ports: 4,
    effective_uplink_speed_g: 400,
    effective_uplink_choice: 'primary' as const,
    override_uplink_speed_applied_g: null,
    host_bw_g: leaves * 48 * 25,
    uplink_bw_g: leaves * 4 * 400,
    xor_status: 'ok' as const
  }

  const layoutDevices = [
    ...Array.from({ length: spines }, (_, i) => ({
      device_id: `spine-${i + 1}`,
      model_id: 'N9K-SPINE',
      role: 'spine' as const,
      start_u: 40 - i * 2,
      ru: 2,
      label: `Spine ${i + 1}`
    })),
    ...Array.from({ length: leaves }, (_, i) => ({
      device_id: `leaf-${i + 1}`,
      model_id: 'N9K-LEAF',
      role: 'leaf' as const,
      start_u: i + 1,
      ru: 1,
      label: `Leaf ${i + 1}`
    })),
    ...Array.from({ length: servers }, (_, i) => ({
      device_id: `server-${i + 1}`,
      model_id: 'UCS-X',
      role: 'server' as const,
      start_u: 30 + i,
      ru: 1,
      label: `Server ${i + 1}`
    }))
  ]

  return {
    schema_version: 1,
    summary: {
      total_leaves: leaves,
      total_spines: spines,
      total_servers: servers,
      spines_no_breakout: spines,
      spines_with_breakout: null,
      total_host_bw_g: 0,
      total_uplink_bw_g: 0,
      computed_oversub_ratio: 1,
      computed_oversub_label: '1.00:1',
      valid: true,
      breakout_required_to_be_valid: false
    },
    tiers: [tier],
    spine: {
      spine_model_id: 'N9K-SPINE',
      spine_ports: 64,
      spine_speed_g: 400,
      total_leaves: leaves,
      total_leaf_uplinks: leaves * 4,
      spines_capacity: 1,
      spines_touching: 2,
      spines_port_count: 1,
      spines_needed: spines,
      required_uplinks_per_leaf: 4,
      spine_touching_divisible: true
    },
    breakout: null,
    optics_bom: [],
    rack_layout: withRackLayout
      ? [
          {
            rack_name: 'Rack A',
            size_u: 42,
            pdu_kw_budget: null,
            estimated_power_w: 0,
            over_budget: false,
            devices: layoutDevices
          }
        ]
      : [],
    warnings: [],
    // Phase 2b — topology extraction reads only the canonical
    // top-level fields, so an empty candidate matrix is sufficient
    // mock state.
    candidates: [],
    primary_candidate_id: 'single_no_breakout',
    committed_candidate_id: 'single_no_breakout'
  }
}

function makeLink(
  id: string,
  spineId: string,
  spinePort: string,
  leafId: string,
  leafPort: string
): CableLink {
  return {
    id,
    kind: 'uplink',
    device_a: { rack: null, device_id: spineId, port: spinePort },
    device_b: { rack: null, device_id: leafId, port: leafPort },
    speed_g: 100,
    optic_id: null,
    patch_panel_id: null,
    label: `${spineId}:${spinePort} ↔ ${leafId}:${leafPort}`,
    length_m: null,
    notes: null
  }
}

describe('extractTopology', () => {
  it('extracts spines + leaves only, dropping servers', () => {
    const design = makeDesign({ spines: 2, leaves: 2, servers: 3 })
    const graph = extractTopology(design, [])
    expect(graph.nodes).toHaveLength(4) // 2 + 2, servers dropped
    expect(graph.nodes.filter((n) => n.role === 'spine')).toHaveLength(2)
    expect(graph.nodes.filter((n) => n.role === 'leaf')).toHaveLength(2)
    expect(graph.edges).toHaveLength(0)
    expect(graph.orphanDeviceIds).toHaveLength(0)
  })

  it('preserves used ports per device, sorted naturally', () => {
    const design = makeDesign({ spines: 1, leaves: 1 })
    const links = [
      makeLink('l1', 'spine-1', 'Eth1/2', 'leaf-1', 'Eth1/49'),
      makeLink('l2', 'spine-1', 'Eth1/10', 'leaf-1', 'Eth1/50'),
      makeLink('l3', 'spine-1', 'Eth1/1', 'leaf-1', 'Eth1/51')
    ]
    const graph = extractTopology(design, links)
    const spine = graph.nodes.find((n) => n.id === 'spine-1')!
    expect(spine.usedPorts).toEqual(['Eth1/1', 'Eth1/2', 'Eth1/10']) // natural sort, not lex
    const leaf = graph.nodes.find((n) => n.id === 'leaf-1')!
    expect(leaf.usedPorts).toEqual(['Eth1/49', 'Eth1/50', 'Eth1/51'])
    expect(graph.edges).toHaveLength(3)
  })

  it('orients edges with spine as source even when cable_links has it on side B', () => {
    const design = makeDesign({ spines: 1, leaves: 1 })
    const links: CableLink[] = [
      // Side A is leaf, side B is spine — extractor must still emit
      // source = spine so the visual top-down direction is consistent.
      {
        id: 'l1',
        kind: 'uplink',
        device_a: { rack: null, device_id: 'leaf-1', port: 'Eth1/49' },
        device_b: { rack: null, device_id: 'spine-1', port: 'Eth1/3' },
        speed_g: 100,
        optic_id: null,
        patch_panel_id: null,
        label: '',
        length_m: null,
        notes: null
      }
    ]
    const graph = extractTopology(design, links)
    const edge = graph.edges[0]
    expect(edge.source).toBe('spine-1')
    expect(edge.sourcePort).toBe('Eth1/3')
    expect(edge.target).toBe('leaf-1')
    expect(edge.targetPort).toBe('Eth1/49')
  })

  it('synthesises orphan nodes for cable_links that reference unknown devices', () => {
    const design = makeDesign({ spines: 1, leaves: 1 })
    const links = [makeLink('l1', 'spine-1', 'Eth1/1', 'leaf-99', 'Eth1/49')]
    const graph = extractTopology(design, links)
    expect(graph.orphanDeviceIds).toEqual(['leaf-99'])
    const orphan = graph.nodes.find((n) => n.id === 'leaf-99')
    expect(orphan).toBeDefined()
    expect(orphan?.model_id).toBe('unknown')
    expect(orphan?.usedPorts).toEqual(['Eth1/49'])
    expect(graph.edges).toHaveLength(1)
  })

  it('falls back to summary-derived devices when rack_layout is empty', () => {
    const design = makeDesign({ spines: 2, leaves: 3, withRackLayout: false })
    const graph = extractTopology(design, [])
    expect(graph.nodes.filter((n) => n.role === 'spine')).toHaveLength(2)
    expect(graph.nodes.filter((n) => n.role === 'leaf')).toHaveLength(3)
    // Synthesised devices use the canonical spine-N / leaf-N naming
    expect(graph.nodes.find((n) => n.role === 'spine')?.id).toBe('spine-1')
    expect(graph.nodes.find((n) => n.role === 'leaf')?.id).toBe('leaf-1')
  })

  it('returns nodes with no used ports when no cable links exist', () => {
    const design = makeDesign({ spines: 1, leaves: 1 })
    const graph = extractTopology(design, [])
    for (const n of graph.nodes) expect(n.usedPorts).toEqual([])
  })

  it('includes IPN nodes, pod_index tags, and spine↔IPN edges (multi-pod)', () => {
    const design = makeDesign({ spines: 2, leaves: 2 })
    const rackA = design.rack_layout[0]
    rackA.devices.find((d) => d.device_id === 'spine-1')!.pod_index = 0
    rackA.devices.find((d) => d.device_id === 'spine-2')!.pod_index = 1
    rackA.devices.find((d) => d.device_id === 'leaf-1')!.pod_index = 0
    rackA.devices.find((d) => d.device_id === 'leaf-2')!.pod_index = 1
    design.rack_layout.push({
      rack_name: 'IPN',
      size_u: 44,
      pdu_kw_budget: null,
      estimated_power_w: 0,
      over_budget: false,
      devices: [
        { device_id: 'ipn-1', model_id: 'N9K-IPN', role: 'ipn', start_u: 44, ru: 1, label: 'IPN 1', pod_index: null }
      ]
    })
    const links: CableLink[] = [
      makeLink('link-1', 'spine-1', 'Eth1/1', 'leaf-1', 'Eth1/49'),
      {
        id: 'ipn-link-1',
        kind: 'uplink',
        device_a: { rack: null, device_id: 'spine-1', port: 'Eth1/64' },
        device_b: { rack: null, device_id: 'ipn-1', port: 'Eth1/1' },
        speed_g: 400,
        optic_id: null,
        patch_panel_id: null,
        label: '',
        length_m: null,
        notes: null
      }
    ]
    const graph = extractTopology(design, links)
    const ipn = graph.nodes.find((n) => n.role === 'ipn')
    expect(ipn?.id).toBe('ipn-1')
    expect(graph.nodes.find((n) => n.id === 'spine-1')?.pod_index).toBe(0)
    expect(graph.nodes.find((n) => n.id === 'leaf-2')?.pod_index).toBe(1)
    // Spine↔IPN edge keeps the spine as source.
    const ipnEdge = graph.edges.find((e) => e.target === 'ipn-1')
    expect(ipnEdge?.source).toBe('spine-1')
    // IPN nodes lead the node list (top tier).
    expect(graph.nodes[0].role).toBe('ipn')
  })
})

describe('extractTopology — vPC pairs (Phase 14)', () => {
  it('keeps device_a as the source of a leaf↔leaf peer-link and carries the kind', () => {
    const design = makeDesign({ leaves: 2 })
    const links: CableLink[] = [
      makeLink('link-1', 'spine-1', 'Eth1/1', 'leaf-1', 'Eth1/51'),
      { ...makeLink('pl-1', 'leaf-1', 'Eth1/49', 'leaf-2', 'Eth1/49'), kind: 'vpc-peer-link' }
    ]
    const g = extractTopology(design, links)
    const pl = g.edges.find((e) => e.id === 'pl-1')!
    expect(pl).toMatchObject({ kind: 'vpc-peer-link', source: 'leaf-1', target: 'leaf-2' })
    expect(g.edges.find((e) => e.id === 'link-1')?.kind).toBe('uplink')
    expect(g.nodes.find((n) => n.id === 'leaf-1')?.usedPorts).toEqual(['Eth1/49', 'Eth1/51'])
  })

  it('annotates leaves with their pair from design.vpc, or from an explicit list', () => {
    const design = { ...makeDesign({ leaves: 3 }), vpc: { mode: 'nxos-evpn' as const, peer_link: true, port_channel: true, members: 2, configured_uplinks_per_leaf: 4, effective_uplinks_per_leaf: 4, pairs: [{ id: 'pair-1', members: ['leaf-1', 'leaf-2'] as [string, string] }], unpaired: ['leaf-3'] } }
    const g = extractTopology(design, [])
    expect(g.nodes.find((n) => n.id === 'leaf-1')).toMatchObject({ pair_id: 'pair-1', pair_peer: 'leaf-2' })
    expect(g.nodes.find((n) => n.id === 'leaf-2')).toMatchObject({ pair_id: 'pair-1', pair_peer: 'leaf-1' })
    expect(g.nodes.find((n) => n.id === 'leaf-3')).toMatchObject({ pair_id: null, pair_peer: null })
    expect(g.nodes.find((n) => n.id === 'spine-1')?.pair_id).toBeNull()
    expect(g.pairs).toEqual(design.vpc.pairs)
    const forked = extractTopology(design, [], [{ id: 'pair-1', members: ['leaf-2', 'leaf-3'] }])
    expect(forked.nodes.find((n) => n.id === 'leaf-1')?.pair_id).toBeNull()
    expect(forked.nodes.find((n) => n.id === 'leaf-3')?.pair_peer).toBe('leaf-2')
  })
})

describe('comparePortNames', () => {
  it('sorts numeric port segments naturally', () => {
    const ports = ['Eth1/10', 'Eth1/2', 'Eth1/1', 'Eth1/9', 'Eth1/100']
    ports.sort(comparePortNames)
    expect(ports).toEqual(['Eth1/1', 'Eth1/2', 'Eth1/9', 'Eth1/10', 'Eth1/100'])
  })

  it('sorts breakout sub-port names correctly', () => {
    const ports = ['Eth1/49/2', 'Eth1/49/1', 'Eth1/50/1', 'Eth1/49/4']
    ports.sort(comparePortNames)
    expect(ports).toEqual(['Eth1/49/1', 'Eth1/49/2', 'Eth1/49/4', 'Eth1/50/1'])
  })
})
