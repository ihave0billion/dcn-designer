import { describe, expect, it } from 'vitest'
import { solve } from './solver'
import {
  buildCandidates,
  distributeEvenly,
  IPN_HA_MIN,
  IPN_PORTS_PER_SPINE_PER_IPN,
  IPN_RACK_NAME,
  pickPrimaryCandidate
} from './multipod'
import {
  ALL_IPN_ROUTERS,
  ALL_SWITCHES,
  BREAKOUT_PAIRS,
  N9K_C9332D_GX2B_IPN
} from './__fixtures__/switches'
import { computeTier } from './tier'
import type {
  DesignCandidate,
  SolverContext,
  SolverRequirements,
  TierResult
} from './types'

// ────────────────────────────────────────────────────────────────────
// Phase 2b — Multi-Pod ACI 4-way candidate matrix
//
// Acceptance scenario from PROJECT_PLAN.md (2026-05-18 interview):
//
//   111 leaves over GX2A spines (64× 400G) with the v8 Dashboard
//   defaults — uplinks_per_leaf=4, uplinks_per_spine=2, leaf
//   N9348Y2C6D-SE1U with 100G uplinks. Single-pod 2 spines is
//   insufficient (port-count constraint demands more). Multi-Pod
//   becomes a viable option; with breakout it lands at 4 spines /
//   2 pods / 2 IPN routers / 56+55 leaf split.
//
// The solver computes all four candidates in parallel and auto-
// promotes the simplest valid one (fewer pods first, then no-breakout
// if tied). The acceptance verdicts here check that the matrix is
// populated, validity per candidate is correct, and the
// MultiPodAnalysis details match the plan example.
// ────────────────────────────────────────────────────────────────────

const context: SolverContext = {
  switches: ALL_SWITCHES,
  servers: [],
  breakout_pairs: BREAKOUT_PAIRS,
  ipn_routers: ALL_IPN_ROUTERS
}

function getCandidate(
  candidates: DesignCandidate[],
  id: DesignCandidate['id']
): DesignCandidate {
  const c = candidates.find((x) => x.id === id)
  if (!c) throw new Error(`Candidate ${id} not found in matrix`)
  return c
}

describe('distributeEvenly', () => {
  it('111 leaves over 2 pods → 56 + 55', () => {
    expect(distributeEvenly(111, 2)).toEqual([56, 55])
  })
  it('100 leaves over 4 pods → 25 each', () => {
    expect(distributeEvenly(100, 4)).toEqual([25, 25, 25, 25])
  })
  it('total < pods still distributes (1 leaf, 2 pods → [1, 0])', () => {
    expect(distributeEvenly(1, 2)).toEqual([1, 0])
  })
})

