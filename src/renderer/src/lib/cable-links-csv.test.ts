import { describe, it, expect } from 'vitest'
import {
  parseCableLinksCsv,
  serializeCableLinksCsv
} from './cable-links-csv'
import type { CableLink } from '@/schemas/cable-links'

const validDevices = {
  spineIds: new Set(['spine-1', 'spine-2']),
  leafIds: new Set(['leaf-1', 'leaf-2'])
}

const LINK: CableLink = {
  id: 'link-0001',
  kind: 'uplink',
  device_a: { rack: 'Rack A', device_id: 'spine-1', port: 'Eth1/1' },
  device_b: { rack: 'Rack A', device_id: 'leaf-1', port: 'Eth1/49' },
  speed_g: 400,
  optic_id: 'QDD-400G-SR4.2',
  patch_panel_id: 'PANDUIT-FAP12WBLAQ',
  label: 'spine-1:Eth1/1 ↔ leaf-1:Eth1/49',
  length_m: 5,
  notes: null
}

describe('serializeCableLinksCsv', () => {
  it('writes a header row + escaped rows', () => {
    const text = serializeCableLinksCsv([LINK])
    const lines = text.trim().split('\n')
    expect(lines[0]).toContain('spine_device_id')
    expect(lines[0]).toContain('patch_panel_id')
    expect(lines[1]).toContain('spine-1')
    expect(lines[1]).toContain('QDD-400G-SR4.2')
    // Label has a unicode arrow, no commas — should NOT be quoted
    expect(lines[1]).not.toContain('"spine-1:Eth1/1')
  })

  it('quotes cells containing commas', () => {
    const link = { ...LINK, label: 'left, middle, right', notes: null }
    const text = serializeCableLinksCsv([link])
    const lines = text.trim().split('\n')
    expect(lines[1]).toContain('"left, middle, right"')
  })

  it('doubles internal quotes', () => {
    const link = { ...LINK, label: 'has "quotes" inside', notes: null }
    const text = serializeCableLinksCsv([link])
    const lines = text.trim().split('\n')
    expect(lines[1]).toContain('"has ""quotes"" inside"')
  })
})

describe('parseCableLinksCsv', () => {
  it('round-trips a serialised link', () => {
    const csv = serializeCableLinksCsv([LINK])
    const result = parseCableLinksCsv(csv, validDevices)
    expect(result.links).toHaveLength(1)
    expect(result.links[0]).toMatchObject({
      id: 'link-0001',
      kind: 'uplink',
      device_a: { device_id: 'spine-1', port: 'Eth1/1' },
      device_b: { device_id: 'leaf-1', port: 'Eth1/49' },
      speed_g: 400,
      optic_id: 'QDD-400G-SR4.2',
      patch_panel_id: 'PANDUIT-FAP12WBLAQ',
      length_m: 5
    })
    expect(result.rows_skipped_malformed).toBe(0)
    expect(result.rows_skipped_unknown_device).toBe(0)
  })

  it('skips rows with unknown spine device', () => {
    const csv = [
      'spine_device_id,spine_port,leaf_device_id,leaf_port,speed_g',
      'spine-99,Eth1/1,leaf-1,Eth1/49,400'
    ].join('\n')
    const result = parseCableLinksCsv(csv, validDevices)
    expect(result.links).toHaveLength(0)
    expect(result.rows_skipped_unknown_device).toBe(1)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('skips rows missing required cells', () => {
    const csv = [
      'spine_device_id,spine_port,leaf_device_id,leaf_port,speed_g',
      'spine-1,,leaf-1,Eth1/49,400'
    ].join('\n')
    const result = parseCableLinksCsv(csv, validDevices)
    expect(result.links).toHaveLength(0)
    expect(result.rows_skipped_malformed).toBe(1)
  })

  it('synthesises an id when missing', () => {
    const csv = [
      'spine_device_id,spine_port,leaf_device_id,leaf_port,speed_g',
      'spine-1,Eth1/1,leaf-1,Eth1/49,400'
    ].join('\n')
    const result = parseCableLinksCsv(csv, validDevices, 42)
    expect(result.links).toHaveLength(1)
    expect(result.links[0].id).toBe('link-0042')
  })

  it('flags missing required columns in the warnings', () => {
    const csv = 'id,foo,bar\nlink-1,x,y\n'
    const result = parseCableLinksCsv(csv, validDevices)
    expect(result.links).toHaveLength(0)
    expect(result.warnings.join('\n')).toMatch(/Missing required columns/i)
  })
})
