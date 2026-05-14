import { describe, it, expect } from 'vitest'
import {
  connectorSlug,
  resolvePatchPanel,
  syntheticPatchPanelId,
  syntheticPatchPanel
} from './patch-panel-resolver'
import type { PatchPanel } from '@/schemas/patch-panels'

const PANELS: PatchPanel[] = [
  {
    id: 'PANDUIT-FAP12WBLAQ',
    vendor: 'Panduit',
    description: '12-fiber MPO-12 to 6x LC',
    connector_a: 'MPO-12 (UPC)',
    connector_b: 'LC (UPC)',
    fanout: 6,
    media: 'MMF',
    notes: null,
    data_sheet_url: null
  }
]

describe('connectorSlug', () => {
  it('strips UPC/APC polish info', () => {
    expect(connectorSlug('MPO-12 (UPC)')).toBe('MPO12')
    expect(connectorSlug('LC (UPC)')).toBe('LC')
    expect(connectorSlug('LC (APC)')).toBe('LC')
  })

  it('handles whitespace + dashes', () => {
    expect(connectorSlug('MPO 12')).toBe('MPO12')
    expect(connectorSlug('LC')).toBe('LC')
  })

  it('falls back to UNK for empty input', () => {
    expect(connectorSlug('')).toBe('UNK')
  })
})

describe('syntheticPatchPanelId', () => {
  it('builds a short PP-A-B sku', () => {
    expect(syntheticPatchPanelId('MPO-12 (UPC)', 'LC (UPC)')).toBe('PP-MPO12-LC')
  })

  it('preserves order so spine→leaf is meaningful', () => {
    expect(syntheticPatchPanelId('LC', 'MPO-12')).toBe('PP-LC-MPO12')
  })
})

describe('resolvePatchPanel', () => {
  it('matches a curated entry regardless of connector order', () => {
    const a = resolvePatchPanel(PANELS, 'MPO-12 (UPC)', 'LC (UPC)')
    expect(a.matched).toBe(true)
    expect(a.panel_id).toBe('PANDUIT-FAP12WBLAQ')
    const b = resolvePatchPanel(PANELS, 'LC (UPC)', 'MPO-12 (UPC)')
    expect(b.matched).toBe(true)
    expect(b.panel_id).toBe('PANDUIT-FAP12WBLAQ')
  })

  it('falls back to a synthetic SKU when nothing matches', () => {
    const r = resolvePatchPanel(PANELS, 'MPO-8 (UPC)', 'LC (UPC)')
    expect(r.matched).toBe(false)
    expect(r.panel_id).toBe('PP-MPO8-LC')
    expect(r.panel).toBeUndefined()
  })

  it('returns a synthetic SKU even with empty curated list', () => {
    const r = resolvePatchPanel([], 'MPO-12 (UPC)', 'LC (UPC)')
    expect(r.matched).toBe(false)
    expect(r.panel_id).toBe('PP-MPO12-LC')
  })
})

describe('syntheticPatchPanel', () => {
  it('builds a placeholder PatchPanel record for display', () => {
    const synth = syntheticPatchPanel('MPO-12 (UPC)', 'LC (UPC)')
    expect(synth.id).toBe('PP-MPO12-LC')
    expect(synth.vendor).toBe('(placeholder)')
    expect(synth.connector_a).toBe('MPO-12 (UPC)')
    expect(synth.connector_b).toBe('LC (UPC)')
  })
})
