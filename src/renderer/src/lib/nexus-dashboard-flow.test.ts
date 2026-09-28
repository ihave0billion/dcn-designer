import { describe, expect, it } from 'vitest'
import type { DesignResult, NexusDashboardResult } from '@domain'
import { OOB_MGMT_DEVICE_ID, OOB_MGMT_LABEL } from '@domain'
import type { Switch } from '@/schemas/switches'
import { seedCableLinks } from './cable-links-seeder'
import { extractTopology } from './topology-extractor'
import { applyNicknames } from './device-nickname'
import { buildFabrics, buildScene, GROUP_ID, layoutScene, TILE_H, TILE_W } from './topology-hierarchy'
import { buildPdfScenePages } from './pdf/topology-scene'
import { buildOpticsBom } from './optics-bom'
import { buildDeviceBom } from './device-bom'
import { buildCableBom, cableKindLabel } from './cable-bom'
import { parseCableLinksCsv, serializeCableLinksCsv } from './cable-links-csv'

// Phase 17 — the Nexus Dashboard cluster end to end through the renderer
// libraries: seeder → extractor → scene / layout → PDF scene → BOMs → CSV.

function sw(id: string, primary: { ports: number; speed_g: number; tpl: string }, uplink: { ports: number; speed_g: number; tpl: string } | null, role: Switch['role']): Switch {
  return {
    id,
    model_display: id,
    vendor: 'Cisco',
    role,
    category: 'test',
    primary: { ports: primary.ports, speed_g: primary.speed_g, speed_options_g: [primary.speed_g], naming_template: primary.tpl },
    uplink: uplink ? { ports: uplink.ports, speed_g: uplink.speed_g, speed_options_g: [uplink.speed_g], naming_template: uplink.tpl } : null,
    secondary_uplink: null,
    ru: 1,
    power_w: 500,
    optic_hint: 'SFP28 (primary) / QSFP-DD (uplink)',
    capabilities: {
      aci_leaf: true, aci_spine: true, nxos: true, rocev2: true, deep_buffer: false, smart_switch: false,
      ult_low_latency: false, poe: false, macsec: false, hpc: false, ai_ml: false, dpu_integrated: false
    },
    aci_note: null, asic: null, availability: 'available', available_from: null, notes: null, data_sheet_url: null, attachments: [], peer_link_ports: null
  }
}
const SPINE = sw('N9K-C9364D-GX2A', { ports: 64, speed_g: 400, tpl: 'Eth1/{1..64}' }, null, 'spine')
const LEAF = sw('N9K-C93400LD-H1', { ports: 48, speed_g: 25, tpl: 'Eth1/{1..48}' }, { ports: 4, speed_g: 400, tpl: 'Eth1/{49..52}' }, 'leaf')
const OOB_LEAF = sw('9348GC-FX3', { ports: 48, speed_g: 1, tpl: 'Eth1/{1..48}' }, { ports: 2, speed_g: 100, tpl: 'Eth1/{53..54}' }, 'leaf')
const SWITCHES = [SPINE, LEAF, OOB_LEAF]

function nd(mgmtLeaves: string[] | null): NexusDashboardResult {
  return {
    cluster_model_id: 'ND-CLUSTER-G5S',
    node_model_id: 'ND-NODE-G5S',
    node_count: 3,
    ru_per_node: 1,
    data_speed_g: 25,
    mgmt_speed_g: 10,
    data_ports: ['fabric0', 'fabric1'],
    mgmt_ports: ['mgmt0', 'mgmt1'],
    data_leaf_ids: ['leaf-1', 'leaf-2'],
    attach_pair_id: 'pair-1',
    mgmt_leaf_ids: mgmtLeaves,
    nodes: [1, 2, 3].map((i) => ({ device_id: `nd-${i}`, model_id: 'ND-NODE-G5S', label: `ND node ${i} (ND-NODE-G5S)`, ru: 1 }))
  }
}

function tier(model: string, leaves: number, hostSpeed: number, oob: boolean): DesignResult['tiers'][number] {
  return {
    speed_tier_label: model, leaf_model_id: model, endpoint_count_input: null, switch_count_input: leaves, leaves_required: leaves,
    endpoints_supported: leaves * 48, host_ports_per_leaf: 48, host_speed_g: hostSpeed, effective_uplink_ports: 2, effective_uplink_speed_g: 400,
    effective_uplink_choice: 'primary', override_uplink_speed_applied_g: null, host_bw_g: 0, uplink_bw_g: 0, xor_status: 'ok',
    vpc_pairs: !oob, oob_management: oob
  }
}

