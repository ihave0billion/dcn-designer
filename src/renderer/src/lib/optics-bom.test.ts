import { describe, it, expect } from 'vitest'
import { buildOpticsBom, opticHintForSpeed, opticSideLabel, physicalPort } from './optics-bom'
import type { CableLink } from '@/schemas/cable-links'
import type { DesignResult } from '@domain'
import type { Switch } from '@/schemas/switches'

const DESIGN: Pick<DesignResult, 'rack_layout' | 'spine' | 'breakout'> = {
  rack_layout: [
    {
      rack_name: 'R1',
      size_u: 44,
      pdu_kw_budget: null,
      estimated_power_w: 0,
      over_budget: false,
      devices: [
        { device_id: 'spine-1', model_id: 'N9K-C9364D-GX2A', role: 'spine', start_u: 44, ru: 1, label: '', pod_index: null },
        { device_id: 'leaf-1', model_id: 'N9348Y2C6D-SE1U', role: 'leaf', start_u: 43, ru: 1, label: '', pod_index: null },
        { device_id: 'leaf-2', model_id: 'N9348Y2C6D-SE1U', role: 'leaf', start_u: 42, ru: 1, label: '', pod_index: null }
      ]
    }
  ],
  spine: {
    spine_model_id: 'N9K-C9364D-GX2A',
    spine_ports: 64,
    spine_speed_g: 400,
    total_leaves: 2,
    total_leaf_uplinks: 4,
    spines_capacity: 1,
    spines_touching: 1,
    spines_port_count: 1,
    spines_needed: 1,
    required_uplinks_per_leaf: 2,
    spine_touching_divisible: true
  },
  breakout: null
}

const SWITCHES = [
  { id: 'N9K-C9364D-GX2A', optic_hint: 'QSFP-DD', primary: { speed_g: 400 }, uplink: null, secondary_uplink: null },
  {
    id: 'N9348Y2C6D-SE1U',
    optic_hint: 'SFP28 (primary) / QSFP-DD (uplink) / QSFP28 (secondary uplink)',
    primary: { speed_g: 25 },
    uplink: { speed_g: 400 },
    secondary_uplink: { speed_g: 100 }
  }
] as unknown as Switch[]

function link(id: string, a: [string, string], b: [string, string], over: Partial<CableLink> = {}): CableLink {
  return {
    id,
    kind: 'uplink',
    device_a: { rack: 'R1', device_id: a[0], port: a[1] },
    device_b: { rack: 'R1', device_id: b[0], port: b[1] },
    speed_g: 400,
    optic_id: null,
    patch_panel_id: null,
    label: '',
    length_m: null,
    notes: null,
    ...over
  }
}

