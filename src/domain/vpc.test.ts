import { describe, expect, it } from 'vitest'
import { effectiveVpcSettings, pairLeaves, pairLeavesFromTiers, peerLinkGroupFor, uplinkBudgetAfterPeerLink } from './vpc'
import { solve } from './solver'
import { ALL_SWITCHES, N9348Y2C6D_SE1U, N9K_C9364D_GX2A } from './__fixtures__/switches'
import type { RackPlacement, TierResult } from './types'

describe('effectiveVpcSettings', () => {
  it('defaults to EVPN with a 2-member peer-link in a port-channel', () => {
    expect(effectiveVpcSettings({})).toEqual({ mode: 'nxos-evpn', peer_link: true, port_channel: true, members: 2 })
  })
  it('classic forces the peer-link and port-channel on', () => {
    expect(effectiveVpcSettings({ mode: 'nxos-classic', peer_link_enabled: false, peer_link_port_channel: false, peer_link_members: 3 })).toEqual({
      mode: 'nxos-classic',
      peer_link: true,
      port_channel: true,
      members: 3
    })
  })
  it('ACI has neither', () => {
    expect(effectiveVpcSettings({ mode: 'aci', peer_link_members: 4 })).toEqual({ mode: 'aci', peer_link: false, port_channel: false, members: 0 })
  })
  it('EVPN honours the checkboxes and clamps members to 1–4', () => {
    expect(effectiveVpcSettings({ mode: 'nxos-evpn', peer_link_enabled: false })).toMatchObject({ peer_link: false, port_channel: false, members: 0 })
    expect(effectiveVpcSettings({ mode: 'nxos-evpn', peer_link_port_channel: false, peer_link_members: 9 })).toMatchObject({ peer_link: true, port_channel: false, members: 4 })
    expect(effectiveVpcSettings({ mode: 'nxos-evpn', peer_link_members: 0 })).toMatchObject({ members: 1 })
  })
})

const TIER_SE1U = { leaf_model_id: N9348Y2C6D_SE1U.id, endpoint_count: 96, switch_count: null }

// 9348GC-FX3: 48×1G hosts, 2×100G uplinks, 4×25G secondary uplinks — the
// peer-link cannot come out of the 100G group without starving the spines.
const FX3 = {
  id: '9348GC-FX3',
  role: 'leaf' as const,
  primary: { ports: 48, speed_g: 1 },
  uplink: { ports: 2, speed_g: 100 },
  secondary_uplink: { ports: 4, speed_g: 25 },
  ru: 1,
  power_w: null,
  capabilities: { rocev2: false, nxos: true }
}

describe('peerLinkGroupFor', () => {
  it('SE1U: the 400G uplink group has room → peer-link shares it', () => {
    expect(peerLinkGroupFor(N9348Y2C6D_SE1U, 2, 4)).toEqual({ group: 'uplink', ports: 6, speed_g: 400, shares_uplink_group: true })
  })
  it('FX3: 2×100G cannot carry 2 uplinks + a 2-port peer-link → the 4×25G group carries the peer-link', () => {
    expect(peerLinkGroupFor(FX3, 2, 2)).toEqual({ group: 'secondary_uplink', ports: 4, speed_g: 25, shares_uplink_group: false })
    // with a single spine uplink the 100G group has room again
    expect(peerLinkGroupFor(FX3, 1, 1).group).toBe('uplink')
  })
  it('falls back to the uplink group (and a reduction) when no group has room', () => {
    expect(peerLinkGroupFor({ ...FX3, secondary_uplink: { ports: 1, speed_g: 25 } }, 2, 2)).toMatchObject({ group: 'uplink', shares_uplink_group: true })
  })
  it('a smart switch never falls back to its 100G secondaries — uplinks get reduced instead', () => {
    expect(peerLinkGroupFor(N9348Y2C6D_SE1U, 2, 6)).toMatchObject({ group: 'uplink', speed_g: 400, shares_uplink_group: true })
    expect(peerLinkGroupFor({ ...N9348Y2C6D_SE1U, capabilities: { rocev2: true } }, 2, 6)).toMatchObject({ group: 'secondary_uplink' })
  })
  it('honours the library group', () => {
    expect(peerLinkGroupFor({ ...N9348Y2C6D_SE1U, peer_link_group: 'secondary_uplink' }, 2, 4)).toMatchObject({ group: 'secondary_uplink', speed_g: 100, shares_uplink_group: false })
  })
})