// 2 spines, 4 × 25G leaves (pairs 1-2) [+ 2 OOB 1G leaves], 3 ND nodes in Rack1.
function makeDesign(opts: { oobTier: boolean }): DesignResult {
  const leafModels = ['leaf-1', 'leaf-2', 'leaf-3', 'leaf-4'].map((id) => ({ id, model: LEAF.id }))
  if (opts.oobTier) leafModels.push({ id: 'leaf-5', model: OOB_LEAF.id }, { id: 'leaf-6', model: OOB_LEAF.id })
  const ndRes = nd(opts.oobTier ? ['leaf-5', 'leaf-6'] : null)
  const rack = (name: string, devices: DesignResult['rack_layout'][number]['devices']) => ({
    rack_name: name, size_u: 44, pdu_kw_budget: null, estimated_power_w: 0, over_budget: false, devices
  })
  const leafDev = (l: { id: string; model: string }, u: number) => ({ device_id: l.id, model_id: l.model, role: 'leaf' as const, start_u: u, ru: 1, label: `Leaf ${l.id.slice(5)} (${l.model})`, pod_index: null })
  const rack_layout = [
    rack('Rack1', [
      { device_id: 'spine-1', model_id: SPINE.id, role: 'spine', start_u: 43, ru: 2, label: 'Spine 1', pod_index: null },
      leafDev(leafModels[0], 42), leafDev(leafModels[1], 41),
      ...ndRes.nodes.map((n, i) => ({ device_id: n.device_id, model_id: n.model_id, role: 'nd' as const, start_u: 40 - i, ru: 1, label: n.label, pod_index: null }))
    ]),
    rack('Rack2', [
      { device_id: 'spine-2', model_id: SPINE.id, role: 'spine', start_u: 43, ru: 2, label: 'Spine 2', pod_index: null },
      leafDev(leafModels[2], 42), leafDev(leafModels[3], 41),
      ...(opts.oobTier ? [leafDev(leafModels[4], 40), leafDev(leafModels[5], 39)] : [])
    ])
  ]
  const tiers = [tier(LEAF.id, 4, 25, false), ...(opts.oobTier ? [tier(OOB_LEAF.id, 2, 1, true)] : [])]
  return {
    schema_version: 1,
    summary: { total_leaves: leafModels.length, total_spines: 2, total_servers: 0, spines_no_breakout: 2, spines_with_breakout: null, total_host_bw_g: 0, total_uplink_bw_g: 0, computed_oversub_ratio: 1, computed_oversub_label: '1:1', valid: true, breakout_required_to_be_valid: false },
    tiers,
    spine: { spine_model_id: SPINE.id, spine_ports: 64, spine_speed_g: 400, total_leaves: leafModels.length, total_leaf_uplinks: leafModels.length * 2, spines_capacity: 1, spines_touching: 2, spines_port_count: 1, required_uplinks_per_leaf: 2, spines_needed: 2 } as DesignResult['spine'],
    breakout: null,
    optics_bom: [],
    rack_layout,
    warnings: [],
    candidates: [],
    primary_candidate_id: 'single_no_breakout',
    committed_candidate_id: 'single_no_breakout',
    vpc: { mode: 'nxos-evpn', peer_link: false, port_channel: false, members: 0, configured_uplinks_per_leaf: 2, effective_uplinks_per_leaf: 2, pairs: [{ id: 'pair-1', members: ['leaf-1', 'leaf-2'] }, { id: 'pair-2', members: ['leaf-3', 'leaf-4'] }], unpaired: [], excluded: [] },
    nexus_dashboard: ndRes
  }
}

function seed(design: DesignResult) {
  return seedCableLinks({ design, switches: SWITCHES, fabric: { uplinks_per_leaf: 2, uplinks_per_spine: 1 }, breakoutPairs: [], patchPanels: [], vpc: null })
}