describe('buildOpticsBom', () => {
  it('counts one transceiver per fiber end, split by side and model', () => {
    const bom = buildOpticsBom({
      links: [link('l1', ['spine-1', 'Eth1/1'], ['leaf-1', 'Eth1/53']), link('l2', ['spine-1', 'Eth1/2'], ['leaf-2', 'Eth1/53'])],
      design: DESIGN,
      switches: SWITCHES
    })
    expect(bom.total_transceivers).toBe(4)
    expect(bom.by_side).toEqual({ spine: 2, leaf: 2, peer_link: 0, other: 0 })
    expect(bom.ends_without_pid).toBe(4)
    expect(bom.rows.map((r) => [r.side, r.model_id, r.count, r.optic_id, r.optic_hint])).toEqual([
      ['spine', 'N9K-C9364D-GX2A', 2, null, 'QSFP-DD'],
      ['leaf', 'N9348Y2C6D-SE1U', 2, null, 'QSFP-DD']
    ])
  })

  it('does not order transceivers for DAC or AOC ends', () => {
    const bom = buildOpticsBom({
      links: [link('l1', ['spine-1', 'Eth1/1'], ['leaf-1', 'Eth1/53'], { media: 'dac' }), link('l2', ['spine-1', 'Eth1/2'], ['leaf-2', 'Eth1/53'])],
      design: DESIGN,
      default_media: 'aoc'
    })
    expect(bom.rows).toEqual([])
    expect(bom.integrated_ends).toBe(4)
    expect(bom.total_ends).toBe(4)
    expect(bom.total_transceivers).toBe(0)
  })

  it('collapses breakout sub-ports on the spine to one optic with the breakout spine PID', () => {
    const design = {
      ...DESIGN,
      breakout: {
        applicable: true,
        fanout: 4,
        spines_with_breakout: 1,
        uplinks_per_leaf_with_breakout: 1,
        reduces_spine_count: true,
        flips_to_valid: false,
        recommended_pair: { spine_pid: 'QDD-4X100G-SR4-S', leaf_pid: 'QSFP-100G-SR4-S' } as never,
        patch_panel_needed: true
      }
    }
    const links = [1, 2, 3, 4].map((n) =>
      link(`l${n}`, ['spine-1', `Eth1/1/${n}`], [n <= 2 ? 'leaf-1' : 'leaf-2', `Eth1/${52 + n}`], { speed_g: 100, optic_id: 'QSFP-100G-SR4-S' })
    )
    const bom = buildOpticsBom({ links, design })
    expect(bom.by_side.spine).toBe(1)
    expect(bom.by_side.leaf).toBe(4)
    const spineRow = bom.rows.find((r) => r.side === 'spine')
    expect(spineRow).toMatchObject({ optic_id: 'QDD-4X100G-SR4-S', speed_g: 400, count: 1 })
    expect(bom.rows.find((r) => r.side === 'leaf')).toMatchObject({ optic_id: 'QSFP-100G-SR4-S', speed_g: 100, count: 4 })
    expect(bom.ends_without_pid).toBe(0)
  })

  it('lists peer-link ends as leaf (peer-link) and honours a per-link PID', () => {
    const bom = buildOpticsBom({
      links: [
        link('p1', ['leaf-1', 'Eth1/49'], ['leaf-2', 'Eth1/49'], { kind: 'vpc-peer-link', optic_id: 'QDD-400G-SR4.2-BD' }),
        link('p2', ['leaf-1', 'Eth1/50'], ['leaf-2', 'Eth1/50'], { kind: 'vpc-peer-link', optic_id: 'QDD-400G-SR4.2-BD' })
      ],
      design: DESIGN
    })
    expect(bom.by_side.peer_link).toBe(4)
    expect(bom.rows).toHaveLength(1)
    expect(bom.rows[0]).toMatchObject({ kind: 'vpc-peer-link', side: 'leaf', count: 4, optic_id: 'QDD-400G-SR4.2-BD' })
    expect(opticSideLabel(bom.rows[0])).toBe('Leaf (peer-link)')
    expect(bom.ends_without_pid).toBe(0)
  })

  it('falls back to the device-id prefix when a device is not in the rack layout', () => {
    const bom = buildOpticsBom({
      links: [link('l1', ['spine-9', 'Eth1/1'], ['leaf-9', 'Eth1/53'])],
      design: { ...DESIGN, rack_layout: [] }
    })
    expect(bom.rows.map((r) => [r.side, r.model_id])).toEqual([
      ['spine', null],
      ['leaf', null]
    ])
  })
})

describe('opticHintForSpeed', () => {
  it('picks the port group whose speed matches the end', () => {
    const se1u = SWITCHES[1]
    expect(opticHintForSpeed(se1u, 400)).toBe('QSFP-DD')
    expect(opticHintForSpeed(se1u, 100)).toBe('QSFP28')
    expect(opticHintForSpeed(se1u, 25)).toBe('SFP28')
    expect(opticHintForSpeed(se1u, 10)).toBe(se1u.optic_hint)
    expect(opticHintForSpeed(SWITCHES[0], 400)).toBe('QSFP-DD')
    expect(opticHintForSpeed(undefined, 400)).toBeNull()
  })
})

describe('physicalPort', () => {
  it('strips a numeric breakout sub-port and leaves ordinary ports alone', () => {
    expect(physicalPort('Eth1/1/3')).toEqual({ base: 'Eth1/1', isSubPort: true })
    expect(physicalPort('Eth1/53')).toEqual({ base: 'Eth1/53', isSubPort: false })
    expect(physicalPort('Ethernet1/1')).toEqual({ base: 'Ethernet1/1', isSubPort: false })
  })
})
