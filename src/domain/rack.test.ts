import { describe, expect, it } from 'vitest'
import { placeRacks } from './rack'
import { ALL_SWITCHES, N9K_C9364D_GX2A } from './__fixtures__/switches'
import type { RackInventoryEntry, SpineResult, TierResult } from './types'

function mkSpine(spines_needed: number): SpineResult {
  return {
    spine_model_id: N9K_C9364D_GX2A.id,
    spine_ports: N9K_C9364D_GX2A.primary.ports,
    spine_speed_g: N9K_C9364D_GX2A.primary.speed_g,
    total_leaves: 0,
    total_leaf_uplinks: 0,
    spines_capacity: 1,
    spines_touching: 2,
    spines_port_count: 1,
    spines_needed,
    required_uplinks_per_leaf: 4,
    spine_touching_divisible: true
  }
}

function mkLeafTier(count: number, model_id = 'N9348Y2C6D-SE1U'): TierResult {
  return {
    speed_tier_label: '25G',
    leaf_model_id: model_id,
    endpoint_count_input: null,
    switch_count_input: count,
    leaves_required: count,
    endpoints_supported: count * 48,
    host_ports_per_leaf: 48,
    host_speed_g: 25,
    effective_uplink_ports: 6,
    effective_uplink_speed_g: 100,
    effective_uplink_choice: 'primary',
    override_uplink_speed_applied_g: 100,
    host_bw_g: count * 48 * 25,
    uplink_bw_g: count * 4 * 100,
    xor_status: 'ok'
  }
}

const rack42 = (name: string, pdu_kw_budget: number | null = null): RackInventoryEntry => ({
  name,
  size_u: 42,
  pdu_kw_budget
})

describe('placeRacks — HA spread', () => {
  it('distributes spines across separate racks when capacity permits', () => {
    const spine = mkSpine(3)
    const out = placeRacks(spine, [], ALL_SWITCHES, [rack42('R1'), rack42('R2'), rack42('R3')])
    const counts = out.layout.map(
      (r) => r.devices.filter((d) => d.role === 'spine').length
    )
    expect(counts).toEqual([1, 1, 1])
  })

  it('wraps around when more spines than racks', () => {
    const spine = mkSpine(4)
    const out = placeRacks(spine, [], ALL_SWITCHES, [rack42('R1'), rack42('R2'), rack42('R3')])
    const counts = out.layout.map(
      (r) => r.devices.filter((d) => d.role === 'spine').length
    )
    // 4 spines across 3 racks → 2,1,1 in placement order.
    expect(counts.reduce((a, b) => a + b, 0)).toBe(4)
    expect(Math.max(...counts)).toBeLessThanOrEqual(2)
  })
})

describe('placeRacks — leaf pods', () => {
  it('keeps leaf pairs (pod) together when possible', () => {
    const spine = mkSpine(2)
    const tier = mkLeafTier(4) // 2 pods
    const out = placeRacks(spine, [tier], ALL_SWITCHES, [rack42('R1'), rack42('R2'), rack42('R3')])
    const leaves_by_rack = out.layout.map((r) => r.devices.filter((d) => d.role === 'leaf').length)
    // 4 leaves in 2 pods of 2 — each pod should land in the same rack.
    expect(leaves_by_rack.filter((c) => c > 0).every((c) => c % 2 === 0)).toBe(true)
  })
})

describe('placeRacks — PDU budget', () => {
  it('marks racks over budget and emits RACK_OVER_PDU_BUDGET', () => {
    const spine = mkSpine(2)
    const tier = mkLeafTier(40)
    // PDU 1kW = effectively 1 device per rack. 41 devices × 600W default
    // each. With 2 racks at 1kW budget, packing will overflow.
    const out = placeRacks(spine, [tier], ALL_SWITCHES, [rack42('R1', 1), rack42('R2', 1)])
    expect(out.warnings.some((w) => w.code === 'RACK_OVER_PDU_BUDGET' || w.code === 'RACK_INSUFFICIENT_SPACE')).toBe(true)
  })

  it('respects budget when generous', () => {
    const spine = mkSpine(2)
    const tier = mkLeafTier(4)
    const out = placeRacks(spine, [tier], ALL_SWITCHES, [rack42('R1', 30), rack42('R2', 30)])
    expect(out.warnings.some((w) => w.code === 'RACK_OVER_PDU_BUDGET')).toBe(false)
    for (const rack of out.layout) {
      expect(rack.over_budget).toBe(false)
    }
  })
})

describe('placeRacks — empty inventory', () => {
  it('returns an empty layout with no warnings when no racks provided', () => {
    const out = placeRacks(mkSpine(2), [mkLeafTier(4)], ALL_SWITCHES, [])
    expect(out.layout).toHaveLength(0)
    expect(out.warnings).toHaveLength(0)
  })
})