describe('seeder — Nexus Dashboard links', () => {
  it('wires fabric0/fabric1 to the pair and mgmt0/mgmt1 to the OOB cloud when no OOB tier exists', () => {
    const design = makeDesign({ oobTier: false })
    const { links, notes } = seed(design)
    const data = links.filter((l) => l.kind === 'nd-data')
    const mgmt = links.filter((l) => l.kind === 'nd-mgmt')
    expect(data).toHaveLength(6)
    expect(mgmt).toHaveLength(6)
    // Node 1: fabric0 → leaf-1, fabric1 → leaf-2, on the first free host ports.
    const n1 = data.filter((l) => l.device_a.device_id === 'nd-1')
    expect(n1.map((l) => [l.device_a.port, l.device_b.device_id, l.device_b.port])).toEqual([
      ['fabric0', 'leaf-1', 'Eth1/1'],
      ['fabric1', 'leaf-2', 'Eth1/1']
    ])
    expect(data.filter((l) => l.device_b.device_id === 'leaf-1').map((l) => l.device_b.port)).toEqual(['Eth1/1', 'Eth1/2', 'Eth1/3'])
    expect(data.every((l) => l.speed_g === 25 && l.device_a.rack === 'Rack1' && l.device_b.rack === 'Rack1')).toBe(true)
    expect(mgmt.every((l) => l.device_b.device_id === OOB_MGMT_DEVICE_ID && l.device_b.rack === null && l.speed_g === 10)).toBe(true)
    expect(mgmt.map((l) => l.device_a.port)).toEqual(['mgmt0', 'mgmt1', 'mgmt0', 'mgmt1', 'mgmt0', 'mgmt1'])
    expect(notes.some((n) => n.includes('OOB network cloud'))).toBe(true)
    // Uplinks still there and never share a port with the ND links.
    const uplinkPorts = links.filter((l) => l.kind === 'uplink').map((l) => `${l.device_b.device_id}|${l.device_b.port}`)
    const ndPorts = data.map((l) => `${l.device_b.device_id}|${l.device_b.port}`)
    expect(ndPorts.some((p) => uplinkPorts.includes(p))).toBe(false)
  })

  it('lands the management links on the OOB tier and notes a host-speed mismatch', () => {
    const design = makeDesign({ oobTier: true })
    const { links, notes } = seed(design)
    const mgmt = links.filter((l) => l.kind === 'nd-mgmt')
    expect(mgmt).toHaveLength(6)
    expect(mgmt.filter((l) => l.device_a.port === 'mgmt0').every((l) => l.device_b.device_id === 'leaf-5')).toBe(true)
    expect(mgmt.filter((l) => l.device_a.port === 'mgmt1').every((l) => l.device_b.device_id === 'leaf-6')).toBe(true)
    expect(links.some((l) => l.device_b.device_id === OOB_MGMT_DEVICE_ID)).toBe(false)
    // 10G mgmt into a 1G FX3 tier → one note per model/kind.
    expect(notes.filter((n) => n.includes('management links are 10G'))).toHaveLength(1)
  })
})

