import { describe, expect, it } from 'vitest'
import { computeTier, pickUplinkGroup } from './tier'
import {
  ALL_SWITCHES,
  N9348Y2C6D_SE1U,
  N9K_C9364C_H1,
  N9K_C9364D_GX2A,
  SYN_SECONDARY_FASTER
} from './__fixtures__/switches'
import type { TierRequest } from './types'

describe('pickUplinkGroup (v8 rule 13 — uplink auto-pick)', () => {
  it('returns null when the switch has no uplink groups', () => {
    expect(pickUplinkGroup(N9K_C9364D_GX2A)).toBeNull()
    expect(pickUplinkGroup(N9K_C9364C_H1)).toBeNull()
  })

  it('picks the only group when only primary is present', () => {
    expect(pickUplinkGroup({ ...N9348Y2C6D_SE1U, secondary_uplink: null })).toEqual({
      choice: 'primary',
      ports: 6,
      speed_g: 400
    })
  })

  it('picks primary when primary has higher per-port speed', () => {
    expect(pickUplinkGroup(N9348Y2C6D_SE1U)).toEqual({
      choice: 'primary',
      ports: 6,
      speed_g: 400
    })
  })

  it('picks secondary when secondary has higher per-port speed', () => {
    expect(pickUplinkGroup(SYN_SECONDARY_FASTER)).toEqual({
      choice: 'secondary',
      ports: 4,
      speed_g: 400
    })
  })
})

describe('computeTier — XOR (v8 rule 8)', () => {
  const fabric_uplinks_per_leaf = 4

  function req(overrides: Partial<TierRequest>): TierRequest {
    return {
      speed_tier_label: '25G',
      endpoint_count: null,
      switch_count: null,
      leaf_model_id: 'N9348Y2C6D-SE1U',
      override_uplink_speed_g: null,
      ...overrides
    }
  }

  it('flags both-set as an error', () => {
    const r = computeTier(req({ endpoint_count: 100, switch_count: 5 }), fabric_uplinks_per_leaf, ALL_SWITCHES)
    expect(r.result.xor_status).toBe('both-set')
    expect(r.warnings.some((w) => w.code === 'XOR_BOTH_SET')).toBe(true)
    expect(r.result.leaves_required).toBe(0)
  })

  it('treats empty rows as no-op (status=empty)', () => {
    const r = computeTier(req({}), fabric_uplinks_per_leaf, ALL_SWITCHES)
    expect(r.result.xor_status).toBe('empty')
    expect(r.result.leaves_required).toBe(0)
    expect(r.warnings).toHaveLength(0)
  })

  it('endpoint_count path: CEIL(endpoints / host_ports)', () => {
    const r = computeTier(req({ endpoint_count: 49 }), fabric_uplinks_per_leaf, ALL_SWITCHES)
    expect(r.result.xor_status).toBe('ok')
    expect(r.result.leaves_required).toBe(2) // CEIL(49/48)
    expect(r.result.endpoints_supported).toBe(96)
  })

  it('switch_count path: endpoints_supported = switch_count × host_ports', () => {
    const r = computeTier(req({ switch_count: 3 }), fabric_uplinks_per_leaf, ALL_SWITCHES)
    expect(r.result.leaves_required).toBe(3)
    expect(r.result.endpoints_supported).toBe(144)
  })
})

describe('computeTier — override uplink speed', () => {
  it('uses MIN(override, rated)', () => {
    const r = computeTier(
      {
        speed_tier_label: '25G',
        endpoint_count: null,
        switch_count: 1,
        leaf_model_id: 'N9348Y2C6D-SE1U',
        override_uplink_speed_g: 100
      },
      6,
      ALL_SWITCHES
    )
    expect(r.result.effective_uplink_speed_g).toBe(100)
    expect(r.result.uplink_bw_g).toBe(6 * 100) // 1 leaf * 6 uplinks * 100G
  })

  it('flags OVERRIDE_EXCEEDS_RATED when override > rated', () => {
    const r = computeTier(
      {
        speed_tier_label: '100G',
        endpoint_count: null,
        switch_count: 1,
        leaf_model_id: 'SYN-SECONDARY-FASTER',
        override_uplink_speed_g: 800
      },
      4,
      ALL_SWITCHES
    )
    expect(r.warnings.some((w) => w.code === 'OVERRIDE_EXCEEDS_RATED')).toBe(true)
    expect(r.result.effective_uplink_speed_g).toBe(400) // clamped to rated
  })
})

describe('computeTier — uplink port limits', () => {
  it('flags UPLINKS_EXCEED_AVAILABLE_PORTS when uplinks/leaf > rated port count', () => {
    const r = computeTier(
      {
        speed_tier_label: '25G',
        endpoint_count: null,
        switch_count: 1,
        leaf_model_id: 'N9348Y2C6D-SE1U',
        override_uplink_speed_g: null
      },
      99,
      ALL_SWITCHES
    )
    expect(r.warnings.some((w) => w.code === 'UPLINKS_EXCEED_AVAILABLE_PORTS')).toBe(true)
  })
})

describe('computeTier — unknown / missing model', () => {
  it('flags UNKNOWN_LEAF_MODEL when leaf_model_id is not in the library', () => {
    const r = computeTier(
      {
        speed_tier_label: '25G',
        endpoint_count: 100,
        switch_count: null,
        leaf_model_id: 'NOT-A-REAL-MODEL',
        override_uplink_speed_g: null
      },
      4,
      ALL_SWITCHES
    )
    expect(r.warnings.some((w) => w.code === 'UNKNOWN_LEAF_MODEL')).toBe(true)
    expect(r.result.xor_status).toBe('unknown-model')
  })

  it('silently skips rows with no model selected', () => {
    const r = computeTier(
      {
        speed_tier_label: '25G',
        endpoint_count: 100,
        switch_count: null,
        leaf_model_id: null,
        override_uplink_speed_g: null
      },
      4,
      ALL_SWITCHES
    )
    expect(r.result.xor_status).toBe('no-model')
    expect(r.warnings).toHaveLength(0)
  })
})
