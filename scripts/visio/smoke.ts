#!/usr/bin/env node
// Phase 13 — smoke test for the Visio writer against a REAL stencil bundle.
//
// Writes out/smoke-topology.vsdx: 2 spines from Cisco masters, 2 leaves as
// generated schematic panels, 1 leaf from a product photo, all links, port
// labels, title block, legend and notes. Then check it:
//   python3 <skill>/scripts/preview_svg.py out/smoke-topology.vsdx   (overlaps)
//   scripts/visio/render-check.sh out/smoke-topology.vsdx           (LibreOffice)
//
// Usage: node --import ./scripts/visio/node-ts-resolver.mjs scripts/visio/smoke.ts [--assets <dir>] [--out <file>]
//   --assets  a library/visio bundle (index.json + masters/ + images/).
//             Default: $DCN_VISIO_ASSETS, else ../dcn-workspace/library/visio
//             next to the repo.
// Runs on Node ≥ 22.18 (type stripping); no bundler, so every import below is
// relative and the visio modules stay free of the `@/` alias.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Diagram, type MasterAsset } from '../../src/renderer/src/lib/visio/vsdx-writer.ts'
import {
  buildTopologyDiagram,
  type ResolvedPanel,
  type TopologyVisioEdge,
  type TopologyVisioInput,
  type TopologyVisioNode
} from '../../src/renderer/src/lib/visio/topology-visio.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const assetsDir = resolve(arg('--assets') ?? process.env.DCN_VISIO_ASSETS ?? join(repo, '..', 'dcn-workspace', 'library', 'visio'))
const outFile = resolve(arg('--out') ?? join(repo, 'out', 'smoke-topology.vsdx'))

interface IndexJson {
  schema_version: number
  masters: Record<string, { slug: string; width_in: number; height_in: number; media: string[]; png?: string }>
  aliases: Record<string, string>
  images: Record<string, string>
}

if (!existsSync(join(assetsDir, 'index.json'))) {
  console.error(`no stencil bundle at ${assetsDir} (index.json missing) — run scripts/visio/extract-masters.py first`)
  process.exit(2)
}
const index = JSON.parse(readFileSync(join(assetsDir, 'index.json'), 'utf8')) as IndexJson

function loadMaster(name: string): MasterAsset {
  const entry = index.masters[name]
  if (!entry) throw new Error(`master not in bundle: ${name}`)
  const dir = join(assetsDir, 'masters', entry.slug)
  const media: Record<string, Uint8Array> = {}
  for (const m of entry.media) media[m] = new Uint8Array(readFileSync(join(dir, 'media', m)))
  const relsPath = join(dir, 'master.xml.rels')
  return {
    name,
    entryXml: readFileSync(join(dir, 'entry.xml'), 'utf8'),
    masterXml: readFileSync(join(dir, 'master.xml'), 'utf8'),
    relsXml: existsSync(relsPath) ? readFileSync(relsPath, 'utf8') : null,
    media,
    widthIn: entry.width_in,
    heightIn: entry.height_in
  }
}

function pickMaster(preferred: string[]): string {
  for (const p of preferred) if (index.masters[p]) return p
  const first = Object.keys(index.masters)[0]
  if (!first) throw new Error('bundle has no masters')
  return first
}

const spineMaster = pickMaster(['N9K-C9364D-GX2A Front', 'N9K-C9364C-H1 Front'])
const photoModel = Object.keys(index.images)[0]
const photoPanel: ResolvedPanel | null = photoModel
  ? {
      kind: 'image',
      bytes: new Uint8Array(readFileSync(join(assetsDir, index.images[photoModel]))),
      imageKind: index.images[photoModel].toLowerCase().endsWith('.png') ? 'png' : 'jpeg',
      widthIn: 19
    }
  : null

const diag = new Diagram({ title: 'DCN Designer smoke topology', creator: 'dcn-designer smoke.ts' })
diag.registerMaster(loadMaster(spineMaster))

const schematic: ResolvedPanel = {
  kind: 'schematic',
  ru: 1,
  modelId: 'N9348Y2C6D-SE1U',
  groups: [
    { ports: 48, speedG: 25 },
    { ports: 6, speedG: 400 }
  ]
}

// Positions mirror layoutScene(): stride 138 px, tier gap 250 px, rows centred.
const nodes: TopologyVisioNode[] = [
  { id: 'gx2a-spine1', label: 'gx2a-spine1', sublabel: 'N9K-C9364D-GX2A', role: 'spine', x: 69, y: 0, panel: { kind: 'master', masterName: spineMaster }, smart: false, modelId: 'N9K-C9364D-GX2A' },
  { id: 'gx2a-spine2', label: 'gx2a-spine2', sublabel: 'N9K-C9364D-GX2A', role: 'spine', x: 207, y: 0, panel: { kind: 'master', masterName: spineMaster }, smart: false, modelId: 'N9K-C9364D-GX2A' },
  { id: 'smart-sw-leaf1', label: 'smart-sw-leaf1', sublabel: 'N9348Y2C6D-SE1U', role: 'leaf', x: 0, y: 250, panel: schematic, smart: true, modelId: 'N9348Y2C6D-SE1U' },
  { id: 'smart-sw-leaf2', label: 'smart-sw-leaf2', sublabel: 'N9348Y2C6D-SE1U', role: 'leaf', x: 138, y: 250, panel: schematic, smart: true, modelId: 'N9348Y2C6D-SE1U' },
  {
    id: 'photo-leaf3',
    label: 'photo-leaf3',
    sublabel: photoModel ?? 'N9348Y2C6D-SE1U',
    role: 'leaf',
    x: 276,
    y: 250,
    panel: photoPanel ?? schematic,
    smart: false,
    modelId: photoModel ?? 'N9348Y2C6D-SE1U'
  }
]

const edges: TopologyVisioEdge[] = []
for (const [si, s] of ['gx2a-spine1', 'gx2a-spine2'].entries()) {
  for (const [li, l] of ['smart-sw-leaf1', 'smart-sw-leaf2', 'photo-leaf3'].entries()) {
    const ports = [0, 1].map((k) => ({ a: `Eth1/${li * 2 + k + 1}`, b: `Eth1/${49 + si * 2 + k}` }))
    edges.push({ id: `${s}->${l}`, source: s, target: l, count: 2, speeds: [100], label: '2 × 100G', ports })
  }
}

const input: TopologyVisioInput = {
  projectName: 'Smoke Project',
  customer: 'Example Customer',
  generatedAt: new Date().toISOString(),
  generator: 'DCN Designer smoke.ts',
  substitutions: [
    'N9348Y2C6D-SE1U: no stencil master or photo; drawn as a schematic front panel',
    ...(photoModel ? [`${photoModel}: product photo ${index.images[photoModel]}`] : [])
  ],
  pages: [{ title: 'Topology — devices', subtitle: 'smoke fixture', nodes, edges, orientation: 'vertical' }]
}

const res = buildTopologyDiagram(input, diag)
const bytes = diag.save()
mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, bytes)
console.log(`wrote ${outFile} (${(bytes.byteLength / 1024).toFixed(0)} KB)`)
console.log(`page: ${diag.pages[0].width} × ${diag.pages[0].height} drawing in (${diag.pages[0].paperWidth} × ${diag.pages[0].paperHeight} in paper)`)
console.log(`masters: ${spineMaster}; photo: ${photoModel ?? 'none'}`)
console.log(res.problems.length ? `problems:\n  ${res.problems.join('\n  ')}` : 'problems: none')
process.exit(res.problems.length ? 1 : 0)
