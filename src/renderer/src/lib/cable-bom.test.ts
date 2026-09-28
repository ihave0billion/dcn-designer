import { describe, it, expect } from 'vitest'
import {
  buildCableBom,
  deriveLinkLength,
  cableMediaLabel,
  roundUpToStandardLength,
  unresolvedLabel,
  INTRA_RACK_RUN_M,
  RACK_RISE_ALLOWANCE_M
} from './cable-bom'
import type { CableLink } from '@/schemas/cable-links'

function link(over: Partial<CableLink> & { id: string }): CableLink {
  return {
    kind: 'uplink',
    device_a: { rack: 'Rack A', device_id: 'spine-1', port: 'Eth1/1' },
    device_b: { rack: 'Rack A', device_id: 'leaf-1', port: 'Eth1/49' },
    speed_g: 400,
    optic_id: null,
    patch_panel_id: null,
    label: '',
    length_m: null,
    notes: null,
    ...over
  }
}

/** Same as `link` but with the endpoints in different racks. */
function crossRack(over: Partial<CableLink> & { id: string }): CableLink {
  return link({
    ...over,
    device_b: {
      rack: 'Rack B',
      device_id: 'leaf-1',
      port: 'Eth1/49',
      ...(over.device_b ?? {})
    }
  })
}

describe('roundUpToStandardLength', () => {
  it('rounds up to the next orderable size', () => {
    expect(roundUpToStandardLength(16)).toBe(20)
    expect(roundUpToStandardLength(4)).toBe(5)
    expect(roundUpToStandardLength(0.5)).toBe(1)
  })

  it('keeps a run that already lands exactly on a standard size', () => {
    expect(roundUpToStandardLength(3)).toBe(3)
    expect(roundUpToStandardLength(30)).toBe(30)
    expect(roundUpToStandardLength(100)).toBe(100)
  })

  it('returns null past the longest standard cable', () => {
    expect(roundUpToStandardLength(101)).toBeNull()
  })
})

describe('deriveLinkLength', () => {
  it('uses the intra-rack run when both endpoints share a rack', () => {
    expect(deriveLinkLength(link({ id: 'l1' }), 10)).toEqual({
      raw_m: INTRA_RACK_RUN_M,
      source: 'derived',
      cross_rack: false
    })
  })

  it('treats two un-racked endpoints as the same rack', () => {
    // A design with no rack inventory is one implied rack — not un-costable.
    const l = link({
      id: 'l1',
      device_a: { rack: null, device_id: 'spine-1', port: 'Eth1/1' },
      device_b: { rack: null, device_id: 'leaf-1', port: 'Eth1/49' }
    })
    expect(deriveLinkLength(l, null)).toEqual({
      raw_m: INTRA_RACK_RUN_M,
      source: 'derived',
      cross_rack: false
    })
  })

  it('adds tray distance plus rise slack at each end across racks', () => {
    expect(deriveLinkLength(crossRack({ id: 'l1' }), 10)).toEqual({
      raw_m: 10 + RACK_RISE_ALLOWANCE_M * 2,
      source: 'derived',
      cross_rack: true
    })
  })

  it('cannot derive a cross-rack run with no tray distance', () => {
    expect(deriveLinkLength(crossRack({ id: 'l1' }), null)).toEqual({
      raw_m: null,
      source: 'unknown',
      cross_rack: true
    })
  })

  it('lets an explicit length win over derivation', () => {
    expect(deriveLinkLength(crossRack({ id: 'l1', length_m: 7 }), 10)).toEqual({
      raw_m: 7,
      source: 'user',
      cross_rack: true
    })
    // …including inside a single rack, where the derived value would be 3 m.
    expect(deriveLinkLength(link({ id: 'l2', length_m: 1 }), null).raw_m).toBe(1)
  })
})

