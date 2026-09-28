import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

// v1.6.3 — the design report rendered against a REAL workspace (a copy of
// the production one) without a browser, the way export-visio.e2e does it:
// window.dcn is a tiny fs-backed adapter, panel rasters come from the
// stencil bundle when the workspace has one. Skipped unless DCN_PDF_WS names
// a workspace with at least one project carrying design.yaml.
//
//   DCN_PDF_WS=/path/to/workspace DCN_PDF_OUT=/tmp/out npx vitest run DesignReport.e2e

const WS = process.env.DCN_PDF_WS
const OUT = process.env.DCN_PDF_OUT ?? (WS ? join(WS, '.pdf-e2e') : '')

function installFsDcn(): void {
  const dcn = {
    fileExists: async (p: string) => existsSync(p),
    readTextFile: async (p: string) => readFileSync(p, 'utf8'),
    readBinaryFile: async (p: string) => new Uint8Array(readFileSync(p)),
    readYaml: async (p: string) => parseYaml(readFileSync(p, 'utf8')) as unknown
  }
  ;(globalThis as unknown as { window: { dcn: typeof dcn } }).window = { dcn }
}

describe.skipIf(!WS)('DesignReport (real workspace)', () => {
  it('renders the report for every project with a design', async () => {
    installFsDcn()
    const { DesignReport } = await import('./DesignReport')
    const { exportFileName } = await import('./render')
    const { renderDocToBuffer } = await import('./report-fixture')
    const { loadPanelImages } = await import('./panel-images')
    const { loadCableLinks, loadIpnRouters, loadLeafPairs, loadServersFile, loadSwitchesFile, loadTopologyLayout } = await import('@/lib/library-io')
    const { extractTopology } = await import('@/lib/topology-extractor')
    const { applyNicknames } = await import('@/lib/device-nickname')
    const { serverInfoResolver, serverModelsIn } = await import('@/lib/server-symbols')
    const { RequirementsFileSchema: requirementsSchema } = await import('@/schemas/project')

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
      const requirements = requirementsSchema.parse(parseYaml(readFileSync(join(projectPath, 'requirements.yaml'), 'utf8')))
      const design = parseYaml(readFileSync(join(projectPath, 'design.yaml'), 'utf8')) as Parameters<typeof extractTopology>[0]
      const links = (await loadCableLinks(projectPath))?.links ?? []
      const layoutFile = await loadTopologyLayout(projectPath)
      const pairs = (await loadLeafPairs(projectPath).catch(() => null))?.pairs ?? null
      const graph = applyNicknames(extractTopology(design, links, pairs), smart)
      const serverInfo = serverInfoResolver(design, servers)
      const showServers = layoutFile?.show_servers ?? false
      const modelIds = [...graph.nodes.map((n) => n.model_id), ...(showServers ? serverModelsIn(graph, serverInfo) : [])]
      const panelImages = await loadPanelImages(ws, modelIds, switches, ipnRouters).catch(() => new Map())
      const generatedAt = new Date().toISOString()
      const buf = await renderDocToBuffer(
        DesignReport({
          requirements,
          design,
          links,
          switches,
          topology: graph,
          topologyLayout: layoutFile,
          panelImages,
          generatedAt,
          showServers,
          serverInfo
        })
      )
      expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      writeFileSync(join(OUT, exportFileName(requirements.project.name, generatedAt)), buf)
    }
  }, 120_000)
})
