// Phase 13 — native Visio (.vsdx) writer.
//
// TypeScript port of claude-visio-diagrams/scripts/visio_builder.py. Builds
// the OPC package from scratch and copies Cisco stencil masters in verbatim
// (master XML + EMF media), so the output opens in Visio as fully native,
// editable shapes. Browser-safe: no Node imports, zip via fflate.
//
// Units (verified against the Cisco masters' own ShapeSheets):
//   * geometry — x, y, w, h, page size — is in DRAWING inches (real-world
//     size: a 19" switch is 19 wide); x,y is the shape's CENTRE pin; origin
//     is the page's bottom-left.
//   * font sizes and line weights are PAPER units and are NOT affected by
//     the drawing scale — fontPt=8 prints 8pt; weight=0.014 in is a 1pt line.
//   * `page.k` = drawing inches per paper inch (12 at 1:12) converts when
//     you need to reserve drawing space for text.
//
// Visio-compat lessons baked in (each one made a real Visio refuse the
// file at some point): docProps core/app + windows.xml parts with rels and
// content types; page-sheet scale cells carry U='IN'; never an empty
// <Text/>; instances of group masters need a skeleton child tree that
// references the master's children via MasterShape (a bare Master= renders
// empty); labels are separate text shapes because group-master text
// inheritance is unreliable.

import { strToU8, zipSync } from 'fflate'
import { DEFAULT_DOCUMENT_XML } from './document-xml'

export const VISIO_NS = 'http://schemas.microsoft.com/office/visio/2012/main'
export const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const CT_XML = 'application/vnd.ms-visio.drawing.main+xml'
const REL_DOC = 'http://schemas.microsoft.com/visio/2010/relationships/document'
const REL_MASTERS = 'http://schemas.microsoft.com/visio/2010/relationships/masters'
const REL_MASTER = 'http://schemas.microsoft.com/visio/2010/relationships/master'
const REL_PAGES = 'http://schemas.microsoft.com/visio/2010/relationships/pages'
const REL_PAGE = 'http://schemas.microsoft.com/visio/2010/relationships/page'
const REL_WINDOWS = 'http://schemas.microsoft.com/visio/2010/relationships/windows'
const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
const REL_CORE = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties'
const REL_APP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties'

// ── Public types ─────────────────────────────────────────────────────

/** One stencil master as stored in `<workspace>/library/visio/masters/<slug>/`. */
export interface MasterAsset {
  /** Master name as Visio shows it, e.g. "N9K-C9364D-GX2A Front". */
  name: string
  /** The `<Master …>` element from the pack's masters.xml (entry.xml). */
  entryXml: string
  /** The masterN.xml part, verbatim (master.xml). */
  masterXml: string
  /** The masterN.xml.rels part, verbatim, or null when the master has no media. */
  relsXml: string | null
  /** Media parts keyed by their ORIGINAL file name (image69.emf …). */
  media: Record<string, Uint8Array>
  /** Natural size of the master's top shape in drawing inches (0 = read from the XML). */
  widthIn: number
  heightIn: number
}

export type ShapeKind = 'master' | 'box' | 'text' | 'line' | 'image' | 'group'

/** A placed shape: its ID and bounding box in drawing inches (page coordinates). */
export interface ShapeRef {
  id: number
  kind: ShapeKind
  x0: number
  y0: number
  x1: number
  y1: number
}

export type HAlign = 'left' | 'center' | 'right'
export type LabelPos = 'above' | 'below'

export interface LabelOptions {
  label?: string
  /** Paper points (8 = 8pt printed). Default 8. */
  labelSize?: number
  labelPos?: LabelPos
  /** Gap between shape and label in PAPER inches. Default 0.04. */
  labelGap?: number
  labelColor?: string
}

export interface DropOptions extends LabelOptions {
  w?: number
  h?: number
}

export interface BoxOptions {
  text?: string
  fill?: string
  line?: string
  /** Line weight in paper inches (0.01 ≈ 0.7pt). */
  weight?: number
  fontPt?: number
  bold?: boolean
  align?: HAlign
  /** Visio LinePattern: 0 none, 1 solid, 2 dashed, 3 dotted. */
  pattern?: number
  /** Corner rounding in paper inches. */
  rounded?: number
  transparent?: boolean
  textColor?: string
}

export interface TextOptions {
  fontPt?: number
  bold?: boolean
  align?: HAlign
  color?: string
}

export interface LineOptions {
  color?: string
  /** Paper inches; 0.014 = 1pt. */
  weight?: number
  /** Visio LinePattern: 1 solid, 2 dashed, 3 dotted, 4 dash-dot, 9 long dash. */
  pattern?: number
  label?: string
  labelSize?: number
  /** Visio EndArrow index (0 none, 1 open, 2 filled …). */
  arrow?: number
}

