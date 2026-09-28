import { describe, it, expect } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import {
  EDGE_LABEL_MAX_EDGES,
  IN_PER_PX,
  PORT_LABEL_MAX_PER_DEVICE,
  SCENE_TILE_H,
  SCENE_TILE_W,
  buildTopologyDiagram,
  chooseSheet,
  collapsePorts,
  fitText,
  type TopologyVisioEdge,
  type TopologyVisioInput,
  type TopologyVisioNode
} from './topology-visio'
import { TILE_H, TILE_W } from '../topology-hierarchy'
import { Diagram } from './vsdx-writer'
import { BOX_MASTER, PNG_1X1 } from './__fixtures__/masters'

// 2 spines on tier 1 (y=0), 4 leaves on tier 2 (y=250), laid out like
// layoutScene does with TILE_W+GAP = 138 px stride.
function spine(id: string, x: number): TopologyVisioNode {
  return {
    id,
    label: id,
    sublabel: 'N9K-C9364D-GX2A',
    role: 'spine',
    x,
    y: 0,
    panel: { kind: 'master', masterName: BOX_MASTER.name },
    smart: false,
    modelId: 'N9K-C9364D-GX2A'
  }
}
function leaf(id: string, x: number, panel: TopologyVisioNode['panel']): TopologyVisioNode {
  return { id, label: id, sublabel: 'N9348Y2C6D-SE1U', role: 'leaf', x, y: 250, panel, smart: true, modelId: 'N9348Y2C6D-SE1U' }
}
function edge(s: string, t: string, ports: TopologyVisioEdge['ports'] = [], label?: string): TopologyVisioEdge {
  const n = Math.max(1, ports.length)
  return { id: `${s}->${t}`, source: s, target: t, count: n, speeds: [100], label: label ?? `${n} × 100G`, ports }
}

const schematic = { kind: 'schematic' as const, ru: 1, groups: [{ ports: 48, speedG: 25 }, { ports: 6, speedG: 400 }] }

function input(edges: TopologyVisioEdge[], extra: Partial<TopologyVisioInput> = {}): TopologyVisioInput {
  return {
    projectName: 'Phase13 Test',
    customer: 'Example Customer',
    generatedAt: '2026-09-26T12:00:00Z',
    substitutions: ['N9348Y2C6D-SE1U: no stencil master — schematic panel'],
    pages: [
      {
        title: 'Fabric 1 — devices',
        orientation: 'vertical',
        nodes: [
          spine('spine-1', 138),
          spine('spine-2', 276),
          leaf('leaf-1', 0, schematic),
          leaf('leaf-2', 138, { kind: 'image', bytes: PNG_1X1, imageKind: 'png', widthIn: 6 }), // 1×1 px → 6×6 in
          leaf('leaf-3', 276, schematic),
          leaf('leaf-4', 414, schematic)
        ],
        edges
      }
    ],
    ...extra
  }
}

function fullEdges(): TopologyVisioEdge[] {
  const out: TopologyVisioEdge[] = []
  for (const s of ['spine-1', 'spine-2']) {
    for (const [i, l] of ['leaf-1', 'leaf-2', 'leaf-3', 'leaf-4'].entries()) {
      const sp = s === 'spine-1' ? 'Eth1/49' : 'Eth1/50'
      out.push(edge(s, l, [{ a: `Eth1/${i * 2 + 1}`, b: sp }, { a: `Eth1/${i * 2 + 2}`, b: sp }]))
    }
  }
  return out
}

function build(edges = fullEdges(), extra: Partial<TopologyVisioInput> = {}) {
  const diag = new Diagram({ title: 't', creator: 'c' })
  diag.registerMaster(BOX_MASTER)
  const res = buildTopologyDiagram(input(edges, extra), diag)
  const page = strFromU8(unzipSync(diag.save())['visio/pages/page1.xml'])
  return { diag, res, page }
}

