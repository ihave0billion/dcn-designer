import { describe, it, expect } from 'vitest'
import { defaultPeerLinkTemplate, peerLinkPorts, seedCableLinks } from './cable-links-seeder'
import type { Switch } from '@/schemas/switches'
import type { DesignResult, BreakoutPair } from '@domain'

// ────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────

const SPINE_SW: Switch = {
  id: 'N9K-C9364D-GX2A',
  model_display: 'Nexus 9364D-GX2A',
  vendor: 'Cisco',
  role: 'spine',
  category: '400G',
  primary: {
    ports: 64,
    speed_g: 400,
    speed_options_g: [400],
    naming_template: 'Eth1/{1..64}'
  },
  uplink: null,
  secondary_uplink: null,
  ru: 2,
  power_w: 1500,
  optic_hint: null,
  capabilities: {
    aci_leaf: true,
    aci_spine: true,
    nxos: true,
    rocev2: true,
    deep_buffer: false,
    smart_switch: false,
    ult_low_latency: false,
    poe: false,
    macsec: false,
    hpc: true,
    ai_ml: true,
    dpu_integrated: false
  },
  aci_note: null,
  asic: null,
  availability: 'available',
  available_from: null,
  notes: null,
  data_sheet_url: null,
  attachments: [],
  peer_link_ports: null
}

const LEAF_SW: Switch = {
  id: 'N9K-C93400LD-H1',
  model_display: 'Nexus 93400LD-H1',
  vendor: 'Cisco',
  role: 'leaf',
  category: '25G-ToR',
  primary: {
    ports: 48,
    speed_g: 25,
    speed_options_g: [25],
    naming_template: 'Eth1/{1..48}'
  },
  uplink: {
    ports: 4,
    speed_g: 400,
    speed_options_g: [400],
    naming_template: 'Eth1/{49..52}'
  },
  secondary_uplink: null,
  ru: 1,
  power_w: 600,
  optic_hint: null,
  capabilities: {
    aci_leaf: true,
    aci_spine: false,
    nxos: true,
    rocev2: false,
    deep_buffer: false,
    smart_switch: false,
    ult_low_latency: false,
    poe: false,
    macsec: false,
    hpc: false,
    ai_ml: false,
    dpu_integrated: false
  },
  aci_note: null,
  asic: null,
  availability: 'available',
  available_from: null,
  notes: null,
  data_sheet_url: null,
  attachments: [],
  peer_link_ports: null
}