export interface EllipseOptions {
  color?: string
  /** Paper inches; 0.014 = 1pt. */
  weight?: number
  pattern?: number
  /** Rotation in radians (Visio Angle cell). */
  angle?: number
}

export interface ImageSource {
  bytes: Uint8Array
  kind: 'png' | 'jpeg'
}

export interface ImageOptions extends LabelOptions {
  /** Drawing inches; give w and/or h — the other follows the pixel aspect. */
  w?: number
  h?: number
}

export interface DiagramOptions {
  title: string
  creator: string
  /** Override the embedded stylesheet document (visio/document.xml). */
  documentXml?: string
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Escape text for element content and single-quoted attributes. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
}

/** Plain decimal formatting — never exponent notation, no trailing zeros. */
export function num(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`vsdx-writer: non-finite number ${n}`)
  if (Number.isInteger(n)) return String(n)
  const s = n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  return s === '-0' ? '0' : s
}

const ALIGN: Record<HAlign, number> = { left: 0, center: 1, right: 2 }

function relsXml(rels: Array<[id: string, type: string, target: string]>): string {
  const rows = rels.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    rows +
    '</Relationships>'
  )
}

/** (width, height) in pixels of PNG or JPEG bytes. */
export function imagePixelSize(data: Uint8Array): { w: number; h: number } {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return { w: dv.getUint32(16), h: dv.getUint32(20) }
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    let i = 2
    while (i + 9 < data.length && data[i] === 0xff) {
      const marker = data[i + 1]
      const segLen = dv.getUint16(i + 2)
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) }
      }
      i += 2 + segLen
    }
  }
  throw new Error('imagePixelSize: unsupported image (need PNG or JPEG)')
}

const RECT_GEOMETRY =
  "<Section N='Geometry' IX='0'>" +
  "<Row T='RelMoveTo' IX='1'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row>" +
  "<Row T='RelLineTo' IX='2'><Cell N='X' V='1'/><Cell N='Y' V='0'/></Row>" +
  "<Row T='RelLineTo' IX='3'><Cell N='X' V='1'/><Cell N='Y' V='1'/></Row>" +
  "<Row T='RelLineTo' IX='4'><Cell N='X' V='0'/><Cell N='Y' V='1'/></Row>" +
  "<Row T='RelLineTo' IX='5'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row>" +
  '</Section>'

// ── Master XML introspection (regex-based: no DOM in Node, no deps) ──

interface ShapeTreeNode {
  id: string
  type: string
  children: ShapeTreeNode[]
}

/** Parse the nested <Shape>/<Shapes> skeleton of a master part. */
export function parseShapeTree(masterXml: string): ShapeTreeNode[] {
  // Tokens: <Shape …> (open, possibly self-closing) and </Shape>. <Shapes>
  // wrappers add nothing structurally, so they are ignored.
  const re = /<Shape\b([^>]*?)(\/?)>|<\/Shape>/g
  const root: ShapeTreeNode = { id: '', type: '', children: [] }
  const stack: ShapeTreeNode[] = [root]
  let m: RegExpExecArray | null
  while ((m = re.exec(masterXml)) !== null) {
    if (m[0] === '</Shape>') {
      if (stack.length > 1) stack.pop()
      continue
    }
    const attrs = m[1]
    const id = /\bID=['"]([^'"]*)['"]/.exec(attrs)?.[1] ?? ''
    const type = /\bType=['"]([^'"]*)['"]/.exec(attrs)?.[1] ?? 'Shape'
    const node: ShapeTreeNode = { id, type, children: [] }
    stack[stack.length - 1].children.push(node)
    if (m[2] !== '/') stack.push(node)
  }
  return root.children
}

/** Width/Height cells of a master's top shape, in drawing inches. */
export function masterNaturalSize(masterXml: string): { w: number; h: number } {
  const open = /<Shape\b[^>]*>/.exec(masterXml)
  if (!open) throw new Error('masterNaturalSize: no <Shape> in master XML')
  const from = open.index + open[0].length
  const cell = (name: string): number => {
    const r = new RegExp(`<Cell N='${name}' V='([^']*)'|<Cell N="${name}" V="([^"]*)"`)
    const sub = masterXml.slice(from, from + 6000)
    const mm = r.exec(sub)
    const v = mm ? Number(mm[1] ?? mm[2]) : NaN
    if (!Number.isFinite(v)) throw new Error(`masterNaturalSize: no ${name} cell`)
    return v
  }
  return { w: cell('Width'), h: cell('Height') }
}

