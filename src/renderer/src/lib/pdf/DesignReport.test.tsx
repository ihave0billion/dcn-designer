import { describe, it, expect } from 'vitest'
import { DesignReport, type DesignReportInput } from './DesignReport'
import { exportFileName } from './render'
import { DESIGN, GENERATED_AT, INPUT, renderDocToBuffer } from './report-fixture'

// End-to-end smoke test for the PDF pipeline. Rendering real bytes is the only
// honest check that the document is *valid* — a JSX-shape assertion would pass
// happily on a react-pdf primitive that throws at layout time (an unsupported
// style, a Text outside a View, an Svg child that isn't an Svg element).

const renderToBuffer = (input: DesignReportInput): Promise<Buffer> => renderDocToBuffer(DesignReport(input))

describe('DesignReport', () => {
  it('renders a structurally valid PDF', async () => {
    const buf = await renderToBuffer(INPUT)

    // A PDF must open with %PDF- and close with the EOF marker; a truncated or
    // half-rendered document fails one of these.
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buf.subarray(-1024).toString('latin1')).toContain('%%EOF')
    expect(buf.byteLength).toBeGreaterThan(3000)
  }, 30_000)

  it('emits all six pages', async () => {
    const buf = await renderToBuffer(INPUT)
    const text = buf.toString('latin1')
    const pageCount = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length
    expect(pageCount).toBe(6)
  }, 30_000)

  it('renders an empty design without throwing', async () => {
    // The Export button is reachable before Generate Design has ever run, so
    // every section has to survive a design with nothing in it.
    const empty: DesignReportInput = {
      ...INPUT,
      design: {
        ...DESIGN,
        tiers: [],
        spine: null,
        breakout: null,
        optics_bom: [],
        rack_layout: [],
        warnings: [],
        candidates: []
      },
      links: [],
      topology: { nodes: [], edges: [], orphanDeviceIds: [] }
    }
    const buf = await renderToBuffer(empty)
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  }, 30_000)

  it('renders a large multi-pod fabric without throwing', async () => {
    const leaves = Array.from({ length: 111 }, (_, i) => ({
      id: `leaf-${i + 1}`,
      role: 'leaf' as const,
      model_id: 'N9K-C93600CD-GX',
      rack: `Rack ${i % 4}`,
      label: `leaf-${i + 1}`,
      ru: 1,
      power_w: 650,
      pod_index: i % 2,
      usedPorts: []
    }))
    const spines = Array.from({ length: 8 }, (_, i) => ({
      id: `spine-${i + 1}`,
      role: 'spine' as const,
      model_id: 'N9K-C9364D-GX2A',
      rack: 'Rack A',
      label: `spine-${i + 1}`,
      ru: 2,
      power_w: 1500,
      pod_index: i % 2,
      usedPorts: []
    }))
    const big: DesignReportInput = {
      ...INPUT,
      topology: {
        nodes: [
          { id: 'ipn-1', role: 'ipn', model_id: 'N9K-C9332D-GX2B', rack: 'Rack A', label: 'ipn-1', ru: 1, power_w: 900, pod_index: null, usedPorts: [] },
          ...spines,
          ...leaves
        ],
        edges: [],
        orphanDeviceIds: []
      }
    }
    const buf = await renderToBuffer(big)
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  }, 30_000)
})

describe('exportFileName', () => {
  it('slugifies the project name and stamps the date', () => {
    expect(exportFileName('Acme DC Refresh', GENERATED_AT)).toBe('acme-dc-refresh-2026-08-06.pdf')
  })

  it('collapses punctuation and trims stray separators', () => {
    expect(exportFileName('  Acme // DC (v2)!  ', GENERATED_AT)).toBe('acme-dc-v2-2026-08-06.pdf')
  })

  it('falls back to a generic name when nothing survives slugification', () => {
    expect(exportFileName('!!!', GENERATED_AT)).toBe('design-2026-08-06.pdf')
  })
})
