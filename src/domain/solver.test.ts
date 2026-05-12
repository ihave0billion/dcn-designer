import { describe, expect, it } from 'vitest'
import { solve } from './solver'
import {
  ALL_SWITCHES,
  BREAKOUT_PAIRS,
  N9K_C9364C_H1
} from './__fixtures__/switches'
import type { SolverContext, SolverRequirements, SwitchSpec } from './types'

// ────────────────────────────────────────────────────────────────────
// v8 regression fixtures
//
// Anchor scenarios extracted ONCE from DCN_Spine_Leaf_Calculator_v8.xlsx
// (the prior spreadsheet artifact, kept on disk as reference material,
// not in git). The spreadsheet's cached cell values for the Dashboard
// and AI_HPC_NonBlocking tabs at their default inputs are what the
// TypeScript solver here must reproduce.
//
// Extracted: 2026-05-12 via openpyxl(data_only=True).
// ────────────────────────────────────────────────────────────────────

const context: SolverContext = {
  switches: ALL_SWITCHES,
  servers: [],
  breakout_pairs: BREAKOUT_PAIRS
}

describe('v8 Dashboard default (standard / oversubscribed)', () => {
  // Dashboard at first open:
  //   uplinks_per_leaf = 4
  //   uplinks_per_spine = 2
  //   25G tier: switch_count = 50, leaf = N9348Y2C6D-SE1U,
  //             override uplink speed = 100G
  //   Spine: N9K-C9364D-GX2A (64×400G)
  //
  // Expected cached outputs (transcribed from v8 Dashboard):
  //   leaves_required = 50
  //   total_leaf_uplinks = 200
  //   host_bw_g = 60000, uplink_bw_g = 20000
  //   oversub = "3.00:1"
  //   spines_capacity = 1
  //   spines_touching = 2
  //   spines_port_count = 4
  //   spines_needed = 4 (HA min already met)
  //   required uplinks/leaf = 8 → EXTRA UPLINKS NEEDED
  //   FABRIC STATUS = DESIGN HAS ISSUES (uplinks_per_leaf < required)
  //   Breakout 4:1 applicable = YES (100 × 4 ≤ 400)
  //   Spines WITH breakout = 2; required uplinks/leaf with breakout = 4
  //   Design VALID WITH breakout = YES (flips_to_valid)

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

  it('reproduces leaf count + BW totals', () => {
    expect(out.summary.total_leaves).toBe(50)
    expect(out.summary.total_host_bw_g).toBe(60000)
    expect(out.summary.total_uplink_bw_g).toBe(20000)
    expect(out.summary.computed_oversub_label).toBe('3.00:1')
  })

  it('reproduces the three spine constraints', () => {
    expect(out.spine?.total_leaf_uplinks).toBe(200)
    expect(out.spine?.spines_capacity).toBe(1)
    expect(out.spine?.spines_touching).toBe(2)
    expect(out.spine?.spines_port_count).toBe(4)
  })

  it('SPINES NEEDED = 4 (port-count constraint dominates)', () => {
    expect(out.summary.total_spines).toBe(4)
    expect(out.spine?.required_uplinks_per_leaf).toBe(8)
  })

  it('flags EXTRA_UPLINKS_NEEDED and the design is NOT valid without breakout', () => {
    expect(
      out.warnings.some((w) => w.code === 'EXTRA_UPLINKS_NEEDED')
    ).toBe(true)
    // But valid is true here because the only blocker is the extra-uplinks
    // and breakout flips the design to valid (mirrors v8 "VALID with breakout").
    expect(out.summary.valid).toBe(true)
    expect(out.summary.breakout_required_to_be_valid).toBe(true)
  })

  it('breakout pass: applicable, drops spines to 2, flips to valid', () => {
    expect(out.breakout?.applicable).toBe(true)
    expect(out.breakout?.spines_with_breakout).toBe(2)
    expect(out.breakout?.reduces_spine_count).toBe(true)
    expect(out.breakout?.flips_to_valid).toBe(true)
    expect(out.breakout?.uplinks_per_leaf_with_breakout).toBe(4)
  })

  it('breakout: emits S3 optics with a verified pair and patch-panel warning', () => {
    const s3 = out.optics_bom.filter((b) => b.scenario === 'S3')
    expect(s3.length).toBeGreaterThanOrEqual(1)
    expect(out.breakout?.recommended_pair?.spine_pid).toBe('QDD-400G-SR4.2')
    expect(out.breakout?.patch_panel_needed).toBe(true)
    expect(
      out.warnings.some((w) => w.code === 'BREAKOUT_PATCH_PANEL_NEEDED')
    ).toBe(true)
  })
})