// ── Page / Group ─────────────────────────────────────────────────────

/** Anything shapes can be appended to: a page or a group being built. */
export interface ShapeSink {
  readonly page: Page
  shapes: string[]
}

export class Page implements ShapeSink {
  shapes: string[] = []
  connects: string[] = []
  /** (rId, media file name) for bitmap shapes on this page. */
  images: Array<[rid: string, name: string]> = []
  private nextId = 1

  readonly name: string
  /** Drawing inches. */
  readonly width: number
  readonly height: number
  readonly pageScale: number
  readonly drawingScale: number

  // Plain assignments (not parameter properties) so Node's type-stripping
  // loader can run the smoke script without a build step.
  constructor(name: string, width: number, height: number, pageScale: number, drawingScale: number) {
    this.name = name
    this.width = width
    this.height = height
    this.pageScale = pageScale
    this.drawingScale = drawingScale
  }

  get page(): Page {
    return this
  }

  /** Drawing inches per paper inch (12 for a 1:12 page). */
  get k(): number {
    return this.drawingScale / this.pageScale
  }

  /** Paper size in inches (what the printed sheet measures). */
  get paperWidth(): number {
    return this.width / this.k
  }

  get paperHeight(): number {
    return this.height / this.k
  }

  nid(): number {
    return this.nextId++
  }
}

/**
 * A group under construction. Child coordinates are LOCAL to the group:
 * origin at the group's bottom-left corner, extents 0..w × 0..h.
 */
export class Group implements ShapeSink {
  shapes: string[] = []
  readonly page: Page
  readonly w: number
  readonly h: number
  constructor(page: Page, w: number, h: number) {
    this.page = page
    this.w = w
    this.h = h
  }
}

// ── Diagram ──────────────────────────────────────────────────────────

interface RegisteredMaster {
  id: string
  entryXml: string
  masterXml: string
  rels: Array<[id: string, type: string, target: string]>
  size: { w: number; h: number }
  tree: ShapeTreeNode
}

export class Diagram {
  readonly title: string
  readonly creator: string
  readonly pages: Page[] = []
  private readonly documentXml: string
  private readonly masters = new Map<string, RegisteredMaster>()
  private readonly masterParts: RegisteredMaster[] = []
  private readonly media = new Map<string, Uint8Array>()
  private masterSeq = 1
  private imageSeq = 1

  constructor(opts: DiagramOptions) {
    this.title = opts.title
    this.creator = opts.creator
    this.documentXml = opts.documentXml ?? DEFAULT_DOCUMENT_XML
  }

  // ── pages ──

  /** Default 17×11" paper at 1:12 is addPage(name, 204, 132). */
  addPage(name: string, widthIn: number, heightIn: number, pageScale = 1, drawingScale = 12): Page {
    const p = new Page(name, widthIn, heightIn, pageScale, drawingScale)
    this.pages.push(p)
    return p
  }

  // ── masters ──

  hasMaster(name: string): boolean {
    return this.masters.has(name)
  }

