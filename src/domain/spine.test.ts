import { describe, expect, it } from 'vitest'
import { computeSpine } from './spine'
import {
  ALL_SWITCHES,
  BREAKOUT_PAIRS,
  N9K_C9364C_H1,
  N9K_C9364D_GX2A
} from './__fixtures__/switches'
import { computeTier } from './tier'
import type { TierRequest } from './types'

function buildTiers(
  rows: Partial<TierRequest>[],
  uplinks_per_leaf: number
) {
  const defaults: TierRequest = {
    speed_tier_label: '25G',
    endpoint_count: null,
    switch_count: null,
    leaf_model_id: 'N9348Y2C6D-SE1U',
    override_uplink_speed_g: 100
  }
  return rows.map((r) => computeTier({ ...defaults, ...r }, uplinks_per_leaf, ALL_SWITCHES).result)
}

describe('computeSpine — three-constraint MAX + HA floor (v8 rule 7)', () => {
  it('HA floor enforces 2 even when math says fewer', () => {
    // 1 leaf, 4 uplinks → 4 total uplinks → fits in 1× 64-port spine, but
    // HA floor must lift the count to 2.
    const tiers = buildTiers([{ switch_count: 1 }], 4)
    const out = computeSpine(tiers, N9K_C9364D_GX2A, 4, 2, BREAKOUT_PAIRS)
    expect(out.spine?.spines_needed).toBe(2)
    expect(out.spine?.spines_capacity).toBeLessThanOrEqual(2)
    expect(out.spine?.spines_port_count).toBe(1)
  })

  it('port-count constraint dominates in the Dashboard default', () => {
    // 50 leaves × 4 uplinks/leaf = 200 leaf uplinks → CEIL(200/64) = 4.
    // BW = 50 leaves * 6 * 100G = 30,000G → much less than 64*400=25,600G.
    //  Wait — actually 30,000 / 25,600 = 1.17 → ceil = 2.
    // Spine-touching = 4/2 = 2.
    // MAX(2, 2, 2, 4) = 4.
    const tiers = buildTiers([{ switch_count: 50 }], 4)
    const out = computeSpine(tiers, N9K_C9364D_GX2A, 4, 2, BREAKOUT_PAIRS)
    expect(out.spine?.total_leaf_uplinks).toBe(200)
    expect(out.spine?.spines_port_count).toBe(4)
    expect(out.spine?.spines_needed).toBe(4)
  })

  it('flags UPLINKS_NOT_DIVISIBLE_BY_PER_SPINE when ratio is non-integer', () => {
    const tiers = buildTiers([{ switch_count: 4 }], 5)
    const out = computeSpine(tiers, N9K_C9364D_GX2A, 5, 2, BREAKOUT_PAIRS)
    expect(out.spine?.spine_touching_divisible).toBe(false)
    expect(out.warnings.some((w) => w.code === 'UPLINKS_NOT_DIVISIBLE_BY_PER_SPINE')).toBe(true)
  })

  it('flags EXTRA_UPLINKS_NEEDED when required > configured uplinks/leaf', () => {
    // Dashboard default: configured 4 uplinks/leaf but math demands 8.
    const tiers = buildTiers([{ switch_count: 50 }], 4)
    const out = computeSpine(tiers, N9K_C9364D_GX2A, 4, 2, BREAKOUT_PAIRS)
    expect(out.spine?.required_uplinks_per_leaf).toBe(8)
    expect(out.warnings.some((w) => w.code === 'EXTRA_UPLINKS_NEEDED')).toBe(true)
  })
})

describe('computeSpine — breakout pass (v8 Dashboard "breakout-valid indicator")', () => {
  it('breakout applicable when leaf_speed × 4 ≤ spine_speed', () => {
    // 100G leaf uplinks × 4 = 400G = spine speed → applicable.
    const tiers = buildTiers([{ switch_count: 50 }], 4)
    const out = computeSpine(tiers, N9K_C9364D_GX2A, 4, 2, BREAKOUT_PAIRS)
    expect(out.breakout?.applicable).toBe(true)
    // Spine count with breakout: port-count term improves 4×.
    // CEIL(200 / (64×4)) = 1 → MAX(2, capacity, touching, 1) = 2.
    expect(out.breakout?.spines_with_breakout).toBe(2)
    expect(out.breakout?.reduces_spine_count).toBe(true)
    expect(out.breakout?.flips_to_valid).toBe(true) // base needed 8 uplinks/leaf, breakout needs 4
  })

  it('breakout not applicable when speeds match', () => {
    // 100G ↔ 100G fabric.
    const tiers = buildTiers(
      [{ leaf_model_id: 'N9K-C9364C-H1', switch_count: 1, override_uplink_speed_g: 100 }],
      64
    )
    const out = computeSpine(tiers, N9K_C9364C_H1, 64, 32, BREAKOUT_PAIRS)
    expect(out.breakout?.applicable).toBe(false)
    expect(out.breakout?.reduces_spine_count).toBe(false)
  })

  it('flags BREAKOUT_PATCH_PANEL_NEEDED when verified pair has connector mismatch', () => {
    const tiers = buildTiers([{ switch_count: 50 }], 4)
    const out = computeSpine(tiers, N9K_C9364D_GX2A, 4, 2, BREAKOUT_PAIRS)
    expect(out.breakout?.patch_panel_needed).toBe(true)
    expect(
      out.warnings.some((w) => w.code === 'BREAKOUT_PATCH_PANEL_NEEDED')
    ).toBe(true)
    expect(
      out.warnings.find((w) => w.code === 'BREAKOUT_PATCH_PANEL_NEEDED')?.message
    ).toMatch(/MPO-12 .UPC. at spine, LC .UPC. at leaf/)
  })
})

describe('computeSpine — no spine selected', () => {
  it('returns null spine with NO_SPINE_MODEL_SELECTED warning', () => {
    const tiers = buildTiers([{ switch_count: 1 }], 4)
    const out = computeSpine(tiers, null, 4, 2, BREAKOUT_PAIRS)
    expect(out.spine).toBeNull()
    expect(out.warnings.some((w) => w.code === 'NO_SPINE_MODEL_SELECTED')).toBe(true)
  })
})
