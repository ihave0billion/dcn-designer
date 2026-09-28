import { describe, expect, it } from 'vitest'
import { ND_CLUSTERS, ndSpecFor, planNexusDashboard, OOB_MGMT_DEVICE_ID } from './nexus-dashboard'
import { placeRacks } from './rack'
import { solve } from './solver'
import { ALL_SWITCHES, BREAKOUT_PAIRS, N9348Y2C6D_SE1U, N9K_C9364D_GX2A } from './__fixtures__/switches'
import type { SolverContext, SolverRequirements, TierResult, VpcPair } from './types'

function tier(model: string, leaves: number, extra: Partial<TierResult> = {}): TierResult {
  return {
    speed_tier_label: model,
    leaf_model_id: model,
    endpoint_count_input: null,
    switch_count_input: leaves,
    leaves_required: leaves,
    endpoints_supported: leaves * 48,
    host_ports_per_leaf: 48,
    host_speed_g: 25,
    effective_uplink_ports: 2,
    effective_uplink_speed_g: 400,
    effective_uplink_choice: 'primary',
    override_uplink_speed_applied_g: null,
    host_bw_g: 0,
    uplink_bw_g: 0,
    xor_status: 'ok',
    vpc_pairs: true,
    oob_management: false,
    ...extra
  }
}

const pairs: VpcPair[] = [
  { id: 'pair-1', members: ['leaf-1', 'leaf-2'] },
  { id: 'pair-2', members: ['leaf-3', 'leaf-4'] }
]

describe('ND catalogue', () => {
  it('resolves cluster and node PIDs', () => {
    expect(ndSpecFor('ND-CLUSTER-G5S')?.node_model_id).toBe('ND-NODE-G5S')
    expect(ndSpecFor('ND-NODE-G5L')?.cluster_model_id).toBe('ND-CLUSTER-G5L')
    expect(ndSpecFor('N9K-C9364D-GX2A')).toBeNull()
    expect(ND_CLUSTERS['ND-CLUSTER-G5S'].ru).toBe(1)
    expect(ND_CLUSTERS['ND-CLUSTER-G5L'].ru).toBe(2)
  })
})

