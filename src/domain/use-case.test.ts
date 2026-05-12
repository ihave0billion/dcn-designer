import { describe, expect, it } from 'vitest'
import {
  candidateLeavesFor,
  candidateSpinesFor,
  checkUseCaseConstraints,
  requiresNonBlocking
} from './use-case'
import { ALL_SWITCHES, N9K_C9364D_GX2A } from './__fixtures__/switches'
import { computeTier } from './tier'
import type { TierRequest, TierResult } from './types'

function mkTier(overrides: Partial<TierRequest>, uplinks_per_leaf: number) {
  const base: TierRequest = {
    speed_tier_label: '25G',
    endpoint_count: null,
    switch_count: null,
    leaf_model_id: 'N9348Y2C6D-SE1U',
    override_uplink_speed_g: 100
  }
  return computeTier({ ...base, ...overrides }, uplinks_per_leaf, ALL_SWITCHES).result
}

function balancedTier(host_bw_g: number, uplink_bw_g: number): TierResult {
  return {
    speed_tier_label: '100G',
    leaf_model_id: 'N9K-C9364D-GX2A',
    endpoint_count_input: null,
    switch_count_input: 1,
    leaves_required: 1,
    endpoints_supported: 64,
    host_ports_per_leaf: 64,
    host_speed_g: 100,
    effective_uplink_ports: 64,
    effective_uplink_speed_g: 100,
    effective_uplink_choice: 'primary',
    override_uplink_speed_applied_g: null,
    host_bw_g,
    uplink_bw_g,
    xor_status: 'ok'
  }
}

describe('requiresNonBlocking', () => {
  it('returns true for ai/hpc', () => {
    expect(requiresNonBlocking('ai')).toBe(true)
    expect(requiresNonBlocking('hpc')).toBe(true)
  })
  it('returns false for dcn/storage', () => {
    expect(requiresNonBlocking('dcn')).toBe(false)
    expect(requiresNonBlocking('storage')).toBe(false)
  })
})

describe('checkUseCaseConstraints — AI/HPC 1:1 (v8 rule 10)', () => {
  it('flags AI_HPC_NOT_1TO1 when host_BW != uplink_BW', () => {
    const tier = mkTier({ switch_count: 50 }, 4)
    const warnings = checkUseCaseConstraints('ai', [tier], ALL_SWITCHES, 'N9K-C9364D-GX2A')
    expect(warnings.some((w) => w.code === 'AI_HPC_NOT_1TO1')).toBe(true)
  })

  it('passes when host_BW == uplink_BW', () => {
    const tier = balancedTier(6400, 6400)
    const warnings = checkUseCaseConstraints('hpc', [tier], ALL_SWITCHES, 'N9K-C9364D-GX2A')
    expect(warnings.some((w) => w.code === 'AI_HPC_NOT_1TO1')).toBe(false)
  })

  it('flags AI_HPC_NO_ROCEV2 when leaf lacks the capability', () => {
    const tier = mkTier(
      { leaf_model_id: 'SYN-LEAF-NO-ROCEV2', switch_count: 1, override_uplink_speed_g: 100 },
      4
    )
    const warnings = checkUseCaseConstraints('ai', [tier], ALL_SWITCHES, null)
    expect(warnings.some((w) => w.code === 'AI_HPC_NO_ROCEV2')).toBe(true)
  })

  it('storage / dcn fabrics skip the 1:1 check', () => {
    const tier = mkTier({ switch_count: 50 }, 4) // oversubscribed
    expect(checkUseCaseConstraints('dcn', [tier], ALL_SWITCHES, 'N9K-C9364D-GX2A')).toHaveLength(0)
    expect(checkUseCaseConstraints('storage', [tier], ALL_SWITCHES, 'N9K-C9364D-GX2A')).toHaveLength(0)
  })
})

describe('candidate filters', () => {
  it('candidateLeavesFor("ai") drops non-RoCEv2 leaves', () => {
    const out = candidateLeavesFor('ai', ALL_SWITCHES)
    expect(out.every((s) => s.capabilities.rocev2)).toBe(true)
    expect(out.find((s) => s.id === 'SYN-LEAF-NO-ROCEV2')).toBeUndefined()
  })

  it('candidateLeavesFor("dcn") keeps non-RoCEv2 leaves', () => {
    const out = candidateLeavesFor('dcn', ALL_SWITCHES)
    expect(out.find((s) => s.id === 'SYN-LEAF-NO-ROCEV2')).toBeDefined()
  })

  it('candidateSpinesFor("hpc") only returns RoCEv2-capable spines', () => {
    const out = candidateSpinesFor('hpc', ALL_SWITCHES)
    expect(out.find((s) => s.id === N9K_C9364D_GX2A.id)).toBeDefined()
    // H1 is rocev2=false in fixtures → drops.
    expect(out.find((s) => s.id === 'N9K-C9364C-H1')).toBeUndefined()
  })
})