describe('uplinkBudgetAfterPeerLink', () => {
  it('FX3 next to SE1U: no reduction, the FX3 note says the spine uplinks are untouched', () => {
    const b = uplinkBudgetAfterPeerLink(
      { uplinks_per_leaf: 2, uplinks_per_spine: 1 },
      2,
      [TIER_SE1U, { leaf_model_id: FX3.id, endpoint_count: null, switch_count: 2 }],
      [...ALL_SWITCHES, FX3]
    )
    expect(b.effective).toBe(2)
    expect(b.warnings.map((w) => w.code)).toEqual(['VPC_PEER_LINK_RESERVED'])
    expect(b.warnings[0].message).toContain('9348GC-FX3: 2 of 4 secondary uplink ports (25G), spine uplinks untouched')
  })

  it('no reservation → nothing changes, no warnings', () => {
    const b = uplinkBudgetAfterPeerLink({ uplinks_per_leaf: 4, uplinks_per_spine: 2 }, 0, [TIER_SE1U], ALL_SWITCHES)
    expect(b).toEqual({ configured: 4, effective: 4, reserved: 0, warnings: [] })
  })
  it('SE1U: 6×400G minus 2 peer-link ports still carries 4 uplinks — info only', () => {
    const b = uplinkBudgetAfterPeerLink({ uplinks_per_leaf: 4, uplinks_per_spine: 2 }, 2, [TIER_SE1U], ALL_SWITCHES)
    expect(b.effective).toBe(4)
    expect(b.warnings.map((w) => w.code)).toEqual(['VPC_PEER_LINK_RESERVED'])
    expect(b.warnings[0].message).toContain('2 of 6 uplink ports (400G)')
  })
  it('reduces uplinks to the largest multiple of uplinks/spine that fits and warns', () => {
    const b = uplinkBudgetAfterPeerLink({ uplinks_per_leaf: 6, uplinks_per_spine: 2 }, 2, [TIER_SE1U], ALL_SWITCHES)
    expect(b.effective).toBe(4)
    expect(b.warnings.map((w) => w.code)).toEqual(['VPC_PEER_LINK_RESERVED', 'VPC_UPLINKS_REDUCED'])
    expect(b.warnings[1].severity).toBe('warn')
    // 4 members on a 6-port group leaves 2 → exactly one spine touch
    expect(uplinkBudgetAfterPeerLink({ uplinks_per_leaf: 4, uplinks_per_spine: 2 }, 4, [TIER_SE1U], ALL_SWITCHES).effective).toBe(2)
  })
  it('never drops below uplinks/spine', () => {
    const b = uplinkBudgetAfterPeerLink({ uplinks_per_leaf: 4, uplinks_per_spine: 4 }, 4, [TIER_SE1U], ALL_SWITCHES)
    expect(b.effective).toBe(4)
  })
  it('ignores empty rows and unknown models', () => {
    const b = uplinkBudgetAfterPeerLink(
      { uplinks_per_leaf: 4, uplinks_per_spine: 2 },
      2,
      [
        { leaf_model_id: N9348Y2C6D_SE1U.id, endpoint_count: null, switch_count: null },
        { leaf_model_id: 'NOPE', endpoint_count: 10, switch_count: null }
      ],
      ALL_SWITCHES
    )
    expect(b.effective).toBe(4)
    expect(b.warnings).toEqual([])
  })
})

function layoutOf(devices: Array<{ id: string; model: string; pod?: number | null }>): RackPlacement[] {
  return [
    {
      rack_name: 'R1',
      size_u: 44,
      pdu_kw_budget: null,
      estimated_power_w: 0,
      over_budget: false,
      devices: devices.map((d) => ({ device_id: d.id, model_id: d.model, role: 'leaf' as const, start_u: 1, ru: 1, label: '', pod_index: d.pod ?? null }))
    }
  ]
}