describe('buildCableBom', () => {
  it('groups by ordered length, speed and optic, longest first', () => {
    const bom = buildCableBom({
      cable_tray_m: 10,
      links: [
        link({ id: 'l1' }),
        link({ id: 'l2' }),
        crossRack({ id: 'l3' }),
        crossRack({ id: 'l4' }),
        crossRack({ id: 'l5' })
      ]
    })

    expect(bom.rows).toHaveLength(2)
    // 10 + 3 + 3 = 16 → ordered 20 m, and 20 > 3 so it sorts first.
    expect(bom.rows[0]).toMatchObject({
      ordered_length_m: 20,
      count: 3,
      media: 'mmf',
      total_raw_m: 48,
      total_ordered_m: 60
    })
    expect(bom.rows[1]).toMatchObject({
      ordered_length_m: 3,
      count: 2,
      media: 'mmf',
      total_ordered_m: 6
    })
    expect(bom.total_links).toBe(5)
    expect(bom.costed_links).toBe(5)
    expect(bom.total_ordered_m).toBe(66)
    expect(bom.unresolved).toEqual([])
  })

  it('splits rows that differ only by optic', () => {
    const bom = buildCableBom({
      cable_tray_m: null,
      links: [
        link({ id: 'l1', optic_id: 'QDD-400G-SR4.2' }),
        link({ id: 'l2', optic_id: 'QDD-400G-DR4' }),
        link({ id: 'l3', optic_id: 'QDD-400G-DR4' })
      ]
    })
    expect(bom.rows).toHaveLength(2)
    expect(bom.rows.map((r) => r.optic_id).sort()).toEqual(['QDD-400G-DR4', 'QDD-400G-SR4.2'])
    expect(bom.rows.find((r) => r.optic_id === 'QDD-400G-DR4')?.count).toBe(2)
  })

  it('splits rows that differ only by speed', () => {
    const bom = buildCableBom({
      cable_tray_m: null,
      links: [link({ id: 'l1', speed_g: 400 }), link({ id: 'l2', speed_g: 100 })]
    })
    expect(bom.rows).toHaveLength(2)
    // Same ordered length, so speed breaks the tie — faster first.
    expect(bom.rows.map((r) => r.speed_g)).toEqual([400, 100])
  })

  it('reports cross-rack links it cannot cost, without dropping them silently', () => {
    const bom = buildCableBom({
      cable_tray_m: null,
      links: [link({ id: 'l1' }), crossRack({ id: 'l2' }), crossRack({ id: 'l3' })]
    })
    expect(bom.total_links).toBe(3)
    expect(bom.costed_links).toBe(1)
    // The two uncosted links still get a row (length unknown) — the BOM
    // must account for every cable even before a tray distance is entered.
    expect(bom.rows.map((r) => [r.ordered_length_m, r.count])).toEqual([[null, 2], [3, 1]])
    expect(bom.unresolved).toEqual([
      { reason: 'no_cable_tray_distance', count: 2, max_raw_m: null }
    ])
    expect(unresolvedLabel(bom.unresolved[0])).toContain('Cable Tray')
  })

  it('reports runs longer than the longest standard cable', () => {
    const bom = buildCableBom({
      cable_tray_m: 120,
      links: [crossRack({ id: 'l1' }), crossRack({ id: 'l2' })]
    })
    expect(bom.rows.map((r) => [r.ordered_length_m, r.count, r.total_ordered_m])).toEqual([[null, 2, 0]])
    expect(bom.unresolved).toEqual([
      { reason: 'exceeds_longest_standard_cable', count: 2, max_raw_m: 126 }
    ])
    expect(unresolvedLabel(bom.unresolved[0])).toContain('custom pull')
  })

  it('counts user-specified lengths separately from derived ones', () => {
    const bom = buildCableBom({
      cable_tray_m: 10,
      links: [link({ id: 'l1', length_m: 5 }), link({ id: 'l2' })]
    })
    expect(bom.user_specified_links).toBe(1)
    expect(bom.costed_links).toBe(2)
  })

  it('returns an empty BOM for a design with no links', () => {
    const bom = buildCableBom({ links: [], cable_tray_m: 10 })
    expect(bom).toMatchObject({
      rows: [],
      unresolved: [],
      total_links: 0,
      costed_links: 0,
      total_ordered_m: 0
    })
  })
})

describe('buildCableBom — media (v1.6.1)', () => {
  it('applies multimode fiber by default, regardless of length', () => {
    const bom = buildCableBom({ cable_tray_m: 10, links: [link({ id: 'l1' }), crossRack({ id: 'l2' })] })
    expect(bom.default_media).toBe('mmf')
    expect(bom.rows.map((r) => r.media)).toEqual(['mmf', 'mmf'])
  })

  it('uses the project default media and lets a link override it', () => {
    const bom = buildCableBom({
      cable_tray_m: 10,
      default_media: 'smf',
      links: [link({ id: 'l1' }), link({ id: 'l2', media: 'dac' }), link({ id: 'l3' })]
    })
    expect(bom.rows).toHaveLength(2)
    expect(bom.rows.find((r) => r.media === 'smf')?.count).toBe(2)
    expect(bom.rows.find((r) => r.media === 'dac')?.count).toBe(1)
  })

  it('still lists every cable when none can be costed', () => {
    const bom = buildCableBom({
      cable_tray_m: null,
      links: [
        crossRack({ id: 'l1' }),
        crossRack({ id: 'l2' }),
        crossRack({ id: 'l3', kind: 'vpc-peer-link' })
      ]
    })
    expect(bom.total_links).toBe(3)
    expect(bom.costed_links).toBe(0)
    expect(bom.rows.map((r) => [r.kind, r.count, r.ordered_length_m])).toEqual([
      ['uplink', 2, null],
      ['vpc-peer-link', 1, null]
    ])
    expect(bom.rows.reduce((a, r) => a + r.count, 0)).toBe(3)
    expect(bom.total_ordered_m).toBe(0)
  })

  it('labels every media value', () => {
    expect(cableMediaLabel('mmf')).toBe('MMF fiber (OM4)')
    expect(cableMediaLabel('smf')).toBe('SMF fiber (OS2)')
    expect(cableMediaLabel('dac')).toBe('DAC (copper)')
    expect(cableMediaLabel('aoc')).toBe('AOC')
  })
})