describe('planNexusDashboard', () => {
  it('returns null without a cluster', () => {
    expect(planNexusDashboard({ request: null, tiers: [tier('A', 4)], pairs }).result).toBeNull()
    expect(planNexusDashboard({ request: { cluster_model_id: null }, tiers: [tier('A', 4)], pairs }).result).toBeNull()
  })

  it('attaches three nodes to the first pair of the first data tier; mgmt goes to the cloud', () => {
    const { result, warnings } = planNexusDashboard({
      request: { cluster_model_id: 'ND-CLUSTER-G5S' },
      tiers: [tier('A', 4)],
      pairs
    })
    expect(warnings).toEqual([])
    expect(result).not.toBeNull()
    expect(result!.node_count).toBe(3)
    expect(result!.nodes.map((n) => n.device_id)).toEqual(['nd-1', 'nd-2', 'nd-3'])
    expect(result!.node_model_id).toBe('ND-NODE-G5S')
    expect(result!.data_leaf_ids).toEqual(['leaf-1', 'leaf-2'])
    expect(result!.attach_pair_id).toBe('pair-1')
    expect(result!.mgmt_leaf_ids).toBeNull()
    expect(result!.data_speed_g).toBe(25)
    expect(result!.mgmt_speed_g).toBe(10)
    expect(result!.data_ports).toEqual(['fabric0', 'fabric1'])
    expect(result!.mgmt_ports).toEqual(['mgmt0', 'mgmt1'])
  })

  it('honours a chosen pair, node count and speeds', () => {
    const { result, warnings } = planNexusDashboard({
      request: { cluster_model_id: 'ND-CLUSTER-G5L', node_count: 1, data_speed_g: 50, mgmt_speed_g: 1, attach_pair_id: 'pair-2' },
      tiers: [tier('A', 4)],
      pairs
    })
    expect(warnings).toEqual([])
    expect(result!.node_count).toBe(1)
    expect(result!.ru_per_node).toBe(2)
    expect(result!.data_leaf_ids).toEqual(['leaf-3', 'leaf-4'])
    expect(result!.data_speed_g).toBe(50)
    expect(result!.mgmt_speed_g).toBe(1)
  })

  it('warns and falls back when the chosen pair is gone', () => {
    const { result, warnings } = planNexusDashboard({
      request: { cluster_model_id: 'ND-CLUSTER-G5S', attach_pair_id: 'pair-9' },
      tiers: [tier('A', 4)],
      pairs
    })
    expect(warnings.map((w) => w.code)).toEqual(['ND_ATTACH_PAIR_NOT_FOUND'])
    expect(result!.data_leaf_ids).toEqual(['leaf-1', 'leaf-2'])
  })

  it('lands management links on the OOB tier and never uses it for data', () => {
    // Tier order: OOB tier first (leaf-1..2), data tier second (leaf-3..4).
    const { result } = planNexusDashboard({
      request: { cluster_model_id: 'ND-CLUSTER-G5S' },
      tiers: [tier('FX3', 2, { oob_management: true, vpc_pairs: false }), tier('SE1U', 2)],
      pairs: [{ id: 'pair-1', members: ['leaf-3', 'leaf-4'] }]
    })
    expect(result!.data_leaf_ids).toEqual(['leaf-3', 'leaf-4'])
    expect(result!.mgmt_leaf_ids).toEqual(['leaf-1', 'leaf-2'])
  })

  it('uses the first two leaves (or one leaf twice) when the tier has no pair', () => {
    const noPairs = planNexusDashboard({ request: { cluster_model_id: 'ND-CLUSTER-G5S' }, tiers: [tier('A', 3, { vpc_pairs: false })], pairs: [] })
    expect(noPairs.result!.data_leaf_ids).toEqual(['leaf-1', 'leaf-2'])
    expect(noPairs.result!.attach_pair_id).toBeNull()
    const single = planNexusDashboard({ request: { cluster_model_id: 'ND-CLUSTER-G5S' }, tiers: [tier('A', 1, { vpc_pairs: false })], pairs: [] })
    expect(single.result!.data_leaf_ids).toEqual(['leaf-1', 'leaf-1'])
  })
})

describe('placeRacks with a Nexus Dashboard cluster', () => {
  it('racks the nodes with the attach pair, top-of-rack packed after the leaves', () => {
    const tiers = [tier(N9348Y2C6D_SE1U.id, 4)]
    const nd = planNexusDashboard({ request: { cluster_model_id: 'ND-CLUSTER-G5S' }, tiers, pairs }).result
    const { layout, warnings } = placeRacks(
      { spine_model_id: N9K_C9364D_GX2A.id, spines_needed: 2, spine_ports: 64, spine_speed_g: 400, total_leaves: 4, total_leaf_uplinks: 8, spines_capacity: 1, spines_touching: 2, spines_port_count: 1, required_uplinks_per_leaf: 2 } as never,
      tiers,
      ALL_SWITCHES,
      [
        { name: 'Rack1', size_u: 44, pdu_kw_budget: null },
        { name: 'Rack2', size_u: 44, pdu_kw_budget: null }
      ],
      null,
      nd
    )
    expect(warnings).toEqual([])
    const withLeaf1 = layout.find((r) => r.devices.some((d) => d.device_id === 'leaf-1'))!
    const ndDevices = withLeaf1.devices.filter((d) => d.role === 'nd')
    expect(ndDevices.map((d) => d.device_id)).toEqual(['nd-1', 'nd-2', 'nd-3'])
    expect(ndDevices.every((d) => d.model_id === 'ND-NODE-G5S' && d.ru === 1)).toBe(true)
    // Below the leaves in the same rack.
    const leafU = Math.min(...withLeaf1.devices.filter((d) => d.role === 'leaf').map((d) => d.start_u))
    expect(Math.max(...ndDevices.map((d) => d.start_u))).toBeLessThan(leafU)
  })

  it('spills to another rack when the attach rack is full', () => {
    const tiers = [tier(N9348Y2C6D_SE1U.id, 2)]
    const nd = planNexusDashboard({ request: { cluster_model_id: 'ND-CLUSTER-G5L' }, tiers, pairs: [{ id: 'pair-1', members: ['leaf-1', 'leaf-2'] }] }).result
    const { layout, warnings } = placeRacks(null, tiers, ALL_SWITCHES, [
      { name: 'Tiny', size_u: 3, pdu_kw_budget: null },
      { name: 'Big', size_u: 44, pdu_kw_budget: null }
    ], null, nd)
    expect(warnings).toEqual([])
    const big = layout.find((r) => r.rack_name === 'Big')!
    expect(big.devices.filter((d) => d.role === 'nd')).toHaveLength(3)
    expect(big.devices.filter((d) => d.role === 'nd').every((d) => d.ru === 2)).toBe(true)
  })

  it('reports when no rack can take a node', () => {
    const tiers = [tier(N9348Y2C6D_SE1U.id, 2)]
    const nd = planNexusDashboard({ request: { cluster_model_id: 'ND-CLUSTER-G5S' }, tiers, pairs: [] }).result
    const { warnings } = placeRacks(null, tiers, ALL_SWITCHES, [{ name: 'Tiny', size_u: 3, pdu_kw_budget: null }], null, nd)
    expect(warnings.filter((w) => w.code === 'RACK_INSUFFICIENT_SPACE')).toHaveLength(2)
  })
})

