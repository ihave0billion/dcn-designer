import { describe, it, expect } from 'vitest'
import { buildDeviceBom } from './device-bom'
import type { DesignResult, RackDevicePlacement, RackPlacement } from '@domain'
import { DEFAULT_SWITCH_POWER_W } from '@domain'
import type { Switch } from '@/schemas/switches'

function device(over: Partial<RackDevicePlacement> & { device_id: string }): RackDevicePlacement {
  return {
    model_id: 'N9K-C9364D-GX2A',
    role: 'leaf',
    start_u: 44,
    ru: 2,
    label: over.device_id,
    ...over
  }
}

function rack(devices: RackDevicePlacement[], rack_name = 'Rack A'): RackPlacement {
  return {
    rack_name,
    size_u: 44,
    pdu_kw_budget: null,
    estimated_power_w: 0,
    devices,
    over_budget: false
  }
}

function design(racks: RackPlacement[]): DesignResult {
  return {
    schema_version: 1,
    summary: {
      total_leaves: 0,
      total_spines: 0,
      total_servers: 0,
      spines_no_breakout: 0,
      spines_with_breakout: null,
      total_host_bw_g: 0,
      total_uplink_bw_g: 0,
      computed_oversub_ratio: 1,
      computed_oversub_label: '1.00:1',
      valid: true,
      breakout_required_to_be_valid: false
    },
    tiers: [],
    spine: null,
    breakout: null,
    optics_bom: [],
    rack_layout: racks,
    warnings: [],
    candidates: [],
    primary_candidate_id: 'single_no_breakout',
    committed_candidate_id: 'single_no_breakout'
  }
}

const SWITCHES = [
  { id: 'N9K-C9364D-GX2A', ru: 2, power_w: 1500 },
  { id: 'N9K-C93600CD-GX', ru: 1, power_w: 650 }
] as unknown as Switch[]

describe('buildDeviceBom', () => {
  it('rolls devices up by role and model, spines before leaves', () => {
    const bom = buildDeviceBom(
      design([
        rack([
          device({ device_id: 'spine-1', role: 'spine', model_id: 'N9K-C9364D-GX2A' }),
          device({ device_id: 'spine-2', role: 'spine', model_id: 'N9K-C9364D-GX2A' }),
          device({ device_id: 'leaf-1', role: 'leaf', model_id: 'N9K-C93600CD-GX', ru: 1 })
        ])
      ]),
      SWITCHES
    )

    expect(bom.rows.map((r) => [r.role, r.model_id, r.count])).toEqual([
      ['spine', 'N9K-C9364D-GX2A', 2],
      ['leaf', 'N9K-C93600CD-GX', 1]
    ])
    expect(bom.total_devices).toBe(3)
    expect(bom.total_ru).toBe(5) // 2 + 2 + 1
    expect(bom.total_power_w).toBe(3650) // 1500×2 + 650
    expect(bom.has_unknown_models).toBe(false)
    expect(bom.has_estimated_power).toBe(false)
    expect(bom.power_known_devices).toBe(3)
  })

  it('counts devices across racks into one row', () => {
    const bom = buildDeviceBom(
      design([
        rack([device({ device_id: 'leaf-1' })], 'Rack A'),
        rack([device({ device_id: 'leaf-2' })], 'Rack B')
      ]),
      SWITCHES
    )
    expect(bom.rows).toHaveLength(1)
    expect(bom.rows[0].count).toBe(2)
  })

  it('sorts IPN routers between spines and leaves', () => {
    const bom = buildDeviceBom(
      design([
        rack([
          device({ device_id: 'leaf-1', role: 'leaf' }),
          device({ device_id: 'ipn-1', role: 'ipn' }),
          device({ device_id: 'spine-1', role: 'spine' })
        ])
      ]),
      SWITCHES
    )
    expect(bom.rows.map((r) => r.role)).toEqual(['spine', 'ipn', 'leaf'])
  })

  it('still counts a model missing from the library, but flags the power gap', () => {
    const bom = buildDeviceBom(
      design([rack([device({ device_id: 'leaf-1', model_id: 'N9K-MYSTERY' })])]),
      SWITCHES
    )
    expect(bom.rows[0]).toMatchObject({
      model_id: 'N9K-MYSTERY',
      count: 1,
      // Falls back to the solver's own estimate rather than reporting nothing,
      // so the BOM total and the rack-layout total agree.
      power_w_each: DEFAULT_SWITCH_POWER_W,
      unknown_model: true,
      power_estimated: true
    })
    expect(bom.has_unknown_models).toBe(true)
    // RU still comes from the placement, so rack space stays accurate.
    expect(bom.total_ru).toBe(2)
    expect(bom.has_estimated_power).toBe(true)
    expect(bom.power_known_devices).toBe(0)
  })

  it('flags missing power when the library entry has no power_w — the seed case', () => {
    // Every switch in seed/switches.yaml ships power_w: null, so this is the
    // default state of a fresh workspace, not an edge case.
    const noPower = [{ id: 'N9K-C9364D-GX2A', ru: 2, power_w: null }] as unknown as Switch[]
    const bom = buildDeviceBom(
      design([rack([device({ device_id: 'spine-1', role: 'spine' })])]),
      noPower
    )
    expect(bom.rows[0].unknown_model).toBe(false) // the model IS in the library
    expect(bom.rows[0].power_estimated).toBe(true)
    expect(bom.has_estimated_power).toBe(true)
    // Matches what placeRacks would have put in rack.estimated_power_w.
    expect(bom.total_power_w).toBe(DEFAULT_SWITCH_POWER_W)
  })

  it('returns an empty BOM for a design with no rack layout', () => {
    const bom = buildDeviceBom(design([]), SWITCHES)
    expect(bom).toEqual({
      rows: [],
      nd_cluster: null,
      total_devices: 0,
      total_ru: 0,
      total_power_w: 0,
      has_unknown_models: false,
      power_known_devices: 0,
      has_estimated_power: false
    })
  })
})
