import { describe, it, expect } from 'vitest'
import { BomReport } from './BomReport'
import { bomExportFileName } from './render'
import { DESIGN, GENERATED_AT, LINKS, REQUIREMENTS, SWITCHES, renderDocToBuffer } from './report-fixture'

describe('BomReport', () => {
  it('renders a one-page, structurally valid PDF', async () => {
    const buf = await renderDocToBuffer(
      BomReport({ requirements: REQUIREMENTS, design: DESIGN, links: LINKS, switches: SWITCHES, generatedAt: GENERATED_AT })
    )
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buf.subarray(-1024).toString('latin1')).toContain('%%EOF')
    const pageCount = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
    expect(pageCount).toBe(1)
  }, 30_000)

  it('renders an empty design without throwing', async () => {
    const buf = await renderDocToBuffer(
      BomReport({
        requirements: REQUIREMENTS,
        design: { ...DESIGN, tiers: [], spine: null, breakout: null, optics_bom: [], rack_layout: [], warnings: [], candidates: [] },
        links: [],
        switches: [],
        generatedAt: GENERATED_AT
      })
    )
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  }, 30_000)
})

describe('bomExportFileName', () => {
  it('marks the file as a BOM next to the design report name', () => {
    expect(bomExportFileName('Acme DC Refresh', GENERATED_AT)).toBe('acme-dc-refresh-bom-2026-08-06.pdf')
  })
})