describe('solve() with a Nexus Dashboard cluster', () => {
  const context: SolverContext = { switches: ALL_SWITCHES, servers: [], breakout_pairs: BREAKOUT_PAIRS }
  const requirements: SolverRequirements = {
    fabric: { uplinks_per_leaf: 2, uplinks_per_spine: 1, spine_model_id: N9K_C9364D_GX2A.id, use_case: 'dcn', input_mode: 'aggregate' },
    tiers: [
      { speed_tier_label: '25G', endpoint_count: null, switch_count: 4, leaf_model_id: N9348Y2C6D_SE1U.id, override_uplink_speed_g: null },
      { speed_tier_label: '1G', endpoint_count: null, switch_count: 2, leaf_model_id: N9348Y2C6D_SE1U.id, override_uplink_speed_g: null, vpc_pairs: false, oob_management: true }
    ],
    racks: [
      { name: 'Rack1', size_u: 44, pdu_kw_budget: null },
      { name: 'Rack2', size_u: 44, pdu_kw_budget: null },
      { name: 'Rack3', size_u: 44, pdu_kw_budget: null }
    ],
    nexus_dashboard: { cluster_model_id: 'ND-CLUSTER-G5S' }
  }

  it('publishes the plan, racks the nodes in every candidate and passes oob_management through', () => {
    const design = solve(requirements, context)
    expect(design.nexus_dashboard?.cluster_model_id).toBe('ND-CLUSTER-G5S')
    expect(design.nexus_dashboard?.data_leaf_ids).toEqual(['leaf-1', 'leaf-2'])
    expect(design.nexus_dashboard?.mgmt_leaf_ids).toEqual(['leaf-5', 'leaf-6'])
    expect(design.tiers[1].oob_management).toBe(true)
    const nds = design.rack_layout.flatMap((r) => r.devices).filter((d) => d.role === 'nd')
    expect(nds).toHaveLength(3)
    for (const c of design.candidates) {
      expect(c.rack_layout.flatMap((r) => r.devices).filter((d) => d.role === 'nd')).toHaveLength(3)
    }
    expect(design.warnings.some((w) => w.code.startsWith('ND_'))).toBe(false)
  })

  it('leaves the design untouched without a cluster', () => {
    const design = solve({ ...requirements, nexus_dashboard: null }, context)
    expect(design.nexus_dashboard).toBeNull()
    expect(design.rack_layout.flatMap((r) => r.devices).some((d) => d.role === 'nd')).toBe(false)
  })

  it('still synthesises the nodes when there is no rack inventory', () => {
    const design = solve({ ...requirements, racks: [] }, context)
    expect(design.nexus_dashboard?.node_count).toBe(3)
    expect(design.rack_layout).toEqual([])
    expect(OOB_MGMT_DEVICE_ID).toBe('oob-mgmt')
  })
})