describe('111-leaf Multi-Pod acceptance scenario', () => {
  const requirements: SolverRequirements = {
    fabric: {
      uplinks_per_leaf: 4,
      uplinks_per_spine: 2,
      spine_model_id: 'N9K-C9364D-GX2A',
      use_case: 'dcn',
      input_mode: 'aggregate',
      ipn_router_model_id: 'N9K-C9332D-GX2B'
    },
    tiers: [
      {
        speed_tier_label: '25G',
        endpoint_count: null,
        switch_count: 111,
        leaf_model_id: 'N9348Y2C6D-SE1U',
        override_uplink_speed_g: 100
      }
    ]
  }

  const out = solve(requirements, context)
  const candidates = out.candidates

  it('exposes the full 4-candidate matrix', () => {
    expect(candidates).toHaveLength(4)
    expect(candidates.map((c) => c.id).sort()).toEqual([
      'multi_no_breakout',
      'multi_with_breakout',
      'single_no_breakout',
      'single_with_breakout'
    ])
  })

  it('single_no_breakout is INVALID (port-count constraint)', () => {
    const c = getCandidate(candidates, 'single_no_breakout')
    expect(c.valid).toBe(false)
    // 111 leaves × 4 uplinks / 64 ports = 7 spines required; user has
    // only configured uplinks_per_leaf=4, so EXTRA_UPLINKS_NEEDED fires.
    expect(c.warnings.some((w) => w.code === 'EXTRA_UPLINKS_NEEDED')).toBe(true)
    expect(c.spine?.spines_port_count).toBe(7)
  })

  it('single_with_breakout is VALID (breakout drops to 2 spines)', () => {
    const c = getCandidate(candidates, 'single_with_breakout')
    expect(c.valid).toBe(true)
    expect(c.total_spines).toBe(2) // HA floor after breakout fanout
    expect(c.multipod).toBeNull()
  })

  it('multi_no_breakout is VALID with a 4-pod split (HA-floor per pod, IPN fits exactly)', () => {
    // 111 leaves / max_per_pod_no_breakout(28) = ceil 4 pods.
    // Per pod: 28 leaves × 4 uplinks / 56 effective ports = 2 spines
    // (HA floor exactly met). 4 pods × 2 spines = 8 total spines;
    // IPN port budget = 8 × 4 = 32, fits the 32-port GX2B exactly.
    const c = getCandidate(candidates, 'multi_no_breakout')
    expect(c.valid).toBe(true)
    expect(c.multipod?.pods_needed).toBe(4)
    expect(c.multipod?.leaves_per_pod).toEqual([28, 28, 28, 27])
    expect(c.multipod?.spines_per_pod).toBe(2)
    expect(c.total_spines).toBe(8)
    // 8 spines × 4 ports/IPN = 32 — fills the 32-port IPN exactly,
    // so IPN_PORTS_INSUFFICIENT does NOT fire.
    expect(c.warnings.some((w) => w.code === 'IPN_PORTS_INSUFFICIENT')).toBe(false)
  })

  it('multi_with_breakout is VALID with 4 spines / 2 pods / 2 IPNs / 56+55 split', () => {
    const c = getCandidate(candidates, 'multi_with_breakout')
    expect(c.valid).toBe(true)
    expect(c.multipod).not.toBeNull()
    expect(c.multipod?.pods_needed).toBe(2)
    expect(c.multipod?.leaves_per_pod).toEqual([56, 55])
    expect(c.multipod?.spines_per_pod).toBe(2) // HA floor per pod
    expect(c.total_spines).toBe(4) // 2 × 2 pods
    expect(c.multipod?.ipn_routers_needed).toBe(IPN_HA_MIN)
    expect(c.total_ipn_routers).toBe(2)
    expect(c.multipod?.ipn_router_model_id).toBe('N9K-C9332D-GX2B')
    expect(c.multipod?.ports_per_spine_per_ipn).toBe(IPN_PORTS_PER_SPINE_PER_IPN)
    // Effective spine ports = 64 - (2 × 4) = 56
    expect(c.multipod?.effective_spine_ports).toBe(56)
    // Spine→IPN cable count = 4 spines × 2 IPNs × 4 ports = 32
    expect(c.multipod?.spine_to_ipn_links).toBe(32)
  })

  it('primary is single_with_breakout (fewer pods wins the tiebreak)', () => {
    expect(out.primary_candidate_id).toBe('single_with_breakout')
    expect(out.committed_candidate_id).toBe('single_with_breakout')
  })

  it('each invalid candidate carries a specific blocker warning', () => {
    for (const c of candidates) {
      if (c.valid) continue
      // Every invalid candidate must surface at least one error-severity warning
      const errors = c.warnings.filter((w) => w.severity === 'error')
      expect(errors.length).toBeGreaterThan(0)
    }
  })

  // Regression (2026-06-03 GUI verification): with NO rack inventory the
  // multi-pod candidate must still expose its full device set in
  // rack_layout — every spine, every leaf, both IPN routers, pod-tagged —
  // so the Topology graph and cable-links seeder render the committed
  // candidate instead of falling back to a flat 2-spine fabric. (These
  // requirements carry no `racks`, so placeRacks returns []; the candidate
  // synthesizes a logical layout.)
  it('multi_no_breakout populates rack_layout from synthesized devices (no inventory)', () => {
    const c = getCandidate(candidates, 'multi_no_breakout')
    const allDevices = c.rack_layout.flatMap((r) => r.devices)
    const spines = allDevices.filter((d) => d.role === 'spine')
    const leaves = allDevices.filter((d) => d.role === 'leaf')
    const ipns = allDevices.filter((d) => d.role === 'ipn')

    expect(spines).toHaveLength(8) // total_spines, not spines_per_pod (2)
    expect(leaves).toHaveLength(111)
    expect(ipns).toHaveLength(2)

    // A dedicated IPN rack is appended.
    expect(c.rack_layout.some((r) => r.rack_name === IPN_RACK_NAME)).toBe(true)

    // Spines are pod-tagged by spines_per_pod (2): spine-1/2→pod0 … spine-7/8→pod3.
    const spineById = new Map(spines.map((d) => [d.device_id, d.pod_index]))
    expect(spineById.get('spine-1')).toBe(0)
    expect(spineById.get('spine-8')).toBe(3)
    // Leaves are pod-tagged by the leaves_per_pod split [28,28,28,27].
    const leafById = new Map(leaves.map((d) => [d.device_id, d.pod_index]))
    expect(leafById.get('leaf-1')).toBe(0)
    expect(leafById.get('leaf-29')).toBe(1)
    expect(leafById.get('leaf-111')).toBe(3)
    // IPN routers are shared across pods → pod_index null.
    expect(ipns.every((d) => d.pod_index == null)).toBe(true)
  })
})

