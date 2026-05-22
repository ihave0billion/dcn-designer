import { describe, it, expect } from 'vitest'
import { seedCableLinks } from './cable-links-seeder'
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
  attachments: []
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
  attachments: []
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