  /**
   * Copy a stencil master into this drawing. Returns the master ID used on
   * the page. Registering the same name twice is a no-op. Media files are
   * renamed `m<seq>_<original>` so two masters shipping `image1.emf` cannot
   * collide; the master's rels are rewritten to match.
   */
  registerMaster(m: MasterAsset): string {
    const existing = this.masters.get(m.name)
    if (existing) return existing.id
    const seq = this.masterSeq++
    const id = String(1000 + seq)
    const prefix = `m${seq}_`

    // Re-ID the <Master …> entry (the <Rel r:id> is assigned at save time).
    let entryXml = m.entryXml.replace(/\sID=(['"])[^'"]*\1/, ` ID='${id}'`)
    if (!/\sID=/.test(entryXml)) entryXml = entryXml.replace(/<Master\b/, `<Master ID='${id}'`)

    const rels: RegisteredMaster['rels'] = []
    if (m.relsXml) {
      const re = /<Relationship\b([^>]*?)\/?>/g
      let mm: RegExpExecArray | null
      while ((mm = re.exec(m.relsXml)) !== null) {
        const attrs = mm[1]
        const rid = /\bId=["']([^"']*)["']/.exec(attrs)?.[1]
        const type = /\bType=["']([^"']*)["']/.exec(attrs)?.[1]
        const target = /\bTarget=["']([^"']*)["']/.exec(attrs)?.[1]
        if (!rid || !type || !target) continue
        const base = target.split('/').pop() ?? target
        const bytes = m.media[base]
        if (!bytes) throw new Error(`registerMaster(${m.name}): media ${base} missing from asset`)
        const renamed = prefix + base
        this.media.set(renamed, bytes)
        rels.push([rid, type, '../media/' + renamed])
      }
    }

    const size = m.widthIn > 0 && m.heightIn > 0 ? { w: m.widthIn, h: m.heightIn } : masterNaturalSize(m.masterXml)
    const tree = parseShapeTree(m.masterXml)[0]
    if (!tree) throw new Error(`registerMaster(${m.name}): master has no top shape`)
    const reg: RegisteredMaster = { id, entryXml, masterXml: m.masterXml, rels, size, tree }
    this.masters.set(m.name, reg)
    this.masterParts.push(reg)
    return id
  }

  masterSize(name: string): { w: number; h: number } {
    return { ...this.master(name).size }
  }

  private master(name: string): RegisteredMaster {
    const reg = this.masters.get(name)
    if (!reg) throw new Error(`master not registered: '${name}'`)
    return reg
  }

  // ── shape helpers ──

  /** Height in drawing inches of a text block of `fontPt` paper points. */
  textHeight(page: Page, s: string, fontPt: number, leading = 1.3): number {
    const lines = s.split('\n').length
    return (lines * fontPt * leading * page.k) / 72
  }

  /** Drop a stencil master with its CENTRE pin at (x, y) drawing inches. */
  drop(sink: ShapeSink, masterName: string, x: number, y: number, opts: DropOptions = {}): ShapeRef {
    const reg = this.master(masterName)
    const w = opts.w ?? reg.size.w
    const h = opts.h ?? reg.size.h
    const page = sink.page
    const sid = page.nid()
    const children = this.instanceChildren(page, reg.tree)
    sink.shapes.push(
      `<Shape ID='${sid}' Type='${reg.tree.type || 'Group'}' Master='${reg.id}'>` +
        `<Cell N='PinX' V='${num(x)}'/><Cell N='PinY' V='${num(y)}'/>` +
        `<Cell N='Width' V='${num(w)}'/><Cell N='Height' V='${num(h)}'/>` +
        `<Cell N='LocPinX' V='${num(w / 2)}'/><Cell N='LocPinY' V='${num(h / 2)}'/>` +
        `${children}</Shape>`
    )
    this.labelFor(sink, x, y, w, h, opts)
    return { id: sid, kind: 'master', x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 }
  }

  /** Skeleton subshapes referencing the master's children via MasterShape. */
  private instanceChildren(page: Page, node: ShapeTreeNode): string {
    if (node.children.length === 0) return ''
    const out = node.children.map(
      (c) =>
        `<Shape ID='${page.nid()}' Type='${c.type}' MasterShape='${c.id}'>${this.instanceChildren(page, c)}</Shape>`
    )
    return '<Shapes>' + out.join('') + '</Shapes>'
  }

  /** Label text shape above/below a placed shape (drop() and image()). */
  private labelFor(sink: ShapeSink, x: number, y: number, w: number, h: number, opts: LabelOptions): ShapeRef | null {
    if (!opts.label) return null
    const page = sink.page
    const sizePt = opts.labelSize ?? 8
    const th = this.textHeight(page, opts.label, sizePt)
    const gap = (opts.labelGap ?? 0.04) * page.k
    const ly = (opts.labelPos ?? 'below') === 'below' ? y - h / 2 - gap - th / 2 : y + h / 2 + gap + th / 2
    return this.text(sink, x, ly, Math.max(w, (8 * page.k) / 12), th, opts.label, {
      fontPt: sizePt,
      color: opts.labelColor
    })
  }

  /**
   * Plain rectangle (container / legend / fallback device). x,y = centre;
   * w,h drawing inches; fontPt paper points; weight/rounded paper inches.
   */
  box(sink: ShapeSink, x: number, y: number, w: number, h: number, opts: BoxOptions = {}): ShapeRef {
    const page = sink.page
    const sid = page.nid()
    const fontPt = opts.fontPt ?? 10
    let char = `<Cell N='Size' V='${num(fontPt / 72)}'/>`
    if (opts.textColor) char += `<Cell N='Color' V='${opts.textColor}'/>`
    if (opts.bold) char += "<Cell N='Style' V='1'/>"
    const fillPattern = opts.transparent ? 0 : 1
    const text = opts.text ? `<Text>${esc(opts.text)}</Text>` : ''
    sink.shapes.push(
      `<Shape ID='${sid}' Type='Shape' LineStyle='0' FillStyle='0' TextStyle='0'>` +
        `<Cell N='PinX' V='${num(x)}'/><Cell N='PinY' V='${num(y)}'/>` +
        `<Cell N='Width' V='${num(w)}'/><Cell N='Height' V='${num(h)}'/>` +
        `<Cell N='LocPinX' V='${num(w / 2)}'/><Cell N='LocPinY' V='${num(h / 2)}'/>` +
        `<Cell N='FillForegnd' V='${opts.fill ?? '#FFFFFF'}'/><Cell N='FillPattern' V='${fillPattern}'/>` +
        `<Cell N='LineColor' V='${opts.line ?? '#000000'}'/><Cell N='LineWeight' V='${num(opts.weight ?? 0.01)}'/>` +
        `<Cell N='LinePattern' V='${opts.pattern ?? 1}'/>` +
        `<Cell N='Rounding' V='${num((opts.rounded ?? 0) * page.k)}'/>` +
        `<Section N='Character'><Row IX='0'>${char}</Row></Section>` +
        `<Section N='Paragraph'><Row IX='0'><Cell N='HorzAlign' V='${ALIGN[opts.align ?? 'center']}'/></Row></Section>` +
        RECT_GEOMETRY +
        text +
        '</Shape>'
    )
    return { id: sid, kind: 'box', x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 }
  }

  /** Free text block centred at (x, y); w,h drawing inches; fontPt paper points. */
  text(sink: ShapeSink, x: number, y: number, w: number, h: number, s: string, opts: TextOptions = {}): ShapeRef {
    if (!s) throw new Error('text(): empty string (Visio rejects an empty <Text/>)')
    const page = sink.page
    const sid = page.nid()
    let char = `<Cell N='Size' V='${num((opts.fontPt ?? 12) / 72)}'/><Cell N='Color' V='${opts.color ?? '#000000'}'/>`
    if (opts.bold) char += "<Cell N='Style' V='1'/>"
    sink.shapes.push(
      `<Shape ID='${sid}' Type='Shape' LineStyle='0' FillStyle='0' TextStyle='0'>` +
        `<Cell N='PinX' V='${num(x)}'/><Cell N='PinY' V='${num(y)}'/>` +
        `<Cell N='Width' V='${num(w)}'/><Cell N='Height' V='${num(h)}'/>` +
        `<Cell N='LocPinX' V='${num(w / 2)}'/><Cell N='LocPinY' V='${num(h / 2)}'/>` +
        `<Cell N='FillPattern' V='0'/><Cell N='LinePattern' V='0'/>` +
        `<Section N='Character'><Row IX='0'>${char}</Row></Section>` +
        `<Section N='Paragraph'><Row IX='0'><Cell N='HorzAlign' V='${ALIGN[opts.align ?? 'center']}'/></Row></Section>` +
        `<Text>${esc(s)}</Text></Shape>`
    )
    return { id: sid, kind: 'text', x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 }
  }

  /**
   * Outline ellipse centred at (x, y), radii rx (along the shape's x axis)
   * and ry, rotated by `angle` radians — the port-channel ring around a
   * peer-link bundle. No fill, no text.
   */
  ellipse(sink: ShapeSink, x: number, y: number, rx: number, ry: number, opts: EllipseOptions = {}): ShapeRef {
    const page = sink.page
    const sid = page.nid()
    const w = 2 * rx
    const h = 2 * ry
    sink.shapes.push(
      `<Shape ID='${sid}' Type='Shape' LineStyle='0' FillStyle='0' TextStyle='0'>` +
        `<Cell N='PinX' V='${num(x)}'/><Cell N='PinY' V='${num(y)}'/>` +
        `<Cell N='Width' V='${num(w)}'/><Cell N='Height' V='${num(h)}'/>` +
        `<Cell N='LocPinX' V='${num(rx)}'/><Cell N='LocPinY' V='${num(ry)}'/>` +
        `<Cell N='Angle' V='${num(opts.angle ?? 0)}'/>` +
        `<Cell N='LineColor' V='${opts.color ?? '#000000'}'/><Cell N='LineWeight' V='${num(opts.weight ?? 0.014)}'/>` +
        `<Cell N='LinePattern' V='${opts.pattern ?? 1}'/><Cell N='FillPattern' V='0'/>` +
        `<Section N='Geometry' IX='0'>` +
        `<Row T='Ellipse' IX='1'>` +
        `<Cell N='X' V='${num(rx)}'/><Cell N='Y' V='${num(ry)}'/>` +
        `<Cell N='A' V='${num(w)}'/><Cell N='B' V='${num(ry)}'/>` +
        `<Cell N='C' V='${num(rx)}'/><Cell N='D' V='${num(h)}'/>` +
        `</Row></Section></Shape>`
    )
    const r = Math.max(rx, ry)
    return { id: sid, kind: 'box', x0: x - r, y0: y - r, x1: x + r, y1: y + r }
  }

  /** 1-D line from (x1,y1) to (x2,y2) in drawing inches. */
  line(sink: ShapeSink, x1: number, y1: number, x2: number, y2: number, opts: LineOptions = {}): ShapeRef {
    const page = sink.page
    const sid = page.nid()
    const dx = x2 - x1
    const dy = y2 - y1
    const length = Math.hypot(dx, dy)
    const angle = Math.atan2(dy, dx)
    const text = opts.label ? `<Text>${esc(opts.label)}</Text>` : ''
    const char = opts.label
      ? `<Section N='Character'><Row IX='0'><Cell N='Size' V='${num((opts.labelSize ?? 8) / 72)}'/></Row></Section>`
      : ''
    const arrow = opts.arrow ? `<Cell N='EndArrow' V='${opts.arrow}'/>` : ''
    sink.shapes.push(
      `<Shape ID='${sid}' Type='Shape' LineStyle='0' FillStyle='0' TextStyle='0'>` +
        `<Cell N='BeginX' V='${num(x1)}'/><Cell N='BeginY' V='${num(y1)}'/>` +
        `<Cell N='EndX' V='${num(x2)}'/><Cell N='EndY' V='${num(y2)}'/>` +
        `<Cell N='PinX' V='${num((x1 + x2) / 2)}'/><Cell N='PinY' V='${num((y1 + y2) / 2)}'/>` +
        `<Cell N='Width' V='${num(length)}'/><Cell N='Height' V='0'/>` +
        `<Cell N='LocPinX' V='${num(length / 2)}'/><Cell N='LocPinY' V='0'/>` +
        `<Cell N='Angle' V='${num(angle)}'/>` +
        `<Cell N='ObjType' V='1'/>` +
        `<Cell N='LineColor' V='${opts.color ?? '#000000'}'/><Cell N='LineWeight' V='${num(opts.weight ?? 0.014)}'/>` +
        `<Cell N='LinePattern' V='${opts.pattern ?? 1}'/><Cell N='FillPattern' V='0'/>` +
        arrow +
        char +
        `<Section N='Geometry' IX='0'>` +
        `<Row T='MoveTo' IX='1'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row>` +
        `<Row T='LineTo' IX='2'><Cell N='X' V='${num(length)}'/><Cell N='Y' V='0'/></Row>` +
        `</Section>${text}</Shape>`
    )
    return {
      id: sid,
      kind: 'line',
      x0: Math.min(x1, x2),
      y0: Math.min(y1, y2),
      x1: Math.max(x1, x2),
      y1: Math.max(y1, y2)
    }
  }

  /** Place a PNG/JPEG bitmap (e.g. a product photo) centred at (x, y). */
  image(sink: ShapeSink, img: ImageSource, x: number, y: number, opts: ImageOptions = {}): ShapeRef {
    const page = sink.page
    const px = imagePixelSize(img.bytes)
    let w = opts.w
    let h = opts.h
    if (w === undefined && h === undefined) throw new Error('image(): give w and/or h in drawing inches')
    if (w === undefined) w = (h! * px.w) / px.h
    if (h === undefined) h = (w * px.h) / px.w
    const ext = img.kind === 'png' ? 'png' : 'jpg'
    // one media part per distinct byte string, however many times it is placed
    let name: string | undefined
    for (const [n, b] of this.media) {
      if (b === img.bytes || sameBytes(b, img.bytes)) {
        name = n
        break
      }
    }
    if (!name) {
      name = `img_${this.imageSeq++}.${ext}`
      this.media.set(name, img.bytes)
    }
    let rid = page.images.find(([, n]) => n === name)?.[0]
    if (!rid) {
      rid = `rId${page.images.length + 1}`
      page.images.push([rid, name])
    }
    const sid = page.nid()
    sink.shapes.push(
      `<Shape ID='${sid}' Type='Foreign' LineStyle='0' FillStyle='0' TextStyle='0'>` +
        `<Cell N='PinX' V='${num(x)}'/><Cell N='PinY' V='${num(y)}'/>` +
        `<Cell N='Width' V='${num(w)}'/><Cell N='Height' V='${num(h)}'/>` +
        `<Cell N='LocPinX' V='${num(w / 2)}'/><Cell N='LocPinY' V='${num(h / 2)}'/>` +
        `<Cell N='ImgOffsetX' V='0'/><Cell N='ImgOffsetY' V='0'/>` +
        `<Cell N='ImgWidth' V='${num(w)}'/><Cell N='ImgHeight' V='${num(h)}'/>` +
        `<Cell N='LinePattern' V='0'/><Cell N='FillPattern' V='0'/>` +
        RECT_GEOMETRY +
        `<ForeignData ForeignType='Bitmap' CompressionType='${img.kind === 'png' ? 'PNG' : 'JPEG'}'>` +
        `<Rel r:id='${rid}'/></ForeignData></Shape>`
    )
    this.labelFor(sink, x, y, w, h, opts)
    return { id: sid, kind: 'image', x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 }
  }

  /**
   * Native group centred at (x, y) with size w×h. `build` draws the children
   * in LOCAL coordinates (origin = group's bottom-left). Used for the
   * generated schematic front panels so they move/copy as one shape.
   */
  group(sink: ShapeSink, x: number, y: number, w: number, h: number, build: (g: Group) => void): ShapeRef {
    const page = sink.page
    const sid = page.nid()
    const g = new Group(page, w, h)
    build(g)
    sink.shapes.push(
      `<Shape ID='${sid}' Type='Group' LineStyle='0' FillStyle='0' TextStyle='0'>` +
        `<Cell N='PinX' V='${num(x)}'/><Cell N='PinY' V='${num(y)}'/>` +
        `<Cell N='Width' V='${num(w)}'/><Cell N='Height' V='${num(h)}'/>` +
        `<Cell N='LocPinX' V='${num(w / 2)}'/><Cell N='LocPinY' V='${num(h / 2)}'/>` +
        `<Cell N='FillPattern' V='0'/><Cell N='LinePattern' V='0'/>` +
        `<Cell N='SelectMode' V='1'/><Cell N='DisplayMode' V='2'/>` +
        `<Shapes>${g.shapes.join('')}</Shapes></Shape>`
    )
    return { id: sid, kind: 'group', x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 }
  }

  // ── packaging ──

  /** Build the .vsdx package and return its bytes. */
  save(now: Date = new Date()): Uint8Array {
    const parts: Record<string, Uint8Array> = {}
    const put = (name: string, s: string): void => {
      parts[name] = strToU8(s)
    }
    const nMasters = this.masterParts.length
    const nPages = this.pages.length
    if (nPages === 0) throw new Error('save(): a drawing needs at least one page')

    // [Content_Types].xml
    const overrides = [
      `<Override PartName="/visio/document.xml" ContentType="${CT_XML}"/>`,
      '<Override PartName="/visio/masters/masters.xml" ContentType="application/vnd.ms-visio.masters+xml"/>',
      '<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>',
      '<Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>',
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    ]
    for (let i = 0; i < nMasters; i++) {
      overrides.push(
        `<Override PartName="/visio/masters/master${i + 1}.xml" ContentType="application/vnd.ms-visio.master+xml"/>`
      )
    }
    for (let i = 0; i < nPages; i++) {
      overrides.push(`<Override PartName="/visio/pages/page${i + 1}.xml" ContentType="application/vnd.ms-visio.page+xml"/>`)
    }
    put(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="emf" ContentType="image/x-emf"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Default Extension="jpg" ContentType="image/jpeg"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        overrides.join('') +
        '</Types>'
    )

    put(
      '_rels/.rels',
      relsXml([
        ['rId1', REL_DOC, 'visio/document.xml'],
        ['rId2', REL_CORE, 'docProps/core.xml'],
        ['rId3', REL_APP, 'docProps/app.xml']
      ])
    )

    const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
    put(
      'docProps/core.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
        'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<dc:title>${esc(this.title)}</dc:title><dc:creator>${esc(this.creator)}</dc:creator>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>` +
        `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>` +
        '<dc:language>en-US</dc:language></cp:coreProperties>'
    )
    const pageTitles = this.pages.map((p) => `<vt:lpstr>${esc(p.name)}</vt:lpstr>`).join('')
    put(
      'docProps/app.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
        '<Template></Template><Application>Microsoft Visio</Application><ScaleCrop>false</ScaleCrop>' +
        '<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Pages</vt:lpstr></vt:variant>' +
        `<vt:variant><vt:i4>${nPages}</vt:i4></vt:variant></vt:vector></HeadingPairs>` +
        `<TitlesOfParts><vt:vector size="${nPages}" baseType="lpstr">${pageTitles}</vt:vector></TitlesOfParts>` +
        '<Manager></Manager><Company></Company><LinksUpToDate>false</LinksUpToDate>' +
        '<SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged>' +
        '<AppVersion>16.0000</AppVersion></Properties>'
    )
    put(
      'visio/windows.xml',
      "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>" +
        `<Windows ClientWidth='0' ClientHeight='0' xmlns='${VISIO_NS}' xmlns:r='${REL_NS}' xml:space='preserve'/>`
    )

    put('visio/document.xml', this.documentXml)
    put(
      'visio/_rels/document.xml.rels',
      relsXml([
        ['rId1', REL_MASTERS, 'masters/masters.xml'],
        ['rId2', REL_PAGES, 'pages/pages.xml'],
        ['rId3', REL_WINDOWS, 'windows.xml']
      ])
    )

    // masters
    const entries: string[] = []
    this.masterParts.forEach((reg, i) => {
      const rid = `rId${i + 1}`
      let entry = reg.entryXml
      if (/<Rel\b[^>]*r:id=/.test(entry)) {
        entry = entry.replace(/(<Rel\b[^>]*r:id=)(['"])[^'"]*\2/, `$1$2${rid}$2`)
      } else {
        entry = entry.replace(/<\/Master>\s*$/, `<Rel r:id='${rid}'/></Master>`)
      }
      entries.push(entry)
      put(`visio/masters/master${i + 1}.xml`, reg.masterXml)
      if (reg.rels.length > 0) put(`visio/masters/_rels/master${i + 1}.xml.rels`, relsXml(reg.rels))
    })
    put(
      'visio/masters/masters.xml',
      "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>" +
        `<Masters xmlns='${VISIO_NS}' xmlns:r='${REL_NS}' xml:space='preserve'>` +
        entries.join('') +
        '</Masters>'
    )
    put(
      'visio/masters/_rels/masters.xml.rels',
      relsXml(this.masterParts.map((_, i) => [`rId${i + 1}`, REL_MASTER, `master${i + 1}.xml`]))
    )

    // media
    for (const [name, bytes] of this.media) parts['visio/media/' + name] = bytes

    // pages
    const pageEntries: string[] = []
    this.pages.forEach((p, i) => {
      pageEntries.push(
        `<Page ID='${i}' NameU='${esc(p.name)}' Name='${esc(p.name)}'>` +
          `<PageSheet LineStyle='0' FillStyle='0' TextStyle='0'>` +
          `<Cell N='PageWidth' V='${num(p.width)}'/>` +
          `<Cell N='PageHeight' V='${num(p.height)}'/>` +
          `<Cell N='PageScale' V='${num(p.pageScale)}' U='IN'/>` +
          `<Cell N='DrawingScale' V='${num(p.drawingScale)}' U='IN'/>` +
          `<Cell N='DrawingSizeType' V='3'/>` +
          `<Cell N='DrawingScaleType' V='3'/>` +
          `</PageSheet>` +
          `<Rel r:id='rId${i + 1}'/></Page>`
      )
      put(
        `visio/pages/page${i + 1}.xml`,
        "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>" +
          `<PageContents xmlns='${VISIO_NS}' xmlns:r='${REL_NS}' xml:space='preserve'>` +
          '<Shapes>' +
          p.shapes.join('') +
          '</Shapes>' +
          (p.connects.length ? '<Connects>' + p.connects.join('') + '</Connects>' : '') +
          '</PageContents>'
      )
      if (p.images.length > 0) {
        put(
          `visio/pages/_rels/page${i + 1}.xml.rels`,
          relsXml(p.images.map(([rid, name]) => [rid, REL_IMAGE, '../media/' + name]))
        )
      }
    })
    put(
      'visio/pages/pages.xml',
      "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>" +
        `<Pages xmlns='${VISIO_NS}' xmlns:r='${REL_NS}' xml:space='preserve'>` +
        pageEntries.join('') +
        '</Pages>'
    )
    put(
      'visio/pages/_rels/pages.xml.rels',
      relsXml(this.pages.map((_, i) => [`rId${i + 1}`, REL_PAGE, `page${i + 1}.xml`]))
    )

    return zipSync(parts, { level: 6 })
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false
  return true
}

// ── Geometry helpers shared by callers (touch / overlap validation) ──

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function rectsOverlap(a: Rect, b: Rect, tol = 0): boolean {
  return a.x0 < b.x1 - tol && b.x0 < a.x1 - tol && a.y0 < b.y1 - tol && b.y0 < a.y1 - tol
}

/** True when the point lies on (or within `tol` of) the rectangle's boundary. */
export function pointTouchesRect(x: number, y: number, r: Rect, tol = 0.3): boolean {
  const inside = x >= r.x0 - tol && x <= r.x1 + tol && y >= r.y0 - tol && y <= r.y1 + tol
  if (!inside) return false
  const nearEdge =
    Math.abs(x - r.x0) <= tol || Math.abs(x - r.x1) <= tol || Math.abs(y - r.y0) <= tol || Math.abs(y - r.y1) <= tol
  return nearEdge
}