describe('Phase 2 regression — single-pod-valid fixtures still produce identical primary', () => {
  // Mirrors v8 Dashboard default from solver.test.ts. With Phase 2b
  // the top-level DesignResult should keep returning the canonical
  // single-pod view, AND the primary candidate id should be the
  // simplest valid (here: single_with_breakout, since the default
  // setup is invalid without breakout but flips with it).

  const requirements: SolverRequirements = {
    fabric: {
      uplinks_per_leaf: 4,
      uplinks_per_spine: 2,
      spine_model_id: 'N9K-C9364D-GX2A',
      use_case: 'dcn',
      input_mode: 'aggregate'
    },
    tiers: [
      {
        speed_tier_label: '25G',
        endpoint_count: null,
        switch_count: 50,
        leaf_model_id: 'N9348Y2C6D-SE1U',
        override_uplink_speed_g: 100
      }
    ]
  }

  const out = solve(requirements, context)

  it('top-level summary still reflects single-pod-no-breakout (Phase 2 contract)', () => {
    expect(out.summary.total_spines).toBe(4) // single-pod-no-breakout count
    expect(out.spine?.spines_needed).toBe(4)
    expect(out.spine?.required_uplinks_per_leaf).toBe(8)
    expect(out.warnings.some((w) => w.code === 'EXTRA_UPLINKS_NEEDED')).toBe(true)
  })

  it('primary candidate is single_with_breakout (simplest valid)', () => {
    expect(out.primary_candidate_id).toBe('single_with_breakout')
  })

  it('matrix is populated even when the design fits single-pod', () => {
    expect(out.candidates).toHaveLength(4)
    const single_no = getCandidate(out.candidates, 'single_no_breakout')
    expect(single_no.spine?.spines_needed).toBe(4)
    const single_yes = getCandidate(out.candidates, 'single_with_breakout')
    expect(single_yes.valid).toBe(true)
    expect(single_yes.total_spines).toBe(2)
  })
})