describe('topology — Nexus Dashboard nodes and the OOB cloud', () => {
  it('extracts nd nodes, the synthetic cloud, nicknames and the cluster', () => {
    const design = makeDesign({ oobTier: false })
    const graph = applyNicknames(extractTopology(design, seed(design).links))
    const nds = graph.nodes.filter((n) => n.role === 'nd')
    expect(nds.map((n) => n.label)).toEqual(['g5s-nd1', 'g5s-nd2', 'g5s-nd3'])
    expect(nds[0].usedPorts).toEqual(['fabric0', 'fabric1', 'mgmt0', 'mgmt1'])
    const cloud = graph.nodes.find((n) => n.role === 'oob')!
    expect(cloud.id).toBe(OOB_MGMT_DEVICE_ID)
    expect(cloud.label).toBe(OOB_MGMT_LABEL)
    expect(graph.orphanDeviceIds).toEqual([])
    expect(graph.nexusDashboard?.cluster_model_id).toBe('ND-CLUSTER-G5S')
  })

  it('folds the nodes into the fabric at every level and always shows the cloud', () => {
    const design = makeDesign({ oobTier: false })
    const graph = applyNicknames(extractTopology(design, seed(design).links))
    const fabrics = buildFabrics(graph, 'SITE-B')
    expect(fabrics[0].ndIds).toEqual(['nd-1', 'nd-2', 'nd-3'])

    const top = buildScene(graph, fabrics, { kind: 'fabrics' }, { aggregate: true })
    expect(top.nodes.map((n) => n.kind).sort()).toEqual(['cloud', 'fabric'])
    expect(top.nodes.find((n) => n.kind === 'fabric')!.sublabel).toContain('ND ×3')
    expect(top.edges.map((e) => e.kind)).toEqual(['nd-mgmt'])
    expect(top.edges[0].count).toBe(6)

    const mid = buildScene(graph, fabrics, { kind: 'fabric', fabricId: 'fabric' }, { aggregate: true })
    const ndGroup = mid.nodes.find((n) => n.id === GROUP_ID('fabric', 'nd'))!
    expect(ndGroup.label).toBe('Nexus Dashboard')
    expect(ndGroup.count).toBe(3)
    expect(ndGroup.tier).toBe(3)
    expect(mid.edges.map((e) => `${e.source}>${e.target}:${e.kind}`).sort()).toEqual([
      'group:fabric:leaf>group:fabric:nd:nd-data',
      'group:fabric:nd>oob-mgmt:nd-mgmt',
      'group:fabric:spine>group:fabric:leaf:fabric'
    ])

    const dev = buildScene(graph, fabrics, { kind: 'devices', fabricId: 'fabric' }, { aggregate: true })
    const ndTiles = dev.nodes.filter((n) => n.kind === 'device' && n.role === 'nd')
    expect(ndTiles).toHaveLength(3)
    expect(ndTiles[0].anchorIds).toEqual(['leaf-1', 'leaf-2'])
    const cloud = dev.nodes.find((n) => n.kind === 'cloud')!
    expect(cloud.tier).toBe(4)
    expect(cloud.anchorIds).toEqual(['nd-1', 'nd-2', 'nd-3'])
    const cluster = dev.pairs.find((p) => p.kind === 'nd')!
    expect(cluster.label).toBe('ND-CLUSTER-G5S')
    expect(cluster.memberIds).toEqual(['nd-1', 'nd-2', 'nd-3'])
    // Aggregated: 2 data edges per node (one per leaf) + 1 mgmt edge per node.
    expect(dev.edges.filter((e) => e.kind === 'nd-data')).toHaveLength(6)
    expect(dev.edges.filter((e) => e.kind === 'nd-mgmt')).toHaveLength(3)
    expect(dev.edges.find((e) => e.kind === 'nd-mgmt')!.label).toBe('2 × 10G mgmt')
    expect(dev.edges.find((e) => e.kind === 'nd-data')!.source).toBe('leaf-1')
  })

  it('lays the node row out centred under the attach pair and the cloud under the nodes', () => {
    const design = makeDesign({ oobTier: false })
    const graph = applyNicknames(extractTopology(design, seed(design).links))
    const fabrics = buildFabrics(graph, 'SITE-B')
    const dev = buildScene(graph, fabrics, { kind: 'devices', fabricId: 'fabric' }, { aggregate: true })
    const pos = layoutScene(dev.nodes)
    const leaf1 = pos.get('leaf-1')!
    const leaf2 = pos.get('leaf-2')!
    const nd1 = pos.get('nd-1')!
    const nd2 = pos.get('nd-2')!
    const nd3 = pos.get('nd-3')!
    const cloud = pos.get(OOB_MGMT_DEVICE_ID)!
    // Below the leaf row, in their own slot; side by side.
    expect(nd1.y).toBeGreaterThan(leaf1.y + TILE_H)
    expect(nd1.y).toBe(nd2.y)
    expect(nd3.x - nd1.x).toBeCloseTo((TILE_W + 14) * 2, 5)
    // Centred on the pair.
    expect(nd2.x).toBeCloseTo((leaf1.x + leaf2.x) / 2, 5)
    // Cloud one slot lower, centred on the nodes.
    expect(cloud.y).toBeGreaterThan(nd1.y + TILE_H)
    expect(cloud.x).toBeCloseTo(nd2.x, 5)
  })

  it('PDF scene: counts, cloud ellipse footprint, dashed management lines and the cluster bracket', () => {
    const design = makeDesign({ oobTier: false })
    const graph = applyNicknames(extractTopology(design, seed(design).links))
    const [page] = buildPdfScenePages(graph, 'SITE-B', null)
    expect(page.counts).toMatchObject({ spine: 2, leaf: 4, nd: 3, oob: 1 })
    const cloud = page.nodes.find((n) => n.kind === 'cloud')!
    expect(cloud.w).toBeGreaterThan(cloud.h)
    expect(page.edges.filter((e) => e.kind === 'nd-mgmt').every((e) => e.dashed)).toBe(true)
    expect(page.edges.filter((e) => e.kind === 'nd-data').every((e) => !e.dashed)).toBe(true)
    const bracket = page.pairs.find((p) => p.kind === 'nd')!
    expect(bracket.label).toBe('ND-CLUSTER-G5S')
    expect(bracket.w).toBeGreaterThan(TILE_W * 3)
  })
})

