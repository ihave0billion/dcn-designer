import { describe, it, expect } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import {
  Diagram,
  esc,
  imagePixelSize,
  masterNaturalSize,
  num,
  parseShapeTree,
  pointTouchesRect,
  rectsOverlap
} from './vsdx-writer'
import { BOX_MASTER, EMF_MASTER, PNG_1X1, PNG_4X2_HEADER } from './__fixtures__/masters'

function unzip(bytes: Uint8Array): Record<string, string | Uint8Array> {
  const out: Record<string, string | Uint8Array> = {}
  for (const [name, data] of Object.entries(unzipSync(bytes))) {
    out[name] = name.endsWith('.emf') || name.endsWith('.png') || name.endsWith('.jpg') ? data : strFromU8(data)
  }
  return out
}

function cell(xml: string, shapeId: number, name: string): string | undefined {
  const re = new RegExp(`<Shape ID='${shapeId}'[^>]*>([\\s\\S]*?)</Shape>`)
  const body = re.exec(xml)?.[1] ?? ''
  return new RegExp(`<Cell N='${name}' V='([^']*)'`).exec(body)?.[1]
}

describe('helpers', () => {
  it('num never prints exponents or trailing zeros', () => {
    expect(num(1)).toBe('1')
    expect(num(0.5)).toBe('0.5')
    expect(num(1e-9)).toBe('0')
    expect(num(-2.25)).toBe('-2.25')
    expect(num(19 / 3)).toBe('6.333333')
  })

  it('esc escapes XML specials and apostrophes', () => {
    expect(esc(`a<b>&'c'`)).toBe('a&lt;b&gt;&amp;&apos;c&apos;')
  })

  it('imagePixelSize reads PNG headers', () => {
    expect(imagePixelSize(PNG_1X1)).toEqual({ w: 1, h: 1 })
    expect(imagePixelSize(PNG_4X2_HEADER)).toEqual({ w: 4, h: 2 })
    expect(() => imagePixelSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toThrow()
  })

  it('parseShapeTree keeps the nested master skeleton', () => {
    const tree = parseShapeTree(EMF_MASTER.masterXml)
    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('5')
    expect(tree[0].type).toBe('Group')
    expect(tree[0].children.map((c) => c.id)).toEqual(['6', '7'])
    expect(tree[0].children[1].children[0].id).toBe('8')
  })

  it('masterNaturalSize reads the top shape cells', () => {
    expect(masterNaturalSize(EMF_MASTER.masterXml)).toEqual({ w: 19, h: 2 })
  })

  it('rect helpers', () => {
    const r = { x0: 0, y0: 0, x1: 10, y1: 2 }
    expect(pointTouchesRect(10, 1, r)).toBe(true)
    expect(pointTouchesRect(5, 1, r)).toBe(false) // inside, not on an edge
    expect(pointTouchesRect(12, 1, r)).toBe(false)
    expect(rectsOverlap(r, { x0: 9, y0: 1, x1: 12, y1: 3 })).toBe(true)
    expect(rectsOverlap(r, { x0: 10, y0: 0, x1: 12, y1: 3 })).toBe(false) // touching edges do not overlap
  })
})

describe('Diagram package', () => {
  function build(): { diag: Diagram; parts: Record<string, string | Uint8Array> } {
    const diag = new Diagram({ title: "Smoke & 'test'", creator: 'vitest' })
    const page = diag.addPage('Topology', 204, 132)
    diag.registerMaster(BOX_MASTER)
    diag.registerMaster(EMF_MASTER)
    diag.registerMaster(BOX_MASTER) // second registration is a no-op
    diag.drop(page, BOX_MASTER.name, 50, 100, { label: 'leaf-1', labelSize: 8, labelPos: 'below' })
    diag.drop(page, EMF_MASTER.name, 150, 100, { label: 'spine-1', labelPos: 'above' })
    diag.line(page, 50, 99.15, 150, 99, { color: '#0070C0', weight: 0.014, label: '4 × 100G' })
    diag.box(page, 100, 20, 40, 10, { text: 'Legend', align: 'left' })
    diag.ellipse(page, 100, 99.075, 3, 1.5, { color: '#B85450', weight: 0.012, angle: 0.25 })
    diag.image(page, { bytes: PNG_1X1, kind: 'png' }, 100, 60, { w: 19, label: 'photo' })
    diag.image(page, { bytes: PNG_1X1, kind: 'png' }, 120, 60, { w: 10 }) // same bytes → same media part
    diag.addPage('Second', 204, 132)
    const bytes = diag.save(new Date('2026-09-26T00:00:00Z'))
    return { diag, parts: unzip(bytes) }
  }

  it('writes every OPC part with rels and content types', () => {
    const { parts } = build()
    const names = Object.keys(parts).sort()
    expect(names).toEqual(
      [
        '[Content_Types].xml',
        '_rels/.rels',
        'docProps/app.xml',
        'docProps/core.xml',
        'visio/_rels/document.xml.rels',
        'visio/document.xml',
        'visio/masters/_rels/master2.xml.rels',
        'visio/masters/_rels/masters.xml.rels',
        'visio/masters/master1.xml',
        'visio/masters/master2.xml',
        'visio/masters/masters.xml',
        'visio/media/img_1.png',
        'visio/media/m2_image1.emf',
        'visio/pages/_rels/page1.xml.rels',
        'visio/pages/_rels/pages.xml.rels',
        'visio/pages/page1.xml',
        'visio/pages/page2.xml',
        'visio/pages/pages.xml',
        'visio/windows.xml'
      ].sort()
    )
    const ct = parts['[Content_Types].xml'] as string
    expect((ct.match(/<Override /g) ?? []).length).toBe(6 + 2 + 2)
    expect(ct).toContain('Extension="emf"')
    expect(parts['_rels/.rels']).toContain('docProps/core.xml')
    expect(parts['visio/_rels/document.xml.rels']).toContain('windows.xml')
    expect(parts['docProps/core.xml']).toContain('<dc:title>Smoke &amp; &apos;test&apos;</dc:title>')
    expect(parts['docProps/app.xml']).toContain('<vt:i4>2</vt:i4>')
    expect(parts['visio/document.xml']).toContain("<StyleSheet ID='3'")
  })

  it('pages carry U=IN scale cells and page rels', () => {
    const { parts } = build()
    const pages = parts['visio/pages/pages.xml'] as string
    expect(pages).toContain("<Cell N='PageScale' V='1' U='IN'/>")
    expect(pages).toContain("<Cell N='DrawingScale' V='12' U='IN'/>")
    expect(pages).toContain("<Page ID='0' NameU='Topology' Name='Topology'>")
    expect(pages).toContain("<Page ID='1' NameU='Second' Name='Second'>")
    expect(parts['visio/pages/_rels/pages.xml.rels']).toContain('Target="page2.xml"')
    expect(parts['visio/pages/page2.xml']).toContain('<Shapes></Shapes>')
  })

  it('never emits an empty <Text/> and throws on empty text()', () => {
    const { parts } = build()
    const page = parts['visio/pages/page1.xml'] as string
    expect(page).not.toContain('<Text/>')
    expect(page).not.toContain('<Text></Text>')
    const d = new Diagram({ title: 't', creator: 'c' })
    const p = d.addPage('p', 10, 10)
    expect(() => d.text(p, 1, 1, 1, 1, '')).toThrow()
  })

  it('registers masters with re-assigned IDs, rels and prefixed media', () => {
    const { diag, parts } = build()
    const masters = parts['visio/masters/masters.xml'] as string
    expect(masters).toMatch(/<Master [^>]*ID='1001'[^>]*NameU="Test Box Front"/)
    expect(masters).toMatch(/<Master [^>]*ID='1002'[^>]*NameU="Test EMF Front"/)
    expect(masters).not.toContain('ID="497"')
    expect(masters).toContain('<Rel r:id="rId1" />')
    expect(masters).toContain('<Rel r:id="rId2" />')
    expect(masters).not.toContain('rId9')
    expect(parts['visio/masters/_rels/masters.xml.rels']).toContain('Target="master2.xml"')
    expect(parts['visio/masters/_rels/master2.xml.rels']).toContain('Target="../media/m2_image1.emf"')
    expect(parts['visio/masters/master2.xml']).toBe(EMF_MASTER.masterXml)
    expect(diag.masterSize(EMF_MASTER.name)).toEqual({ w: 19, h: 2 })
    expect(diag.hasMaster('nope')).toBe(false)
    expect(() => diag.masterSize('nope')).toThrow(/not registered/)
  })

  it('drops a master at its centre pin with a MasterShape skeleton and a separate label', () => {
    const { parts } = build()
    const page = parts['visio/pages/page1.xml'] as string
    // shape 1 = BOX master instance (its child skeleton takes id 2), label follows
    expect(page).toContain("<Shape ID='1' Type='Group' Master='1001'>")
    expect(cell(page, 1, 'PinX')).toBe('50')
    expect(cell(page, 1, 'PinY')).toBe('100')
    expect(cell(page, 1, 'Width')).toBe('19')
    expect(cell(page, 1, 'LocPinX')).toBe('9.5')
    expect(page).toContain("<Shape ID='2' Type='Shape' MasterShape='6'></Shape>")
    // label: 8pt on a 1:12 page → 8*1.3*12/72 = 1.7333 in tall, centred below the 1.7 in panel
    const labelM = /<Shape ID='3'[^>]*>(?:(?!<\/Shape>)[\s\S])*?<Text>leaf-1<\/Text>/.exec(page)
    expect(labelM).not.toBeNull()
    expect(cell(page, 3, 'PinX')).toBe('50')
    const ly = Number(cell(page, 3, 'PinY'))
    expect(ly).toBeCloseTo(100 - 0.85 - 0.48 - 1.7333 / 2, 3)
    expect(cell(page, 3, 'Size')).toBe(num(8 / 72))
    // EMF master: nested skeleton (6, 7 → 8), label above
    expect(page).toMatch(/<Shape ID='\d+' Type='Group' MasterShape='7'><Shapes><Shape ID='\d+' Type='Shape' MasterShape='8'><\/Shape><\/Shapes><\/Shape>/)
    const above = /<Shape ID='(\d+)'[^>]*>(?:(?!<\/Shape>)[\s\S])*?<Text>spine-1<\/Text>/.exec(page)
    expect(above).not.toBeNull()
    expect(Number(cell(page, Number(above![1]), 'PinY'))).toBeGreaterThan(101)
  })

  it('writes 1-D line geometry', () => {
    const { parts } = build()
    const page = parts['visio/pages/page1.xml'] as string
    const m = /<Shape ID='(\d+)'[^>]*>(?:(?!<\/Shape>)[\s\S])*?<Cell N='BeginX' V='50'\/>/.exec(page)
    expect(m).not.toBeNull()
    const id = Number(m![1])
    expect(cell(page, id, 'EndX')).toBe('150')
    expect(cell(page, id, 'EndY')).toBe('99')
    expect(cell(page, id, 'ObjType')).toBe('1')
    expect(cell(page, id, 'LineColor')).toBe('#0070C0')
    expect(cell(page, id, 'LineWeight')).toBe('0.014')
    expect(Number(cell(page, id, 'Width'))).toBeCloseTo(Math.hypot(100, 0.15), 4)
    expect(page).toContain('<Text>4 × 100G</Text>')
  })

  it('writes a rotated outline ellipse (Phase 15 port-channel ring)', () => {
    const { parts } = build()
    const page = parts['visio/pages/page1.xml'] as string
    const m = /<Shape ID='(\d+)'[^>]*>(?:(?!<\/Shape>)[\s\S])*?<Row T='Ellipse'/.exec(page)
    expect(m).not.toBeNull()
    const id = Number(m![1])
    expect(cell(page, id, 'PinX')).toBe('100')
    expect(cell(page, id, 'PinY')).toBe('99.075')
    expect(cell(page, id, 'Width')).toBe('6')
    expect(cell(page, id, 'Height')).toBe('3')
    expect(cell(page, id, 'Angle')).toBe('0.25')
    expect(cell(page, id, 'LineColor')).toBe('#B85450')
    expect(cell(page, id, 'FillPattern')).toBe('0')
    // Ellipse row: centre (X,Y), a point on the x axis (A,B), a point on the y axis (C,D), in local coordinates
    expect(page).toContain("<Row T='Ellipse' IX='1'><Cell N='X' V='3'/><Cell N='Y' V='1.5'/><Cell N='A' V='6'/><Cell N='B' V='1.5'/><Cell N='C' V='3'/><Cell N='D' V='3'/></Row>")
  })

  it('places bitmaps as Foreign shapes with one media part per distinct image', () => {
    const { parts } = build()
    const page = parts['visio/pages/page1.xml'] as string
    // two bitmaps on the page (the EMF master's skeleton child is Foreign too, but carries a MasterShape)
    expect((page.match(/Type='Foreign' LineStyle/g) ?? []).length).toBe(2)
    expect(page).toContain("<ForeignData ForeignType='Bitmap' CompressionType='PNG'><Rel r:id='rId1'/></ForeignData>")
    expect(parts['visio/pages/_rels/page1.xml.rels']).toContain('Target="../media/img_1.png"')
    expect((parts['visio/pages/_rels/page1.xml.rels'] as string).match(/<Relationship /g)).toHaveLength(1)
    expect(parts['visio/media/img_1.png']).toEqual(PNG_1X1)
    // 1×1 png at w=19 → h=19
    const m = /<Shape ID='(\d+)' Type='Foreign' LineStyle/.exec(page)
    expect(cell(page, Number(m![1]), 'Height')).toBe('19')
  })

  it('groups draw children in local coordinates', () => {
    const d = new Diagram({ title: 't', creator: 'c' })
    const p = d.addPage('p', 204, 132)
    const ref = d.group(p, 100, 50, 19, 1.75, (g) => {
      d.box(g, 9.5, 0.875, 19, 1.75, { fill: '#EEEEEE' })
      d.text(g, 2, 0.875, 3, 1, 'X', { fontPt: 6 })
    })
    expect(ref).toMatchObject({ kind: 'group', x0: 90.5, x1: 109.5 })
    const page = unzip(d.save())['visio/pages/page1.xml'] as string
    expect(page).toMatch(/<Shape ID='1' Type='Group'[^>]*>[\s\S]*<Shapes><Shape ID='2' Type='Shape'/)
    expect(cell(page, 2, 'PinX')).toBe('9.5')
    expect(page).toContain('<Text>X</Text>')
  })

  it('refuses to save without a page', () => {
    expect(() => new Diagram({ title: 't', creator: 'c' }).save()).toThrow(/at least one page/)
  })
})