describe('aci_multipod_allowed gate (license block)', () => {
  // When the user explicitly sets aci_multipod_allowed=false, the two
  // multi-pod candidates carry MULTIPOD_LICENSE_BLOCKED and become
  // invalid. The primary falls back to whichever single-pod is valid.

  const requirements: SolverRequirements = {
    fabric: {
      uplinks_per_leaf: 4,
      uplinks_per_spine: 2,
      spine_model_id: 'N9K-C9364D-GX2A',
      use_case: 'dcn',
      input_mode: 'aggregate',
      aci_multipod_allowed: false,
      ipn_router_model_id: 'N9K-C9332D-GX2B'
    },
    tiers: [
      {
        speed_tier_label: '25G',
        endpoint_count: null,
        switch_count: 111,
        leaf_model_id: 'N9348Y2C6D-SE1U',
        override_uplink_speed_g: 100
      }
    ]
  }

  const out = solve(requirements, context)

  it('multi-pod candidates carry MULTIPOD_LICENSE_BLOCKED and are invalid', () => {
    const multi_yes = getCandidate(out.candidates, 'multi_with_breakout')
    expect(multi_yes.valid).toBe(false)
    expect(multi_yes.warnings.some((w) => w.code === 'MULTIPOD_LICENSE_BLOCKED')).toBe(true)
    const multi_no = getCandidate(out.candidates, 'multi_no_breakout')
    expect(multi_no.warnings.some((w) => w.code === 'MULTIPOD_LICENSE_BLOCKED')).toBe(true)
  })

  it('primary falls back to single_with_breakout', () => {
    expect(out.primary_candidate_id).toBe('single_with_breakout')
  })
})

describe('IPN_MODEL_NOT_SELECTED warning when no IPN routers in library', () => {
  const requirements: SolverRequirements = {
    fabric: {
      uplinks_per_leaf: 4,
      uplinks_per_spine: 2,
      spine_model_id: 'N9K-C9364D-GX2A',
      use_case: 'dcn',
      input_mode: 'aggregate'
    },
    tiers: [
      {
        speed_tier_label: '25G',
        endpoint_count: null,
        switch_count: 111,
        leaf_model_id: 'N9348Y2C6D-SE1U',
        override_uplink_speed_g: 100
      }
    ]
  }

  it('multi-pod candidates flag IPN_MODEL_NOT_SELECTED when ipn_routers is empty', () => {
    const out = solve(requirements, { ...context, ipn_routers: [] })
    const multi_yes = getCandidate(out.candidates, 'multi_with_breakout')
    expect(multi_yes.warnings.some((w) => w.code === 'IPN_MODEL_NOT_SELECTED')).toBe(true)
    expect(multi_yes.valid).toBe(false)
  })
})

describe('pickPrimaryCandidate ordering', () => {
  // Helper: build a fake DesignCandidate skeleton just for ordering
  // tests — only `id` and `valid` matter here.
  function skel(id: DesignCandidate['id'], valid: boolean): DesignCandidate {
    return {
      id,
      pod_variant: id.startsWith('single') ? 'single' : 'multi',
      breakout_variant: id.endsWith('with_breakout') ? 'with_breakout' : 'no_breakout',
      valid,
      spine: null,
      breakout: null,
      multipod: null,
      rack_layout: [],
      optics_bom: [],
      warnings: [],
      total_spines: 0,
      total_ipn_routers: 0,
      total_host_bw_g: 0,
      total_uplink_bw_g: 0,
      computed_oversub_ratio: 0,
      computed_oversub_label: '—'
    }
  }

  it('picks single_no_breakout when all four are valid', () => {
    expect(
      pickPrimaryCandidate([
        skel('single_no_breakout', true),
        skel('single_with_breakout', true),
        skel('multi_no_breakout', true),
        skel('multi_with_breakout', true)
      ])
    ).toBe('single_no_breakout')
  })

  it('falls back to single_with_breakout when single-no-breakout fails', () => {
    expect(
      pickPrimaryCandidate([
        skel('single_no_breakout', false),
        skel('single_with_breakout', true),
        skel('multi_with_breakout', true),
        skel('multi_no_breakout', true)
      ])
    ).toBe('single_with_breakout')
  })

  it('picks multi_no_breakout when both single candidates fail', () => {
    expect(
      pickPrimaryCandidate([
        skel('single_no_breakout', false),
        skel('single_with_breakout', false),
        skel('multi_no_breakout', true),
        skel('multi_with_breakout', true)
      ])
    ).toBe('multi_no_breakout')
  })

  it('falls back to single_no_breakout when nothing is valid', () => {
    expect(
      pickPrimaryCandidate([
        skel('single_no_breakout', false),
        skel('single_with_breakout', false),
        skel('multi_no_breakout', false),
        skel('multi_with_breakout', false)
      ])
    ).toBe('single_no_breakout')
  })
})