describe('BOMs and CSV — Nexus Dashboard', () => {
  it('device BOM lists the nodes with the cluster PID', () => {
    const bom = buildDeviceBom(makeDesign({ oobTier: false }), SWITCHES)
    const row = bom.rows.find((r) => r.role === 'nd')!
    expect(row.model_id).toBe('ND-NODE-G5S')
    expect(row.count).toBe(3)
    expect(row.ru_total).toBe(3)
    expect(row.unknown_model).toBe(false)
    expect(row.power_estimated).toBe(true)
    expect(bom.nd_cluster).toEqual({ cluster_model_id: 'ND-CLUSTER-G5S', node_model_id: 'ND-NODE-G5S', node_count: 3 })
  })

  it('optics BOM counts ND ends with the catalogue hints and skips the cloud end', () => {
    const design = makeDesign({ oobTier: false })
    const { links } = seed(design)
    const bom = buildOpticsBom({ links, design, switches: SWITCHES })
    expect(bom.by_side.nd).toBe(12) // 6 data + 6 mgmt node ends
    const ndData = bom.rows.find((r) => r.side === 'nd' && r.kind === 'nd-data')!
    expect(ndData.count).toBe(6)
    expect(ndData.optic_hint).toContain('SFP28')
    const ndMgmt = bom.rows.find((r) => r.side === 'nd' && r.kind === 'nd-mgmt')!
    expect(ndMgmt.count).toBe(6)
    expect(ndMgmt.optic_hint).toContain('SFP+')
    const leafNd = bom.rows.find((r) => r.side === 'leaf' && r.kind === 'nd-data')!
    expect(leafNd.count).toBe(6)
    expect(leafNd.optic_hint).toBe('SFP28')
    // No transceiver on the cloud side.
    expect(bom.rows.some((r) => r.side === 'other')).toBe(false)
  })

  it('cable BOM carries every ND cable; cloud cables are uncosted', () => {
    const design = makeDesign({ oobTier: false })
    const { links } = seed(design)
    const bom = buildCableBom({ links, cable_tray_m: null, default_media: 'mmf' })
    const kinds = bom.rows.map((r) => r.kind)
    expect(kinds).toContain('nd-data')
    expect(bom.total_links).toBe(links.length)
    expect(cableKindLabel('nd-data')).toBe('ND data')
    expect(cableKindLabel('nd-mgmt')).toBe('ND mgmt')
  })

  it('CSV round-trips ND rows, including the cloud endpoint', () => {
    const design = makeDesign({ oobTier: false })
    const { links } = seed(design)
    const csv = serializeCableLinksCsv(links)
    const parsed = parseCableLinksCsv(csv, {
      spineIds: new Set(['spine-1', 'spine-2']),
      leafIds: new Set(['leaf-1', 'leaf-2', 'leaf-3', 'leaf-4']),
      ndIds: new Set(['nd-1', 'nd-2', 'nd-3'])
    })
    expect(parsed.rows_skipped_unknown_device).toBe(0)
    expect(parsed.rows_skipped_malformed).toBe(0)
    expect(parsed.links.filter((l) => l.kind === 'nd-mgmt' && l.device_b.device_id === OOB_MGMT_DEVICE_ID)).toHaveLength(6)
    // Without the nd ids the ND rows are rejected, the rest survives.
    const strict = parseCableLinksCsv(csv, { spineIds: new Set(['spine-1', 'spine-2']), leafIds: new Set(['leaf-1', 'leaf-2', 'leaf-3', 'leaf-4']) })
    expect(strict.rows_skipped_unknown_device).toBe(12)
  })
})