describe('v8 AI_HPC_NonBlocking default (1:1)', () => {
  // AI/HPC tab at first open:
  //   uplinks_per_leaf = 64, uplinks_per_spine = 32
  //   100G tier: endpoint_count = 64, leaf = N9K-C9364C-H1,
  //              override = 100G (rated 100G)
  //   Spine: N9K-C9364C-H1 (64×100G)
  //
  // Expected:
  //   leaves_required = 1, host_BW = 6400, uplink_BW = 6400, oversub = 1:1
  //   spines_capacity = 1, spines_touching = 2, spines_port_count = 1
  //   spines_needed = 2 (HA floor)
  //   required uplinks/leaf = 64 (already met)
  //   DESIGN VALID — non-blocking
  //   Breakout NOT applicable (100×4 > 100)
  //
  // N9K-C9364C-H1 has no uplink group in the seed, but v8 uses primary
  // ports as both host and uplink for this 'both'-role switch. We mirror
  // that by patching the H1 fixture for this scenario.

  const H1_with_uplink: SwitchSpec = {
    ...N9K_C9364C_H1,
    role: 'leaf',
    primary: { ports: 64, speed_g: 100 },
    uplink: { ports: 64, speed_g: 100 },
    secondary_uplink: null,
    capabilities: { ...N9K_C9364C_H1.capabilities, rocev2: true }
  }

  const H1_as_spine: SwitchSpec = {
    ...N9K_C9364C_H1,
    role: 'spine',
    primary: { ports: 64, speed_g: 100 },
    capabilities: { ...N9K_C9364C_H1.capabilities, rocev2: true }
  }

  const ai_context: SolverContext = {
    switches: [
      ...ALL_SWITCHES.filter((s) => s.id !== 'N9K-C9364C-H1'),
      H1_with_uplink,
      { ...H1_as_spine, id: 'N9K-C9364C-H1-SPINE' }
    ],
    servers: [],
    breakout_pairs: BREAKOUT_PAIRS
  }

  const requirements: SolverRequirements = {
    fabric: {
      uplinks_per_leaf: 64,
      uplinks_per_spine: 32,
      spine_model_id: 'N9K-C9364C-H1-SPINE',
      use_case: 'ai',
      input_mode: 'aggregate'
    },
    tiers: [
      {
        speed_tier_label: '100G',
        endpoint_count: 64,
        switch_count: null,
        leaf_model_id: 'N9K-C9364C-H1',
        override_uplink_speed_g: 100
      }
    ]
  }

  const out = solve(requirements, ai_context)

  it('reproduces the 1:1 leaf math', () => {
    expect(out.summary.total_leaves).toBe(1)
    expect(out.summary.total_host_bw_g).toBe(6400)
    expect(out.summary.total_uplink_bw_g).toBe(6400)
    expect(out.summary.computed_oversub_label).toBe('1.00:1')
  })

  it('SPINES NEEDED = 2 (HA floor)', () => {
    expect(out.summary.total_spines).toBe(2)
    expect(out.spine?.spines_capacity).toBe(1)
    expect(out.spine?.spines_touching).toBe(2)
    expect(out.spine?.spines_port_count).toBe(1)
    expect(out.spine?.required_uplinks_per_leaf).toBe(64)
  })

  it('design is valid and non-blocking (no AI_HPC_NOT_1TO1 warnings)', () => {
    expect(out.summary.valid).toBe(true)
    expect(out.summary.breakout_required_to_be_valid).toBe(false)
    expect(
      out.warnings.some((w) => w.code === 'AI_HPC_NOT_1TO1')
    ).toBe(false)
  })

  it('breakout NOT applicable (leaf speed == spine speed)', () => {
    expect(out.breakout?.applicable).toBe(false)
  })
})