describe('buildCandidates direct invocation (no full solve)', () => {
  // Sanity test for the candidate builder itself — useful when wiring
  // the Phase 9b UI which may want to recompute the matrix on
  // commit-candidate changes without re-running the whole solver.
  it('returns a 4-candidate matrix and a primary id', () => {
    const fabric = {
      uplinks_per_leaf: 4,
      uplinks_per_spine: 2,
      spine_model_id: 'N9K-C9364D-GX2A',
      use_case: 'dcn' as const,
      input_mode: 'aggregate' as const
    }
    const tiers: TierResult[] = [
      computeTier(
        {
          speed_tier_label: '25G',
          endpoint_count: null,
          switch_count: 50,
          leaf_model_id: 'N9348Y2C6D-SE1U',
          override_uplink_speed_g: 100
        },
        fabric.uplinks_per_leaf,
        ALL_SWITCHES
      ).result
    ]
    const out = buildCandidates({
      tiers,
      spine_switch: ALL_SWITCHES.find((s) => s.id === 'N9K-C9364D-GX2A') ?? null,
      ipn_router: N9K_C9332D_GX2B_IPN,
      fabric,
      breakout_pairs: BREAKOUT_PAIRS,
      switches: ALL_SWITCHES,
      rack_inventory: []
    })
    expect(out.candidates).toHaveLength(4)
    expect(out.primary_candidate_id).toBe('single_with_breakout')
  })
})

describe('Phase 10 — input-level blocking errors invalidate every candidate', () => {
  // Regression: a broken tier (e.g. a leaf with no uplink ports in the
  // library) produced a top-level summary.valid=false but an all-valid
  // candidate matrix — and the committed-candidate projection then
  // overwrote the truthful verdict, so Summary/Design showed "valid"
  // right next to an error-severity warning.
  const requirements: SolverRequirements = {
    fabric: {
      uplinks_per_leaf: 4,
      uplinks_per_spine: 2,
      spine_model_id: 'N9K-C9364D-GX2A',
      use_case: 'dcn',
      input_mode: 'aggregate'
    },
    tiers: [
      {
        speed_tier_label: '100G',
        endpoint_count: 400,
        switch_count: null,
        leaf_model_id: 'no-such-leaf',
        override_uplink_speed_g: null
      }
    ]
  }

  const out = solve(requirements, context)

  it('marks all four candidates invalid and carries the blocking error', () => {
    expect(out.warnings.some((w) => w.code === 'UNKNOWN_LEAF_MODEL')).toBe(true)
    expect(out.summary.valid).toBe(false)
    for (const c of out.candidates) {
      expect(c.valid).toBe(false)
      expect(c.warnings.some((w) => w.code === 'UNKNOWN_LEAF_MODEL')).toBe(true)
    }
  })

  it('keeps the committed candidate verdict consistent with the top-level summary', () => {
    const committed = getCandidate(out.candidates, out.committed_candidate_id)
    expect(committed.valid).toBe(out.summary.valid)
  })
})

