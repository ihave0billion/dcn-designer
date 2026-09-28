import { describe, it, expect } from 'vitest'
import { endpointTotals } from './endpoint-totals'
import type { TierResult } from '@domain'

function tier(over: Partial<TierResult>): TierResult {
  return {
    speed_tier_label: '100G',
    leaf_model_id: 'N9K-C93600CD-GX',
    endpoint_count_input: null,
    switch_count_input: null,
    leaves_required: 0,
    endpoints_supported: 0,
    host_ports_per_leaf: 32,
    host_speed_g: 100,
    effective_uplink_ports: 4,
    effective_uplink_speed_g: 400,
    effective_uplink_choice: 'primary',
    override_uplink_speed_applied_g: null,
    host_bw_g: 0,
    uplink_bw_g: 0,
    xor_status: 'ok',
    ...over
  }
}

describe('endpointTotals', () => {
  it('sums supported ports across tiers and the requested counts of endpoint-mode tiers', () => {
    const totals = endpointTotals({
      tiers: [
        tier({ endpoint_count_input: 100, leaves_required: 4, endpoints_supported: 128 }),
        tier({
          speed_tier_label: '25G',
          leaf_model_id: 'N9K-C93180YC-FX3',
          host_ports_per_leaf: 48,
          host_speed_g: 25,
          switch_count_input: 2,
          leaves_required: 2,
          endpoints_supported: 96
        })
      ]
    })
    expect(totals).toEqual({ supported: 224, requested: 100, spare: 124 })
  })

  it('ignores tiers the solver could not solve', () => {
    const totals = endpointTotals({
      tiers: [
        tier({ endpoint_count_input: 40, leaves_required: 2, endpoints_supported: 64 }),
        tier({ xor_status: 'empty' }),
        tier({ xor_status: 'both-set', endpoint_count_input: 10, switch_count_input: 1 }),
        tier({ xor_status: 'no-model', endpoint_count_input: 999 })
      ]
    })
    expect(totals).toEqual({ supported: 64, requested: 40, spare: 24 })
  })

  it('reports zero spare when the request exactly fills the leaves', () => {
    const totals = endpointTotals({
      tiers: [tier({ endpoint_count_input: 128, leaves_required: 4, endpoints_supported: 128 })]
    })
    expect(totals).toEqual({ supported: 128, requested: 128, spare: 0 })
  })

  it('returns zeros for a design with no tiers', () => {
    expect(endpointTotals({ tiers: [] })).toEqual({ supported: 0, requested: 0, spare: 0 })
  })
})
