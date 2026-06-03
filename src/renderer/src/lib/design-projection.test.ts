import { describe, it, expect } from 'vitest'
import { projectCommittedCandidate, isCommittedMultiPod, findCandidate } from './design-projection'
import type { DesignCandidate, DesignResult, RackPlacement } from '@domain'

// Minimal rack layouts to tell the two candidates apart after projection.
const SINGLE_LAYOUT: RackPlacement[] = [
  {
    rack_name: 'Rack A',
    size_u: 44,
    pdu_kw_budget: null,
    estimated_power_w: 0,
    over_budget: false,
    devices: [
      { device_id: 'spine-1', model_id: 'SPINE', role: 'spine', start_u: 44, ru: 1, label: 'Spine 1', pod_index: null },
      { device_id: 'spine-2', model_id: 'SPINE', role: 'spine', start_u: 43, ru: 1, label: 'Spine 2', pod_index: null }
    ]
  }
]

const MULTI_LAYOUT: RackPlacement[] = [
  {
    rack_name: 'Rack A',
    size_u: 44,
    pdu_kw_budget: null,
    estimated_power_w: 0,
    over_budget: false,
    devices: [
      { device_id: 'spine-1', model_id: 'SPINE', role: 'spine', start_u: 44, ru: 1, label: 'Spine 1', pod_index: 0 },
      { device_id: 'spine-2', model_id: 'SPINE', role: 'spine', start_u: 43, ru: 1, label: 'Spine 2', pod_index: 1 }
    ]
  },
  {
    rack_name: 'IPN',
    size_u: 44,
    pdu_kw_budget: null,
    estimated_power_w: 0,
    over_budget: false,
    devices: [
      { device_id: 'ipn-1', model_id: 'IPN', role: 'ipn', start_u: 44, ru: 1, label: 'IPN 1', pod_index: null }
    ]
  }
]

function makeCandidate(over: Partial<DesignCandidate>): DesignCandidate {
  return {
    id: 'single_no_breakout',
    pod_variant: 'single',
    breakout_variant: 'no_breakout',
    valid: true,
    spine: null,
    breakout: null,
    multipod: null,
    rack_layout: [],
    optics_bom: [],
    warnings: [],
    total_spines: 2,
    total_ipn_routers: 0,
    total_host_bw_g: 1000,
    total_uplink_bw_g: 1000,
    computed_oversub_ratio: 1,
    computed_oversub_label: '1.00:1',
    ...over
  }
}

const singleCand = makeCandidate({
  id: 'single_no_breakout',
  rack_layout: SINGLE_LAYOUT,
  total_spines: 2
})

const multiCand = makeCandidate({
  id: 'multi_with_breakout',
  pod_variant: 'multi',
  breakout_variant: 'with_breakout',
  rack_layout: MULTI_LAYOUT,
  total_spines: 4,
  total_ipn_routers: 2,
  multipod: {
    pods_needed: 2,
    leaves_per_pod: [56, 55],
    spines_per_pod: 2,
    ipn_routers_needed: 2,
    ipn_router_model_id: 'IPN',
    ports_per_spine_per_ipn: 4,
    spine_to_ipn_links: 32,
    effective_spine_ports: 56
  }
})

const baseDesign: DesignResult = {
  schema_version: 1,
  summary: {
    total_leaves: 111,
    total_spines: 2,
    total_servers: 0,
    spines_no_breakout: 2,
    spines_with_breakout: null,
    total_host_bw_g: 1000,
    total_uplink_bw_g: 1000,
    computed_oversub_ratio: 1,
    computed_oversub_label: '1.00:1',
    valid: true,
    breakout_required_to_be_valid: false
  },
  tiers: [],
  spine: null,
  breakout: null,
  optics_bom: [],
  rack_layout: SINGLE_LAYOUT,
  warnings: [],
  candidates: [singleCand, multiCand],
  primary_candidate_id: 'single_no_breakout',
  committed_candidate_id: 'single_no_breakout'
}

describe('projectCommittedCandidate', () => {
  it('re-projects the committed candidate onto the top-level rack_layout', () => {
    const projected = projectCommittedCandidate(baseDesign, 'multi_with_breakout')
    expect(projected.committed_candidate_id).toBe('multi_with_breakout')
    // Top-level rack_layout now mirrors the multi-pod candidate (incl. IPN rack)
    expect(projected.rack_layout.some((r) => r.rack_name === 'IPN')).toBe(true)
    expect(projected.summary.total_spines).toBe(4)
    expect(projected.summary.total_leaves).toBe(111) // sum of leaves_per_pod
    // candidates + tiers are preserved
    expect(projected.candidates).toHaveLength(2)
  })

  it('is a no-op-ish projection for the already-committed single candidate', () => {
    const projected = projectCommittedCandidate(baseDesign)
    expect(projected.committed_candidate_id).toBe('single_no_breakout')
    expect(projected.rack_layout.some((r) => r.rack_name === 'IPN')).toBe(false)
    expect(projected.summary.total_spines).toBe(2)
  })

  it('isCommittedMultiPod reflects the committed candidate', () => {
    expect(isCommittedMultiPod(baseDesign)).toBe(false)
    const projected = projectCommittedCandidate(baseDesign, 'multi_with_breakout')
    expect(isCommittedMultiPod(projected)).toBe(true)
  })

  it('findCandidate returns null for an unknown id', () => {
    expect(findCandidate(baseDesign, 'multi_no_breakout')).toBeNull()
  })
})