describe('Phase 9b — IPN rack placement + ACI pod tagging', () => {
  // Same 111-leaf fixture but with rack inventory so the multi-pod
  // candidates produce a placed rack_layout (IPN rack + pod_index).
  const requirements: SolverRequirements = {
    fabric: {
      uplinks_per_leaf: 4,
      uplinks_per_spine: 2,
      spine_model_id: 'N9K-C9364D-GX2A',
      use_case: 'dcn',
      input_mode: 'aggregate',
      ipn_router_model_id: 'N9K-C9332D-GX2B'
    },
    tiers: [
      {
        speed_tier_label: '25G',
        endpoint_count: null,
        switch_count: 111,
        leaf_model_id: 'N9348Y2C6D-SE1U',
        override_uplink_speed_g: 100
      }
    ],
    // Generous so all 115 devices place without RACK_INSUFFICIENT_SPACE.
    racks: [
      { name: 'Rack A', size_u: 100, pdu_kw_budget: null },
      { name: 'Rack B', size_u: 100, pdu_kw_budget: null },
      { name: 'Rack C', size_u: 100, pdu_kw_budget: null }
    ]
  }

  const out = solve(requirements, context)

  it('multi_with_breakout appends a dedicated IPN rack with 2 routers', () => {
    const c = getCandidate(out.candidates, 'multi_with_breakout')
    const ipnRack = c.rack_layout.find((r) => r.rack_name === 'IPN')
    expect(ipnRack).toBeDefined()
    expect(ipnRack!.devices).toHaveLength(2)
    expect(ipnRack!.devices.every((d) => d.role === 'ipn')).toBe(true)
    expect(ipnRack!.devices.every((d) => d.pod_index == null)).toBe(true)
    expect(ipnRack!.devices.map((d) => d.device_id)).toEqual(['ipn-1', 'ipn-2'])
    expect(ipnRack!.devices.every((d) => d.model_id === 'N9K-C9332D-GX2B')).toBe(true)
  })

  it('multi_with_breakout tags spines + leaves with their ACI pod_index (56+55 split)', () => {
    const c = getCandidate(out.candidates, 'multi_with_breakout')
    const placed = c.rack_layout
      .filter((r) => r.rack_name !== 'IPN')
      .flatMap((r) => r.devices)
    const spines = placed.filter((d) => d.role === 'spine')
    const leaves = placed.filter((d) => d.role === 'leaf')
    expect(spines).toHaveLength(4)
    expect(leaves).toHaveLength(111)
    expect(spines.every((d) => d.pod_index === 0 || d.pod_index === 1)).toBe(true)
    const pod0 = leaves.filter((d) => d.pod_index === 0).length
    const pod1 = leaves.filter((d) => d.pod_index === 1).length
    expect([pod0, pod1].sort((a, b) => b - a)).toEqual([56, 55])
  })

  it('single-pod candidate has no IPN rack and null pod_index', () => {
    const c = getCandidate(out.candidates, 'single_with_breakout')
    expect(c.rack_layout.some((r) => r.rack_name === 'IPN')).toBe(false)
    const devices = c.rack_layout.flatMap((r) => r.devices)
    expect(devices.length).toBeGreaterThan(0)
    expect(devices.every((d) => d.pod_index == null)).toBe(true)
  })

  it('does not place spines/leaves into a pre-existing IPN rack (re-generate path)', () => {
    // Mirrors the state after committing multi-pod once: requirements
    // now carries a solver-managed "IPN" rack. A second Generate must
    // not put fabric devices there nor append a duplicate IPN rack.
    const withIpnRack: SolverRequirements = {
      ...requirements,
      racks: [...(requirements.racks ?? []), { name: 'IPN', size_u: 44, pdu_kw_budget: null }]
    }
    const out2 = solve(withIpnRack, context)
    const c = getCandidate(out2.candidates, 'multi_with_breakout')
    const ipnRacks = c.rack_layout.filter((r) => r.rack_name === 'IPN')
    expect(ipnRacks).toHaveLength(1)
    expect(ipnRacks[0].devices.every((d) => d.role === 'ipn')).toBe(true)
  })
})