function shapeCells(page: string, textOrId: string | number): Record<string, string> {
  const re =
    typeof textOrId === 'number'
      ? new RegExp(`<Shape ID='${textOrId}'[^>]*>((?:(?!<\\/Shape>)[\\s\\S])*)`)
      : new RegExp(`<Shape ID='\\d+'[^>]*>((?:(?!<\\/Shape>)[\\s\\S])*?<Text>${textOrId}</Text>)`)
  const body = re.exec(page)?.[1] ?? ''
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/<Cell N='(\w+)' V='([^']*)'/g)) if (!(m[1] in out)) out[m[1]] = m[2]
  return out
}

function lines(page: string): Array<[number, number, number, number]> {
  return [...page.matchAll(/<Cell N='BeginX' V='([^']*)'\/><Cell N='BeginY' V='([^']*)'\/><Cell N='EndX' V='([^']*)'\/><Cell N='EndY' V='([^']*)'\/>/g)].map(
    (m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  )
}

describe('helpers', () => {
  it('tile constants match topology-hierarchy.ts', () => {
    expect(SCENE_TILE_W).toBe(TILE_W)
    expect(SCENE_TILE_H).toBe(TILE_H)
  })

  it('collapsePorts folds runs and keeps prefixes apart', () => {
    expect(collapsePorts(['Eth1/49', 'Eth1/50'])).toBe('Eth1/49-50')
    expect(collapsePorts(['Eth1/1', 'Eth1/3'])).toBe('Eth1/1,3')
    expect(collapsePorts(['Eth1/52', 'Eth1/49', 'Eth1/50', 'Eth1/49'])).toBe('Eth1/49-50,52')
    expect(collapsePorts(['Eth1/49/1', 'Eth1/49/2', 'Eth2/1'])).toBe('Eth1/49/1-2, Eth2/1')
    expect(collapsePorts(['mgmt0'])).toBe('mgmt0')
    expect(collapsePorts([])).toBe('')
  })

  it('fitText shrinks, then breaks at a hyphen, then truncates', () => {
    expect(fitText('leaf-1', 30, 12, 8, 5, true)).toEqual({ text: 'leaf-1', pt: 8 })
    const shrunk = fitText('smart-sw-leaf12', 30, 36, 8, 5, true)
    expect(shrunk.pt).toBeLessThan(8)
    expect(shrunk.text).toBe('smart-sw-leaf12')
    const broken = fitText('smart-sw-leaf12', 30, 64, 8, 5, true)
    expect(broken.pt).toBe(5)
    expect(broken.text).toBe('smart-sw-\nleaf12')
    const cut = fitText('averyveryverylonghostnamewithoutbreaks', 30, 96, 8, 5, true)
    expect(cut.text.endsWith('…')).toBe(true)
    expect(cut.text.length).toBeLessThan(20)
  })

  it('chooseSheet prefers tabloid, then ANSI D, then raises the scale', () => {
    expect(chooseSheet(100, 60)).toEqual({ paperW: 17, paperH: 11, scale: 12 })
    expect(chooseSheet(300, 60)).toEqual({ paperW: 34, paperH: 22, scale: 12 })
    expect(chooseSheet(700, 60)).toEqual({ paperW: 34, paperH: 22, scale: 24 })
    expect(chooseSheet(1054, 66)).toEqual({ paperW: 34, paperH: 22, scale: 36 })
    expect(chooseSheet(60, 1054)).toEqual({ paperW: 22, paperH: 34, scale: 36 })
    expect(chooseSheet(1e6, 10).scale).toBe(384) // capped, never grows the paper
  })
})

describe('buildTopologyDiagram', () => {
  it('reports the sheet per page; a 6-tile scene fits 17×11 at 1:12', () => {
    const { res, diag } = build()
    expect(res.sheets).toEqual([
      { title: 'Fabric 1 — devices', paperWidthIn: 17, paperHeightIn: 11, drawingScale: 12, label: '17×11 in at 1:12' }
    ])
    expect(diag.pages[0].width).toBe(204)
    expect(diag.pages[0].height).toBe(132)
    expect(diag.pages[0].paperWidth).toBe(17)
  })

  it('a 31-wide leaf row lands on 34×22 at 1:36 with single-line labels and no problems', () => {
    const diag = new Diagram({ title: 't', creator: 'c' })
    diag.registerMaster(BOX_MASTER)
    const leaves = Array.from({ length: 31 }, (_, i) => leaf(`smart-sw-leaf${i + 1}`, i * 138, schematic))
    const spines = [spine('gx2a-spine1', 14 * 138 + 69), spine('gx2a-spine2', 15 * 138 + 69)]
    const edges: TopologyVisioEdge[] = []
    for (const s of spines) for (const l of leaves) edges.push(edge(s.id, l.id, [{ a: 'Eth1/49', b: `Eth1/${leaves.indexOf(l) + 1}` }]))
    const res = buildTopologyDiagram(
      { ...input([]), pages: [{ title: 'Wide', orientation: 'vertical', nodes: [...spines, ...leaves], edges }] },
      diag
    )
    expect(res.sheets[0]).toMatchObject({ paperWidthIn: 34, paperHeightIn: 22, drawingScale: 36, label: '34×22 in at 1:36' })
    expect(diag.pages[0].width).toBe(34 * 36)
    expect(diag.pages[0].height).toBe(22 * 36)
    // only the intentional omissions (every link is "1 × 100G" → legend, not per-line labels)
    expect(res.problems.sort()).toEqual([
      'port labels omitted on gx2a-spine1 (31 links) — see Links tab',
      'port labels omitted on gx2a-spine2 (31 links) — see Links tab'
    ])
    const page = strFromU8(unzipSync(diag.save())['visio/pages/page1.xml'])
    // hostnames stay on one line, shrunk (5pt = 0.069444 in) and within the 31 in stride
    expect(page).toContain('<Text>smart-sw-leaf31</Text>')
    const c = shapeCells(page, 'smart-sw-leaf31')
    expect(Number(c.Size)).toBeLessThan(8 / 72)
    expect(Number(c.Width)).toBeLessThanOrEqual(SCENE_TILE_W * IN_PER_PX)
    // leaf-side port labels are drawn (2 links per leaf), spine-side (Eth1/49 on every link) are not
    expect(page).toContain('<Text>Eth1/31</Text>')
    expect(page).not.toContain('<Text>Eth1/49</Text>')
    // 62 fabric links + 1 title rule + 3 legend swatches (DPU mark row)
    expect(lines(page).length).toBe(62 + 1 + 3)
  })

  it('places panels at scaled tile centres with Y flipped and spines above leaves', () => {
    const { page, res } = build()
    expect(res.problems).toEqual([])
    const s1 = shapeCells(page, 1) // first shape = spine-1 master instance
    const s2 = shapeCells(page, 'spine-2')
    const l1 = shapeCells(page, 'leaf-1')
    const spine1Label = shapeCells(page, 'spine-1')
    expect(Number(s2.PinX) - Number(spine1Label.PinX)).toBeCloseTo(138 * IN_PER_PX, 4)
    expect(Number(s1.PinX)).toBeCloseTo(Number(spine1Label.PinX), 4)
    expect(Number(s1.PinY) - Number(l1.PinY)).toBeGreaterThan(60)
    expect(Number(spine1Label.PinY)).toBeGreaterThan(Number(s1.PinY))
    const leafPanelY = Number(shapeCells(page, 'leaf-1').PinY)
    const leafGroup = /<Shape ID='(\d+)' Type='Group' LineStyle='0'/.exec(page)
    expect(leafGroup).not.toBeNull()
    expect(Number(shapeCells(page, Number(leafGroup![1])).PinY)).toBeGreaterThan(leafPanelY)
  })

  it('gives every link its own landing point on the panel edge, ordered by the far end', () => {
    const { page, res } = build()
    expect(res.problems).toEqual([])
    const s1 = shapeCells(page, 1)
    const bottom = Number(s1.PinY) - 0.85
    const sx = Number(s1.PinX)
    const fromSpine1 = lines(page).filter(([x, y]) => Math.abs(y - bottom) < 1e-6 && Math.abs(x - sx) <= 9.5)
    expect(fromSpine1.length).toBe(4)
    const xs = fromSpine1.map(([x]) => x).sort((a, b) => a - b)
    // evenly spread at 1/5 … 4/5 of the 19 in edge
    expect(xs.map((x) => x - (sx - 9.5))).toEqual([3.8, 7.6, 11.4, 15.2].map((v) => expect.closeTo(v, 4)))
    // leftmost landing goes to the leftmost leaf (no needless crossings)
    const targets = fromSpine1.sort((a, b) => a[0] - b[0]).map(([, , ex]) => ex)
    expect([...targets]).toEqual([...targets].sort((a, b) => a - b))
    // fabric blue, 1pt, solid: 8 links + 1 legend swatch
    expect((page.match(/<Cell N='LineColor' V='#0070C0'\/><Cell N='LineWeight' V='0.014'\/><Cell N='LinePattern' V='1'\/>/g) ?? []).length).toBe(9)
  })

  it('labels each end once with collapsed ports and omits them past 12 links on a device', () => {
    const { page, res } = build()
    expect(res.problems).toEqual([])
    expect(page).toContain('<Text>Eth1/1-2</Text>')
    expect(page).toContain('<Text>Eth1/7-8</Text>')
    expect((page.match(/<Text>Eth1\/49<\/Text>/g) ?? []).length).toBe(4)
    expect((page.match(/<Text>Eth1\/50<\/Text>/g) ?? []).length).toBe(4)
    // every port label sits clear of every panel (own and neighbours)
    expect(res.problems.filter((p) => p.startsWith('overlap'))).toEqual([])

    const many: TopologyVisioEdge[] = []
    for (let i = 0; i <= PORT_LABEL_MAX_PER_DEVICE; i++) many.push({ ...edge('spine-1', 'leaf-1', [{ a: `Eth1/${i + 1}`, b: 'Eth1/49' }]), id: `e${i}` })
    const big = build(many)
    expect(big.page).not.toContain('<Text>Eth1/1</Text>')
    expect(big.res.problems).toContain('port labels omitted on spine-1 (13 links) — see Links tab')
    expect(big.res.problems).toContain('port labels omitted on leaf-1 (13 links) — see Links tab')
  })

  it('prints a uniform link label once in the legend, per-line labels otherwise, none past the limit', () => {
    const uniform = build()
    expect(uniform.page).not.toContain('<Text>2 × 100G</Text>')
    expect(uniform.page).toContain('every link 2 × 100G')

    const mixed = build([edge('spine-1', 'leaf-1', [], '4 × 100G'), edge('spine-2', 'leaf-1', [], '2 × 400G')])
    expect(mixed.page).toContain('<Text>4 × 100G</Text>')
    expect(mixed.page).toContain('<Text>2 × 400G</Text>')

    const many: TopologyVisioEdge[] = []
    for (let i = 0; i <= EDGE_LABEL_MAX_EDGES; i++) many.push({ ...edge('spine-1', 'leaf-1', [], `${i} × 100G`), id: `e${i}` })
    const big = build(many)
    expect(big.page).not.toContain('<Text>7 × 100G</Text>')
    expect(big.res.problems).toContain(`link labels omitted: ${EDGE_LABEL_MAX_EDGES + 1} links exceed the ${EDGE_LABEL_MAX_EDGES}-link limit — see the Links tab`)
  })

  it('draws the title block with the sheet, legend and substitution notes', () => {
    const { page } = build()
    expect(page).toContain('<Text>Fabric 1 — devices</Text>')
    expect(page).toContain('Phase13 Test  ·  Example Customer  ·  2026-09-26  ·  DCN Designer  ·  positions from the Topology tab  ·  17×11 in at 1:12')
    expect(page).toContain('<Text>Legend</Text>')
    expect(page).toContain('Notes\nN9348Y2C6D-SE1U: no stencil master — schematic panel')
    expect(page).toContain('Cisco stencil masters · product photos · generated schematic panels')
    expect(page).toContain('<Text>DPU</Text>')
  })

  it('falls back to a schematic and reports when a master is not registered', () => {
    const diag = new Diagram({ title: 't', creator: 'c' })
    const res = buildTopologyDiagram(input([]), diag) // BOX_MASTER never registered
    expect(res.problems.filter((p) => p.includes('not registered'))).toHaveLength(2)
    const page = strFromU8(unzipSync(diag.save())['visio/pages/page1.xml'])
    expect(page).not.toContain("Master='")
  })

  it('reports links whose endpoint is missing and overlapping tiles', () => {
    const { res } = build([edge('spine-1', 'ghost')])
    expect(res.problems).toContain('link spine-1->ghost: endpoint missing on this page (ghost)')
    const diag = new Diagram({ title: 't', creator: 'c' })
    diag.registerMaster(BOX_MASTER)
    const nodes = [leaf('a', 0, schematic), leaf('b', 10, schematic)] // 10 px apart → panels overlap
    const r = buildTopologyDiagram({ ...input([]), pages: [{ title: 'O', orientation: 'vertical', nodes, edges: [] }] }, diag)
    expect(r.problems.some((p) => p.startsWith('overlap: a and b panels'))).toBe(true)
  })

  it('dashes IPN links in the accent colour', () => {
    const diag = new Diagram({ title: 't', creator: 'c' })
    diag.registerMaster(BOX_MASTER)
    const ipn: TopologyVisioNode = { ...spine('ipn-1', 200), role: 'ipn', y: -250 }
    const r = buildTopologyDiagram(
      { ...input([]), pages: [{ title: 'I', orientation: 'vertical', nodes: [ipn, spine('spine-1', 200)], edges: [edge('ipn-1', 'spine-1')] }] },
      diag
    )
    expect(r.problems).toEqual([])
    const page = strFromU8(unzipSync(diag.save())['visio/pages/page1.xml'])
    expect(page).toContain("<Cell N='LineColor' V='#B85450'/><Cell N='LineWeight' V='0.014'/><Cell N='LinePattern' V='2'/>")
  })

  it('draws a vPC peer-link as a red port-channel bundle (member lines + oval, no label), and a bracket for a pair without one', () => {
    const diag = new Diagram({ title: 't', creator: 'c' })
    diag.registerMaster(BOX_MASTER)
    const pl: TopologyVisioEdge = { ...edge('leaf-1', 'leaf-2', [{ a: 'Eth1/49', b: 'Eth1/49' }, { a: 'Eth1/50', b: 'Eth1/50' }], '2 × 400G peer-link'), kind: 'vpc-peer-link' }
    const r = buildTopologyDiagram(
      {
        ...input([]),
        pages: [
          {
            title: 'V',
            orientation: 'vertical',
            nodes: [spine('spine-1', 138), leaf('leaf-1', 0, schematic), leaf('leaf-2', 138, schematic), leaf('leaf-3', 276, schematic), leaf('leaf-4', 414, schematic)],
            edges: [edge('spine-1', 'leaf-1'), edge('spine-1', 'leaf-2'), pl],
            pairs: [{ id: 'pair-2', memberIds: ['leaf-3', 'leaf-4'], label: 'vPC pair' }]
          }
        ]
      },
      diag
    )
    expect(r.problems).toEqual([])
    const page = strFromU8(unzipSync(diag.save())['visio/pages/page1.xml'])
    // Phase 15 — port-channel symbol: one solid red line per member cable
    // (two here) plus a red ring (Ellipse geometry) around the middle.
    expect((page.match(/<Cell N='LineColor' V='#B85450'\/><Cell N='LineWeight' V='0.02'\/><Cell N='LinePattern' V='1'\/><Cell N='FillPattern' V='0'\/><Section N='Geometry' IX='0'><Row T='MoveTo'/g) ?? []).length).toBe(2)
    expect((page.match(/<Row T='Ellipse'/g) ?? []).length).toBe(1)
    expect(page).toContain("<Cell N='LineColor' V='#B85450'/><Cell N='LineWeight' V='0.016'/><Cell N='LinePattern' V='1'/><Cell N='FillPattern' V='0'/><Section N='Geometry' IX='0'><Row T='Ellipse'")
    // no text on the peer-link at all: no bundle label, no per-end port labels
    expect(page).not.toContain('peer-link ·')
    expect((page.match(/<Text>Eth1\/49-50<\/Text>/g) ?? []).length).toBe(0)
    // dashed red bracket with its label
    expect(page).toContain("<Cell N='LineColor' V='#B85450'/><Cell N='LineWeight' V='0.012'/><Cell N='LinePattern' V='2'/>")
    expect(page).toContain('<Text>vPC pair</Text>')
    expect(page).toContain('vPC peer-link — port-channel oval across the member cables (leaf ↔ leaf), red')
    expect(page).toContain('vPC pair without a peer-link (bracket)')
  })

  it('levels a peer-link whose members were dragged a few px off the row', () => {
    const diag = new Diagram({ title: 't', creator: 'c' })
    diag.registerMaster(BOX_MASTER)
    const pl: TopologyVisioEdge = { ...edge('leaf-1', 'leaf-2', [{ a: 'Eth1/49', b: 'Eth1/49' }], '400G peer-link'), kind: 'vpc-peer-link' }
    const low = { ...leaf('leaf-2', 138, schematic), y: leaf('leaf-2', 138, schematic).y + 2 }
    const r = buildTopologyDiagram(
      { ...input([]), pages: [{ title: 'V', orientation: 'vertical', nodes: [leaf('leaf-1', 0, schematic), low], edges: [pl] }] },
      diag
    )
    expect(r.problems).toEqual([])
    const page = strFromU8(unzipSync(diag.save())['visio/pages/page1.xml'])
    const m = /<Cell N='BeginX' V='([\d.]+)'\/><Cell N='BeginY' V='([\d.]+)'\/><Cell N='EndX' V='([\d.]+)'\/><Cell N='EndY' V='([\d.]+)'\/>(?:(?!<\/Shape>)[\s\S])*?LineColor' V='#B85450'\/><Cell N='LineWeight' V='0.02'/.exec(page)
    expect(m).not.toBeNull()
    // horizontal member line: same y at both ends, and it leaves the panels sideways
    expect(m![2]).toBe(m![4])
    expect(Number(m![3]) - Number(m![1])).toBeGreaterThan(0)
  })

  it('draws a server symbol as a generic box with thin NIC lines and no port labels', () => {
    const diag = new Diagram({ title: 't', creator: 'c' })
    diag.registerMaster(BOX_MASTER)
    const server: TopologyVisioNode = { id: 'server:pair-1', label: 'UCS C220 M7', sublabel: '2×25G', role: 'server', x: 69, y: 500, panel: { kind: 'server-box', ru: 1, modelId: 'UCS-C220-M7' }, smart: false, modelId: 'UCS-C220-M7' }
    const nic = (l: string): TopologyVisioEdge => ({ ...edge(l, 'server:pair-1', [{ a: 'Eth1/1', b: 'MLOM/1' }], '25G'), kind: 'server' })
    const r = buildTopologyDiagram(
      { ...input([]), pages: [{ title: 'S', orientation: 'vertical', nodes: [leaf('leaf-1', 0, schematic), leaf('leaf-2', 138, schematic), server], edges: [nic('leaf-1'), nic('leaf-2')] }] },
      diag
    )
    expect(r.problems).toEqual([])
    const page = strFromU8(unzipSync(diag.save())['visio/pages/page1.xml'])
    expect(page).toContain('<Text>UCS-C220-M7</Text>')
    expect(page).toContain("<Cell N='LineColor' V='#7F7F7F'/><Cell N='LineWeight' V='0.01'/>")
    expect(page).not.toContain('MLOM/1')
    expect(page).toContain('Server NIC (one line per NIC')
    expect(page).toContain('generic server boxes')
  })

  it('prefixes problems with the page title when there are several pages', () => {
    const diag = new Diagram({ title: 't', creator: 'c' })
    const one = input([edge('spine-1', 'ghost')])
    const r = buildTopologyDiagram({ ...one, pages: [one.pages[0], { ...one.pages[0], title: 'P2' }] }, diag)
    expect(r.pages).toHaveLength(2)
    expect(r.sheets).toHaveLength(2)
    expect(r.problems.some((p) => p.startsWith('[P2] link spine-1->ghost'))).toBe(true)
  })
})
