import { describe, it, expect } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { CHASSIS_W_IN, buildSchematicPanel, inferPortKind, rowsFor, schematicGeometry, speedFill } from './schematic-panel'
import { Diagram } from './vsdx-writer'

const SE1U = {
  modelId: 'N9348Y2C6D-SE1U',
  ru: 1,
  groups: [
    { ports: 48, speedG: 25 },
    { ports: 6, speedG: 400 }
  ]
}

describe('schematicGeometry', () => {
  it('emits one cage per port and keeps them inside the chassis', () => {
    const g = schematicGeometry(SE1U)
    expect(g.ports).toHaveLength(54)
    expect(g.w).toBe(CHASSIS_W_IN)
    expect(g.h).toBe(1.75)
    for (const p of g.ports) {
      expect(p.x0).toBeGreaterThanOrEqual(g.chassis.x0)
      expect(p.x1).toBeLessThanOrEqual(g.chassis.x1)
      expect(p.y0).toBeGreaterThanOrEqual(g.chassis.y0)
      expect(p.y1).toBeLessThanOrEqual(g.chassis.y1)
      expect(p.x1).toBeGreaterThan(p.x0)
      expect(p.y1).toBeGreaterThan(p.y0)
    }
    // cages never sit on the label area or the ears
    for (const p of g.ports) expect(p.x0).toBeGreaterThan(g.labelBox.x1)
    expect(g.ears).toHaveLength(2)
  })

  it('wraps dense SFP groups into two rows and keeps small QSFP rows single', () => {
    expect(rowsFor({ ports: 48, speedG: 25 })).toBe(2)
    expect(rowsFor({ ports: 24, speedG: 10 })).toBe(1)
    expect(rowsFor({ ports: 6, speedG: 400 })).toBe(1)
    expect(rowsFor({ ports: 64, speedG: 400 })).toBe(2)
    const g = schematicGeometry(SE1U)
    const sfp = g.ports.filter((p) => p.group === 0)
    expect(new Set(sfp.map((p) => p.row))).toEqual(new Set([0, 1]))
    expect(sfp.filter((p) => p.row === 0)).toHaveLength(24)
    const qsfp = g.ports.filter((p) => p.group === 1)
    expect(qsfp.every((p) => p.row === 0)).toBe(true)
    expect(qsfp.every((p) => p.kind === 'qsfp')).toBe(true)
  })

  it('shrinks cages to fit when the natural layout is too wide', () => {
    const big = schematicGeometry({ modelId: 'wide', ru: 2, groups: [{ ports: 128, speedG: 400 }] })
    expect(big.scale).toBeLessThan(1)
    for (const p of big.ports) expect(p.x1).toBeLessThanOrEqual(big.chassis.x1)
    // a modest panel fits natively; the dense SE1U-style panel is squeezed a little
    expect(schematicGeometry({ modelId: 'm', ru: 1, groups: [{ ports: 16, speedG: 10 }, { ports: 4, speedG: 100 }] }).scale).toBe(1)
    expect(schematicGeometry(SE1U).scale).toBeGreaterThan(0.8)
  })

  it('infers port kinds and colours by speed band', () => {
    expect(inferPortKind({ ports: 1, speedG: 1 })).toBe('rj45')
    expect(inferPortKind({ ports: 1, speedG: 25 })).toBe('sfp')
    expect(inferPortKind({ ports: 1, speedG: 100 })).toBe('qsfp')
    expect(inferPortKind({ ports: 1, speedG: 100, kind: 'sfp' })).toBe('sfp')
    expect(speedFill(100)).toBe('#0070C0')
    expect(speedFill(400)).toBe('#ED7D31')
    expect(speedFill(25)).toBe('#5B9BD5')
  })

  it('2RU chassis is twice as tall', () => {
    expect(schematicGeometry({ modelId: 'x', ru: 2, groups: [] }).h).toBe(3.5)
    expect(schematicGeometry({ modelId: 'x', ru: 0, groups: [] }).h).toBe(1.75)
  })
})

describe('buildSchematicPanel', () => {
  it('draws one native group with chassis, ears, cages and the model label', () => {
    const d = new Diagram({ title: 't', creator: 'c' })
    const p = d.addPage('p', 204, 132)
    const ref = buildSchematicPanel(d, p, { ...SE1U, x: 100, y: 60 })
    expect(ref.kind).toBe('group')
    expect(ref.x0).toBeCloseTo(90.5)
    expect(ref.x1).toBeCloseTo(109.5)
    expect(ref.y0).toBeCloseTo(60 - 0.875)
    const page = strFromU8(unzipSync(d.save())['visio/pages/page1.xml'])
    expect((page.match(/Type='Group'/g) ?? []).length).toBe(1)
    // 1 chassis + 2 ears + 54 cages + 1 bezel = 58 boxes, no text by default
    expect((page.match(/<Section N='Geometry'/g) ?? []).length).toBe(58)
    expect(page).not.toContain('<Text>')
    const d2 = new Diagram({ title: 't', creator: 'c' })
    const p2 = d2.addPage('p', 204, 132)
    buildSchematicPanel(d2, p2, { ...SE1U, x: 100, y: 60 }, { text: 'SE1U' })
    expect(strFromU8(unzipSync(d2.save())['visio/pages/page1.xml'])).toContain('<Text>SE1U</Text>')
  })
})
