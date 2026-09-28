import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { unzipSync } from 'fflate'

// Phase 13 — end-to-end export against a REAL workspace (a copy of the
// production one) and a real stencil bundle, without a browser: window.dcn
// is a tiny fs-backed adapter. Skipped unless DCN_VISIO_WS names a workspace
// with library/visio/ and at least one project carrying design.yaml.
//
//   DCN_VISIO_WS=/path/to/workspace DCN_VISIO_OUT=/tmp/out npx vitest run export-visio.e2e

const WS = process.env.DCN_VISIO_WS
const OUT = process.env.DCN_VISIO_OUT ?? (WS ? join(WS, '.visio-e2e') : '')

function installFsDcn(): void {
  const dcn = {
    fileExists: async (p: string) => existsSync(p),
    readTextFile: async (p: string) => readFileSync(p, 'utf8'),
    readBinaryFile: async (p: string) => new Uint8Array(readFileSync(p)),
    readYaml: async (p: string) => parseYaml(readFileSync(p, 'utf8')) as unknown
  }
  ;(globalThis as unknown as { window: { dcn: typeof dcn } }).window = { dcn }
}

describe.skipIf(!WS)('exportTopologyVisio (real workspace)', () => {
  it('writes a .vsdx for every project with a design', async () => {
    installFsDcn()
    const { exportTopologyVisio, visioExportFileName } = await import('./export-visio')
    const { loadCableLinks, loadIpnRouters, loadLeafPairs, loadServersFile, loadSwitchesFile, loadTopologyLayout } = await import('@/lib/library-io')
    const { extractTopology } = await import('@/lib/topology-extractor')
    const { applyNicknames } = await import('@/lib/device-nickname')
    const { buildFabrics } = await import('@/lib/topology-hierarchy')
    const { serverInfoResolver } = await import('@/lib/server-symbols')

    const ws = WS!
    mkdirSync(OUT, { recursive: true })
    const projectsDir = join(ws, 'projects')
    const { readdirSync } = await import('node:fs')
    const projects = readdirSync(projectsDir).filter((d) => existsSync(join(projectsDir, d, 'design.yaml')))
    expect(projects.length).toBeGreaterThan(0)

    const switches = (await loadSwitchesFile(ws)).switches
    const ipnRouters = await loadIpnRouters(ws)
    const servers = (await loadServersFile(ws).catch(() => ({ servers: [] }))).servers
    const smart = new Set(switches.filter((s) => s.capabilities.smart_switch || s.capabilities.dpu_integrated).map((s) => s.id))

    for (const name of projects) {
      const projectPath = join(projectsDir, name)
      const requirements = parseYaml(readFileSync(join(projectPath, 'requirements.yaml'), 'utf8')) as {
        project: { name: string; customer: string }
      }
      const design = parseYaml(readFileSync(join(projectPath, 'design.yaml'), 'utf8')) as Parameters<typeof extractTopology>[0]
      const links = (await loadCableLinks(projectPath))?.links ?? []
      const layoutFile = await loadTopologyLayout(projectPath)
      const pairs = (await loadLeafPairs(projectPath).catch(() => null))?.pairs ?? null
      const graph = applyNicknames(extractTopology(design, links, pairs), smart)
      const fabrics = buildFabrics(graph, requirements.project.name)
      const generatedAt = new Date().toISOString()
      // Phase 14 — servers are forced on here so the e2e exercises the symbol
      // even when the project's checkbox is off.
      const r = await exportTopologyVisio({
        workspacePath: ws,
        projectName: requirements.project.name,
        customer: requirements.project.customer,
        generatedAt,
        graph,
        fabrics,
        layoutFile,
        switches,
        ipnRouters,
        appVersion: 'e2e',
        showServers: process.env.DCN_VISIO_SERVERS !== '0',
        serverInfo: serverInfoResolver(design, servers),
        servers
      })
      const file = join(OUT, visioExportFileName(requirements.project.name, generatedAt))
      writeFileSync(file, r.bytes)

      // Package sanity: the parts Visio insists on, one page per fabric.
      const parts = unzipSync(r.bytes)
      for (const p of ['[Content_Types].xml', '_rels/.rels', 'visio/document.xml', 'visio/pages/pages.xml', 'visio/windows.xml', 'docProps/core.xml', 'docProps/app.xml']) {
        expect(Object.keys(parts), p).toContain(p)
      }
      expect(r.pageTitles.length).toBe(fabrics.length)
      expect(r.noBundle).toBe(false)
      const pageXml = new TextDecoder().decode(parts['visio/pages/page1.xml'])
      expect(pageXml).not.toContain('<Text/>')
      // Every device is a shape: masters, images or schematic groups.
      const devices = graph.nodes.filter((n) => fabrics[0].spineIds.includes(n.id) || fabrics[0].leafIds.includes(n.id)).length
      expect((pageXml.match(/<Shape /g) ?? []).length).toBeGreaterThanOrEqual(devices)
      // Phase 14 — a design with a peer-link must export every pair's red
      // peer-link bundle (SITE-A: 2×400G on Eth1/49-50 of every SE1U pair).
      const peerLinks = links.filter((l) => l.kind === 'vpc-peer-link')
      if (design.vpc?.peer_link && (design.vpc.pairs.length ?? 0) > 0) {
        expect(peerLinks.length).toBe(design.vpc.pairs.length * design.vpc.members)
        expect(pageXml).toContain("<Cell N='LineColor' V='#B85450'/><Cell N='LineWeight' V='0.02'/>")
        expect(pageXml).toContain('peer-link')
        for (const p of design.vpc.pairs) {
          const mine = peerLinks.filter((l) => l.device_a.device_id === p.members[0] && l.device_b.device_id === p.members[1])
          expect(mine.length, `${p.id} peer-links`).toBe(design.vpc.members)
        }
      }
      if (process.env.DCN_VISIO_SERVERS !== '0') {
        expect(pageXml).toContain('Server NIC')
      }
      // eslint-disable-next-line no-console
      console.log(`[e2e] ${name}: peer-links=${peerLinks.length} pairs=${design.vpc?.pairs.length ?? 0} unpaired=${design.vpc?.unpaired.join(',') ?? ''}`)
      // eslint-disable-next-line no-console
      console.log(`[e2e] ${name}: ${file} (${r.bytes.byteLength} bytes) pages=${r.pageTitles.join(' | ')}`)
      // eslint-disable-next-line no-console
      console.log(`[e2e] substitutions:\n  ${r.substitutions.join('\n  ') || '(none)'}\n[e2e] problems:\n  ${r.problems.join('\n  ') || '(none)'}`)
    }
  }, 120_000)
})