describe('pairLeaves', () => {
  it('pairs consecutive leaves and flags the odd one out', () => {
    const r = pairLeaves(layoutOf([{ id: 'leaf-1', model: 'A' }, { id: 'leaf-2', model: 'A' }, { id: 'leaf-3', model: 'A' }]))
    expect(r.pairs).toEqual([{ id: 'pair-1', members: ['leaf-1', 'leaf-2'] }])
    expect(r.unpaired).toEqual(['leaf-3'])
    expect(r.warnings.map((w) => w.code)).toEqual(['VPC_ODD_LEAF'])
  })
  it('never pairs across models or ACI pods, and sorts leaf-10 after leaf-2', () => {
    const r = pairLeaves(
      layoutOf([
        { id: 'leaf-10', model: 'A' },
        { id: 'leaf-1', model: 'A' },
        { id: 'leaf-2', model: 'A' },
        { id: 'leaf-3', model: 'B' },
        { id: 'leaf-4', model: 'B', pod: 1 },
        { id: 'leaf-5', model: 'B', pod: 1 }
      ])
    )
    expect(r.pairs).toEqual([
      { id: 'pair-1', members: ['leaf-1', 'leaf-2'] },
      { id: 'pair-2', members: ['leaf-4', 'leaf-5'] }
    ])
    expect(r.unpaired).toEqual(['leaf-10', 'leaf-3'])
  })
  it('pairLeavesFromTiers mirrors the leaf-N numbering across tiers', () => {
    const tier = (model: string, n: number): TierResult =>
      ({ leaf_model_id: model, leaves_required: n, xor_status: 'ok' }) as unknown as TierResult
    const r = pairLeavesFromTiers([tier('A', 3), tier('B', 2)])
    expect(r.pairs).toEqual([
      { id: 'pair-1', members: ['leaf-1', 'leaf-2'] },
      { id: 'pair-2', members: ['leaf-4', 'leaf-5'] }
    ])
    expect(r.unpaired).toEqual(['leaf-3'])
  })
})

describe('solve — vPC', () => {
  const base = {
    fabric: {
      uplinks_per_leaf: 4,
      uplinks_per_spine: 2,
      spine_model_id: N9K_C9364D_GX2A.id,
      use_case: 'dcn' as const,
      input_mode: 'aggregate' as const
    },
    tiers: [{ speed_tier_label: '25G', endpoint_count: 96, switch_count: null, leaf_model_id: N9348Y2C6D_SE1U.id, override_uplink_speed_g: null }]
  }
  const ctx = { switches: ALL_SWITCHES, breakout_pairs: [] }

  it('publishes the vpc summary with pairs even without a rack inventory', () => {
    const d = solve(base, ctx)
    expect(d.vpc).toMatchObject({ mode: 'nxos-evpn', peer_link: true, port_channel: true, members: 2, configured_uplinks_per_leaf: 4, effective_uplinks_per_leaf: 4 })
    expect(d.vpc?.pairs).toEqual([{ id: 'pair-1', members: ['leaf-1', 'leaf-2'] }])
    expect(d.vpc?.unpaired).toEqual([])
    expect(d.warnings.map((w) => w.code)).toContain('VPC_PEER_LINK_RESERVED')
  })
  it('reduces the uplinks and re-runs the spine math on the reduced count', () => {
    const d = solve({ ...base, fabric: { ...base.fabric, uplinks_per_leaf: 6, peer_link_members: 2 } }, ctx)
    expect(d.vpc?.effective_uplinks_per_leaf).toBe(4)
    expect(d.tiers[0].uplink_bw_g).toBe(2 * 4 * 400)
    expect(d.spine?.total_leaf_uplinks).toBe(8)
    expect(d.warnings.map((w) => w.code)).toContain('VPC_UPLINKS_REDUCED')
    expect(d.summary.valid).toBe(true)
  })
  it('ACI mode reserves nothing and has no peer-link', () => {
    const d = solve({ ...base, fabric: { ...base.fabric, mode: 'aci', uplinks_per_leaf: 6 } }, ctx)
    expect(d.vpc).toMatchObject({ mode: 'aci', peer_link: false, members: 0, effective_uplinks_per_leaf: 6 })
    expect(d.warnings.some((w) => w.code.startsWith('VPC_'))).toBe(false)
    expect(d.vpc?.pairs.length).toBe(1)
  })
  it('flags the odd leaf on the design', () => {
    const d = solve({ ...base, tiers: [{ ...base.tiers[0], endpoint_count: null, switch_count: 3 }] }, ctx)
    expect(d.vpc?.unpaired).toEqual(['leaf-3'])
    expect(d.warnings.map((w) => w.code)).toContain('VPC_ODD_LEAF')
  })
})