function makeDesign(opts: {
  leafCount: number
  spineCount: number
  breakoutInEffect?: boolean
  patchPanelNeeded?: boolean
}): DesignResult {
  const { leafCount, spineCount, breakoutInEffect = false, patchPanelNeeded = false } = opts
  const tierEntry = {
    speed_tier_label: '25G',
    leaf_model_id: LEAF_SW.id,
    endpoint_count_input: leafCount * 48,
    switch_count_input: null,
    leaves_required: leafCount,
    endpoints_supported: leafCount * 48,
    host_ports_per_leaf: 48,
    host_speed_g: 25,
    effective_uplink_ports: 4,
    effective_uplink_speed_g: 400,
    effective_uplink_choice: 'primary' as const,
    override_uplink_speed_applied_g: null,
    host_bw_g: leafCount * 48 * 25,
    uplink_bw_g: leafCount * 4 * 400,
    xor_status: 'ok' as const
  }
  const rack_layout = [
    {
      rack_name: 'Rack A',
      size_u: 42,
      pdu_kw_budget: null,
      estimated_power_w: 0,
      over_budget: false,
      devices: [
        ...Array.from({ length: spineCount }, (_, i) => ({
          device_id: `spine-${i + 1}`,
          model_id: SPINE_SW.id,
          role: 'spine' as const,
          start_u: 40 - i * 2,
          ru: 2,
          label: `Spine ${i + 1}`
        })),
        ...Array.from({ length: leafCount }, (_, i) => ({
          device_id: `leaf-${i + 1}`,
          model_id: LEAF_SW.id,
          role: 'leaf' as const,
          start_u: i + 1,
          ru: 1,
          label: `Leaf ${i + 1}`
        }))
      ]
    }
  ]
  return {
    schema_version: 1,
    summary: {
      total_leaves: leafCount,
      total_spines: spineCount,
      total_servers: 0,
      spines_no_breakout: breakoutInEffect ? spineCount * 4 : spineCount,
      spines_with_breakout: breakoutInEffect ? spineCount : null,
      total_host_bw_g: leafCount * 48 * 25,
      total_uplink_bw_g: leafCount * 4 * 400,
      computed_oversub_ratio: 0.75,
      computed_oversub_label: '0.75:1',
      valid: true,
      breakout_required_to_be_valid: breakoutInEffect
    },
    tiers: [tierEntry],
    spine: {
      spine_model_id: SPINE_SW.id,
      spine_ports: 64,
      spine_speed_g: 400,
      total_leaves: leafCount,
      total_leaf_uplinks: leafCount * 4,
      spines_capacity: 1,
      spines_touching: 2,
      spines_port_count: 1,
      spines_needed: spineCount,
      required_uplinks_per_leaf: 4,
      spine_touching_divisible: true
    },
    breakout: breakoutInEffect
      ? {
          applicable: true,
          fanout: 4,
          spines_with_breakout: spineCount,
          uplinks_per_leaf_with_breakout: 4,
          reduces_spine_count: true,
          flips_to_valid: true,
          recommended_pair: {
            spine_pid: 'QDD-400G-SR4.2',
            leaf_pid: 'QSFP-100G-SR1.2',
            fanout: 4,
            spine_connector: 'MPO-12 (UPC)',
            leaf_connector: 'LC (UPC)',
            requires_patch_panel: patchPanelNeeded,
            verified_by: 'test',
            notes: null
          },
          patch_panel_needed: patchPanelNeeded
        }
      : null,
    optics_bom: [],
    rack_layout,
    warnings: [],
    // Phase 2b — candidate matrix isn't exercised by the cable-links
    // seeder, so an empty array + canonical primary id are sufficient
    // mock state.
    candidates: [],
    primary_candidate_id: 'single_no_breakout',
    committed_candidate_id: 'single_no_breakout'
  }
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('seedCableLinks', () => {
  it('seeds N×U/per_spine fabric links for a basic non-breakout design', () => {
    const design = makeDesign({ leafCount: 2, spineCount: 2 })
    const result = seedCableLinks({
      design,
      switches: [SPINE_SW, LEAF_SW],
      fabric: { uplinks_per_leaf: 4, uplinks_per_spine: 2 },
      breakoutPairs: [],
      patchPanels: []
    })
    // 2 leaves × 4 uplinks = 8 links
    expect(result.links).toHaveLength(8)

    // Each leaf should touch every spine when spinesPerLeaf == spines_needed
    // Here: spinesPerLeaf = 4/2 = 2, spines_needed = 2 → each leaf touches both spines.
    const leaf1Spines = new Set(
      result.links.filter((l) => l.device_b.device_id === 'leaf-1').map((l) => l.device_a.device_id)
    )
    expect(leaf1Spines).toEqual(new Set(['spine-1', 'spine-2']))

    // Spine ports should be sequential within each spine
    const spine1Ports = result.links
      .filter((l) => l.device_a.device_id === 'spine-1')
      .map((l) => l.device_a.port)
    expect(spine1Ports[0]).toBe('Eth1/1')
    expect(spine1Ports[1]).toBe('Eth1/2')
  })

  it('seeds spine↔IPN links when the design carries an IPN rack (multi-pod)', () => {
    const design = makeDesign({ leafCount: 2, spineCount: 2 })
    // Append a solver-suggested IPN rack with 2 HA routers.
    design.rack_layout.push({
      rack_name: 'IPN',
      size_u: 44,
      pdu_kw_budget: null,
      estimated_power_w: 1600,
      over_budget: false,
      devices: [
        { device_id: 'ipn-1', model_id: 'N9K-C9332D-GX2B', role: 'ipn', start_u: 44, ru: 1, label: 'IPN 1' },
        { device_id: 'ipn-2', model_id: 'N9K-C9332D-GX2B', role: 'ipn', start_u: 43, ru: 1, label: 'IPN 2' }
      ]
    })
    const result = seedCableLinks({
      design,
      switches: [SPINE_SW, LEAF_SW],
      fabric: { uplinks_per_leaf: 4, uplinks_per_spine: 2 },
      breakoutPairs: [],
      patchPanels: []
    })
    const ipnLinks = result.links.filter((l) => l.device_b.device_id.startsWith('ipn-'))
    // 2 spines × 2 IPNs × 4 ports = 16 spine↔IPN links
    expect(ipnLinks).toHaveLength(16)
    // Spine-side ports come from the END of the 64-port list (reserved block)
    const spine1IpnPorts = ipnLinks
      .filter((l) => l.device_a.device_id === 'spine-1')
      .map((l) => l.device_a.port)
    expect(spine1IpnPorts).toContain('Eth1/64')
    // IPN-side ports are sequential per router
    const ipn1Ports = ipnLinks
      .filter((l) => l.device_b.device_id === 'ipn-1')
      .map((l) => l.device_b.port)
    expect(ipn1Ports[0]).toBe('Eth1/1')
    // Spine↔IPN links inherit the spine speed
    expect(ipnLinks.every((l) => l.speed_g === 400)).toBe(true)
    // Leaf links are still seeded (8) alongside the 16 IPN links
    expect(result.links).toHaveLength(8 + 16)
  })

  it('marks no patch panel needed when breakout is off', () => {
    const design = makeDesign({ leafCount: 1, spineCount: 2 })
    const result = seedCableLinks({
      design,
      switches: [SPINE_SW, LEAF_SW],
      fabric: { uplinks_per_leaf: 4, uplinks_per_spine: 2 },
      breakoutPairs: [],
      patchPanels: []
    })
    for (const l of result.links) expect(l.patch_panel_id).toBeNull()
  })

  it('uses sub-port suffixes under breakout fanout', () => {
    const design = makeDesign({
      leafCount: 4,
      spineCount: 1,
      breakoutInEffect: true,
      patchPanelNeeded: true
    })
    const result = seedCableLinks({
      design,
      switches: [SPINE_SW, LEAF_SW],
      fabric: { uplinks_per_leaf: 4, uplinks_per_spine: 4 },
      breakoutPairs: [],
      patchPanels: []
    })
    expect(result.links.length).toBeGreaterThan(0)
    // All spine ports should match Eth1/N/M pattern under fanout
    for (const l of result.links) {
      expect(l.device_a.port).toMatch(/^Eth1\/\d+\/\d+$/)
    }
    // Patch panel should be the synthetic placeholder since patchPanels: []
    for (const l of result.links) {
      expect(l.patch_panel_id).toBe('PP-MPO12-LC')
    }
  })

  it('emits a note + skips when uplinks_per_leaf is not divisible by uplinks_per_spine', () => {
    const design = makeDesign({ leafCount: 2, spineCount: 3 })
    const result = seedCableLinks({
      design,
      switches: [SPINE_SW, LEAF_SW],
      fabric: { uplinks_per_leaf: 4, uplinks_per_spine: 3 },
      breakoutPairs: [],
      patchPanels: []
    })
    expect(result.links).toHaveLength(0)
    expect(result.notes.join(' ')).toMatch(/not evenly divisible/)
  })

  it('uses the curated patch panel when one matches the connector pair', () => {
    const design = makeDesign({
      leafCount: 1,
      spineCount: 1,
      breakoutInEffect: true,
      patchPanelNeeded: true
    })
    const result = seedCableLinks({
      design,
      switches: [SPINE_SW, LEAF_SW],
      fabric: { uplinks_per_leaf: 4, uplinks_per_spine: 4 },
      breakoutPairs: [
        {
          spine_pid: 'QDD-400G-SR4.2',
          leaf_pid: 'QSFP-100G-SR1.2',
          fanout: 4,
          spine_connector: 'MPO-12 (UPC)',
          leaf_connector: 'LC (UPC)',
          requires_patch_panel: true,
          verified_by: 'test'
        } satisfies BreakoutPair
      ],
      patchPanels: [
        {
          id: 'PANDUIT-FAP12WBLAQ',
          vendor: 'Panduit',
          description: 'MPO-12 to 6× LC',
          connector_a: 'MPO-12 (UPC)',
          connector_b: 'LC (UPC)',
          fanout: 6,
          media: 'MMF',
          notes: null,
          data_sheet_url: null
        }
      ]
    })
    for (const l of result.links) {
      expect(l.patch_panel_id).toBe('PANDUIT-FAP12WBLAQ')
    }
  })
})

// ────────────────────────────────────────────────────────────────────
// Phase 14 — vPC peer-links
// ────────────────────────────────────────────────────────────────────

// The SITE-A smart switch: 48×25G hosts, 6×400G uplinks (Eth1/49-54), 2×100G
// secondary uplinks (Eth1/55-56). The peer-link must land on 400G ports.
const SE1U: Switch = {
  ...LEAF_SW,
  id: 'N9348Y2C6D-SE1U',
  model_display: 'Nexus 9348Y2C6D-SE1U',
  uplink: { ports: 6, speed_g: 400, speed_options_g: [400], naming_template: 'Eth1/{49..54}' },
  secondary_uplink: { ports: 2, speed_g: 100, speed_options_g: [100], naming_template: 'Eth1/{55..56}' }
}

function vpcDesign(leafCount: number, vpc: Partial<NonNullable<DesignResult['vpc']>> = {}): DesignResult {
  const d = makeDesign({ leafCount, spineCount: 2 })
  for (const r of d.rack_layout) for (const dev of r.devices) if (dev.role === 'leaf') dev.model_id = SE1U.id
  d.tiers[0].leaf_model_id = SE1U.id
  const pairs: Array<{ id: string; members: [string, string] }> = []
  for (let i = 1; i + 1 <= leafCount; i += 2) pairs.push({ id: `pair-${pairs.length + 1}`, members: [`leaf-${i}`, `leaf-${i + 1}`] })
  d.vpc = {
    mode: 'nxos-evpn',
    peer_link: true,
    port_channel: true,
    members: 2,
    configured_uplinks_per_leaf: 4,
    effective_uplinks_per_leaf: 4,
    pairs,
    unpaired: leafCount % 2 ? [`leaf-${leafCount}`] : [],
    ...vpc
  }
  return d
}

const FABRIC_4_2 = { uplinks_per_leaf: 4, uplinks_per_spine: 2 }

describe('peerLinkPorts (Phase 14)', () => {
  it('defaults to the first ports of the 400G uplink group, never the 100G secondaries', () => {
    expect(peerLinkPorts(SE1U, 2)).toEqual({ ports: ['Eth1/49', 'Eth1/50'], speed_g: 400 })
    expect(peerLinkPorts(SE1U, 4).ports).toEqual(['Eth1/49', 'Eth1/50', 'Eth1/51', 'Eth1/52'])
    expect(defaultPeerLinkTemplate(SE1U)).toBe('Eth1/{49..50}')
  })
  it('honours the library template and takes that group\'s speed', () => {
    const sw = { ...SE1U, peer_link_ports: 'Eth1/{55..56}' }
    expect(peerLinkPorts(sw, 2)).toEqual({ ports: ['Eth1/55', 'Eth1/56'], speed_g: 100 })
  })
  it('falls back to the primary group on a leaf with no uplink group', () => {
    const sw = { ...SPINE_SW, role: 'leaf' as const }
    expect(peerLinkPorts(sw, 2)).toEqual({ ports: ['Eth1/1', 'Eth1/2'], speed_g: 400 })
  })
})

const FX3_SW: Switch = {
  ...LEAF_SW,
  id: '9348GC-FX3',
  model_display: 'Nexus 9348GC-FX3',
  primary: { ports: 48, speed_g: 1, speed_options_g: [1], naming_template: 'Eth1/{1..48}' },
  uplink: { ports: 2, speed_g: 100, speed_options_g: [100], naming_template: 'Eth1/{53..54}' },
  secondary_uplink: { ports: 4, speed_g: 25, speed_options_g: [25], naming_template: 'Eth1/{49..52}' }
}

describe('peerLinkPorts — group fallback (Phase 14)', () => {
  it('FX3 with 2 uplinks/leaf: the peer-link moves to the 25G group and the 100G uplinks stay', () => {
    expect(peerLinkPorts(FX3_SW, 2, 2)).toEqual({ ports: ['Eth1/49', 'Eth1/50'], speed_g: 25 })
    expect(defaultPeerLinkTemplate(FX3_SW, 2, 2)).toBe('Eth1/{49..50}')
    // nothing configured yet (library dialog placeholder) → the fastest group
    expect(peerLinkPorts(FX3_SW, 2).ports).toEqual(['Eth1/53', 'Eth1/54'])
  })
  it('seeds the FX3 pair on 25G ports and both 100G uplinks to the spines', () => {
    const d = vpcDesign(2)
    for (const r of d.rack_layout) for (const dev of r.devices) if (dev.role === 'leaf') dev.model_id = FX3_SW.id
    d.tiers[0].leaf_model_id = FX3_SW.id
    d.tiers[0].effective_uplink_speed_g = 100
    d.vpc!.configured_uplinks_per_leaf = 2
    d.vpc!.effective_uplinks_per_leaf = 2
    const { links, notes } = seedCableLinks({ design: d, switches: [SPINE_SW, FX3_SW], fabric: { uplinks_per_leaf: 2, uplinks_per_spine: 1 }, breakoutPairs: [], patchPanels: [] })
    const pl = links.filter((l) => l.kind === 'vpc-peer-link')
    expect(pl.map((l) => `${l.device_a.port}>${l.device_b.port}@${l.speed_g}`)).toEqual(['Eth1/49>Eth1/49@25', 'Eth1/50>Eth1/50@25'])
    expect(links.filter((l) => l.kind === 'uplink' && l.device_b.device_id === 'leaf-1').map((l) => l.device_b.port)).toEqual(['Eth1/53', 'Eth1/54'])
    expect(notes).toEqual([])
  })
})

describe('seedCableLinks — vPC peer-links (Phase 14)', () => {
  it('seeds 2×400G peer-links per pair on Eth1/49-50 and moves the uplinks to the end of the group', () => {
    const { links, notes } = seedCableLinks({ design: vpcDesign(4), switches: [SPINE_SW, SE1U], fabric: FABRIC_4_2, breakoutPairs: [], patchPanels: [] })
    const pl = links.filter((l) => l.kind === 'vpc-peer-link')
    expect(pl).toHaveLength(4)
    expect(pl.map((l) => `${l.device_a.device_id}:${l.device_a.port}>${l.device_b.device_id}:${l.device_b.port}`)).toEqual([
      'leaf-1:Eth1/49>leaf-2:Eth1/49',
      'leaf-1:Eth1/50>leaf-2:Eth1/50',
      'leaf-3:Eth1/49>leaf-4:Eth1/49',
      'leaf-3:Eth1/50>leaf-4:Eth1/50'
    ])
    expect(pl.every((l) => l.speed_g === 400 && l.notes === 'vPC peer-link (port-channel)' && l.optic_id === null)).toBe(true)
    // uplinks: 4 per leaf from the END of the 6-port group minus the peer-link
    const up = links.filter((l) => l.kind === 'uplink' && l.device_b.device_id === 'leaf-1').map((l) => l.device_b.port)
    expect(up).toEqual(['Eth1/51', 'Eth1/52', 'Eth1/53', 'Eth1/54'])
    expect(links.filter((l) => l.kind === 'uplink')).toHaveLength(16)
    expect(notes).toEqual([])
    // ids stay unique and sequential
    expect(new Set(links.map((l) => l.id)).size).toBe(links.length)
  })

  it('an odd leaf gets uplinks from the start of the group and no peer-link', () => {
    const { links } = seedCableLinks({ design: vpcDesign(3), switches: [SPINE_SW, SE1U], fabric: FABRIC_4_2, breakoutPairs: [], patchPanels: [] })
    expect(links.filter((l) => l.kind === 'vpc-peer-link').map((l) => l.device_a.device_id)).toEqual(['leaf-1', 'leaf-1'])
    const up3 = links.filter((l) => l.kind === 'uplink' && l.device_b.device_id === 'leaf-3').map((l) => l.device_b.port)
    expect(up3).toEqual(['Eth1/49', 'Eth1/50', 'Eth1/51', 'Eth1/52'])
  })

  it('no peer-link when the design says so (ACI / peer-link off) and no port-channel note when unbundled', () => {
    const aci = seedCableLinks({ design: vpcDesign(2, { mode: 'aci', peer_link: false, port_channel: false, members: 0 }), switches: [SPINE_SW, SE1U], fabric: FABRIC_4_2, breakoutPairs: [], patchPanels: [] })
    expect(aci.links.every((l) => l.kind === 'uplink')).toBe(true)
    expect(aci.links.filter((l) => l.device_b.device_id === 'leaf-1').map((l) => l.device_b.port)).toEqual(['Eth1/49', 'Eth1/50', 'Eth1/51', 'Eth1/52'])
    const unbundled = seedCableLinks({ design: vpcDesign(2, { port_channel: false }), switches: [SPINE_SW, SE1U], fabric: FABRIC_4_2, breakoutPairs: [], patchPanels: [] })
    expect(unbundled.links.find((l) => l.kind === 'vpc-peer-link')?.notes).toBe('vPC peer-link')
  })

  it('an explicit pairs list (leaf_pairs.yaml fork) wins over the solver\'s', () => {
    const { links } = seedCableLinks({
      design: vpcDesign(4),
      switches: [SPINE_SW, SE1U],
      fabric: FABRIC_4_2,
      breakoutPairs: [],
      patchPanels: [],
      pairs: [{ id: 'pair-1', members: ['leaf-1', 'leaf-4'] }]
    })
    const pl = links.filter((l) => l.kind === 'vpc-peer-link')
    expect(pl.map((l) => `${l.device_a.device_id}>${l.device_b.device_id}`)).toEqual(['leaf-1>leaf-4', 'leaf-1>leaf-4'])
    // leaf-2 and leaf-3 are now unpaired → their uplinks start at Eth1/49
    expect(links.filter((l) => l.kind === 'uplink' && l.device_b.device_id === 'leaf-2')[0].device_b.port).toBe('Eth1/49')
  })

  it('notes a pair whose member is missing and a model with too few peer-link ports', () => {
    const short = { ...SE1U, id: 'SHORT', uplink: { ports: 1, speed_g: 400, speed_options_g: [400], naming_template: 'Eth1/{49..49}' }, secondary_uplink: null }
    const d = vpcDesign(2)
    for (const r of d.rack_layout) for (const dev of r.devices) if (dev.role === 'leaf') dev.model_id = 'SHORT'
    d.tiers[0].leaf_model_id = 'SHORT'
    const r = seedCableLinks({ design: d, switches: [SPINE_SW, short], fabric: { uplinks_per_leaf: 2, uplinks_per_spine: 1 }, breakoutPairs: [], patchPanels: [], pairs: [{ id: 'pair-1', members: ['leaf-1', 'leaf-2'] }, { id: 'pair-9', members: ['leaf-8', 'leaf-9'] }] })
    expect(r.notes.some((n) => n.includes('pair-9'))).toBe(true)
    expect(r.notes.some((n) => n.includes('pair-1') && n.includes('only 1 peer-link port'))).toBe(true)
    expect(r.links.filter((l) => l.kind === 'vpc-peer-link')).toHaveLength(1)
  })
})
