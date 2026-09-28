import type { Switch } from '@/schemas/switches'
import type { Server } from '@/schemas/servers'
import type { IpnRouterFileEntry } from '@domain'
import type { TopologyLayoutFile } from '@/schemas/topology-layout'
import type { TopologyGraph } from '@/lib/topology-extractor'
import { buildScene, type Fabric, type Orientation } from '@/lib/topology-hierarchy'
import { resolveScenePositions } from '@/lib/topology-scene-positions'
import type { ServerInfoResolver } from '@/lib/server-symbols'
import { MasterStore } from './master-store'
import { resolveModel, type ModelResolution } from './resolve-model'
import { Diagram } from './vsdx-writer'
import {
  buildTopologyDiagram,
  type ResolvedPanel,
  type SchematicGroup,
  type TopologyVisioInput,
  type TopologyVisioPage
} from './topology-visio'

// Phase 13 — orchestration for "Export Visio topology".
//
// Pure pieces live elsewhere (scene → positions, scene → drawing ops); this
// module only wires I/O: open the stencil bundle, resolve every model to a
// panel, register masters, hand the writer its input, return bytes plus the
// substitution log the Export tab shows.

export interface ExportTopologyVisioArgs {
  workspacePath: string
  projectName: string
  customer: string
  generatedAt: string
  graph: TopologyGraph
  fabrics: Fabric[]
  layoutFile: TopologyLayoutFile | null
  switches: Switch[]
  ipnRouters: IpnRouterFileEntry[]
  orientation?: Orientation
  /** Application version string for the title block. */
  appVersion?: string
  // Phase 14 — draw the Topology tab's server symbols (topology_layout.yaml
  // show_servers); `servers` supplies RU for the generic box, `serverInfo`
  // the label/NIC data (see lib/server-symbols.ts).
  showServers?: boolean
  serverInfo?: ServerInfoResolver
  servers?: Server[]
}

export interface ExportTopologyVisioResult {
  bytes: Uint8Array
  /** One line per non-exact artwork choice, de-duplicated, in first-seen order. */
  substitutions: string[]
  /** Geometry problems the mapper found (links not touching, overlaps). */
  problems: string[]
  pageTitles: string[]
  /** Per page: paper size + drawing scale chosen, e.g. "34×22 in at 1:36". */
  sheets: string[]
  /** True when the stencil bundle was absent and everything is schematic. */
  noBundle: boolean
}

/** `<project>-topology-<YYYY-MM-DD>.vsdx`, filesystem-safe. */
export function visioExportFileName(projectName: string, generatedAt: string): string {
  const slug =
    projectName
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'design'
  return `${slug}-topology-${generatedAt.slice(0, 10)}.vsdx`
}

interface ModelInfo {
  hint: { master?: string | null; image?: string | null } | null
  ru: number
  groups: SchematicGroup[]
}

function portKind(speedG: number, modelId: string): SchematicGroup['kind'] {
  if (speedG <= 10 && /(TC|GC)-/.test(modelId)) return 'rj45'
  return speedG >= 40 ? 'qsfp' : 'sfp'
}

function modelInfoFrom(switches: Switch[], ipnRouters: IpnRouterFileEntry[], servers: Server[] = []): Map<string, ModelInfo> {
  const out = new Map<string, ModelInfo>()
  for (const s of servers) {
    out.set(s.id, { hint: null, ru: s.ru ?? 1, groups: [] })
  }
  for (const s of switches) {
    const groups: SchematicGroup[] = []
    for (const g of [s.primary, s.uplink, s.secondary_uplink]) {
      if (g) groups.push({ ports: g.ports, speedG: g.speed_g, kind: portKind(g.speed_g, s.id) })
    }
    out.set(s.id, { hint: s.visio ?? null, ru: s.ru ?? 1, groups })
  }
  for (const r of ipnRouters) {
    if (out.has(r.id)) continue
    out.set(r.id, {
      hint: r.visio ?? null,
      ru: r.ru ?? 1,
      groups: [{ ports: r.primary.ports, speedG: r.primary.speed_g, kind: portKind(r.primary.speed_g, r.id) }]
    })
  }
  return out
}

const UNKNOWN_GROUPS: SchematicGroup[] = [{ ports: 32, speedG: 100, kind: 'qsfp' }]

export async function exportTopologyVisio(
  args: ExportTopologyVisioArgs
): Promise<ExportTopologyVisioResult> {
  const orientation = args.orientation ?? 'vertical'
  const store = await MasterStore.open(args.workspacePath)
  const index = store?.index ?? null
  const models = modelInfoFrom(args.switches, args.ipnRouters, args.servers ?? [])
  const serverIds = new Set((args.servers ?? []).map((s) => s.id))
  const diag = new Diagram({ title: `${args.projectName} — topology`, creator: 'DCN Designer' })

  const resolutions = new Map<string, ModelResolution>()
  const panels = new Map<string, ResolvedPanel>()
  const substitutions: string[] = []
  const note = (s: string | null): void => {
    if (s && !substitutions.includes(s)) substitutions.push(s)
  }

  async function panelFor(modelId: string): Promise<ResolvedPanel> {
    const cached = panels.get(modelId)
    if (cached) return cached
    const info = models.get(modelId)
    let r = resolutions.get(modelId)
    if (!r) {
      r = resolveModel(modelId, info?.hint ?? null, index)
      resolutions.set(modelId, r)
      // Servers report their own fallback below (generic box, not a schematic
      // switch panel); the generic "server" symbol is not a substitution at all.
      if (!serverIds.has(modelId) && modelId !== 'server') note(r.note)
    }
    let panel: ResolvedPanel
    if (r.kind === 'master' && store) {
      const asset = await store.loadMaster(r.masterName)
      diag.registerMaster(asset)
      panel = { kind: 'master', masterName: r.masterName }
    } else if (r.kind === 'image' && store) {
      const img = await store.loadImage(r.imagePath)
      panel = { kind: 'image', bytes: img.bytes, imageKind: img.kind, widthIn: 19 }
    } else if (serverIds.has(modelId) || modelId === 'server') {
      // Phase 14 — no UCS master for this server model: generic box, reported.
      panel = { kind: 'server-box', modelId: modelId === 'server' ? 'Servers' : modelId, ru: info?.ru ?? 1 }
      if (modelId !== 'server') note(`${modelId}: no UCS stencil master; drawn as a generic server box`)
    } else {
      panel = {
        kind: 'schematic',
        modelId,
        ru: info?.ru ?? 1,
        groups: info?.groups.length ? info.groups : UNKNOWN_GROUPS
      }
      if (modelId === 'unknown') note('orphan device (model unknown): drawn as a generic 32×100G schematic panel')
    }
    panels.set(modelId, panel)
    return panel
  }

  const edgeById = new Map(args.graph.edges.map((e) => [e.id, e]))
  const pages: TopologyVisioPage[] = []
  const multi = args.fabrics.length > 1

  for (const fabric of args.fabrics) {
    const scene = buildScene(
      args.graph,
      args.fabrics,
      { kind: 'devices', fabricId: fabric.id },
      { aggregate: true, showServers: args.showServers, serverInfo: args.serverInfo }
    )
    // The tab's own layout (ROW_MAX 40), or the user's saved drags — never
    // re-wrapped for paper (v1.6.3): the sheet's drawing scale rises instead,
    // so the drawing keeps the shape of the expanded Topology tab.
    const { positions, custom } = resolveScenePositions(scene, args.layoutFile, orientation)
    const nodes: TopologyVisioPage['nodes'] = []
    for (const n of scene.nodes) {
      const p = positions.get(n.id) ?? { x: 0, y: 0 }
      const modelId =
        n.kind === 'server'
          ? (n.server?.modelId ?? 'server')
          : n.device?.model_id ?? (n.kind === 'ipn' ? (n.sublabel ?? 'unknown') : 'unknown')
      nodes.push({
        id: n.id,
        label: n.label,
        sublabel: n.sublabel,
        role: n.kind === 'server' ? 'server' : n.role,
        x: p.x,
        y: p.y,
        panel: await panelFor(modelId),
        smart: !!n.device?.smart,
        modelId
      })
    }
    const edges: TopologyVisioPage['edges'] = scene.edges.map((e) => ({
      id: e.id,
      kind: e.kind,
      source: e.source,
      target: e.target,
      count: e.count,
      speeds: e.speeds,
      label: e.label,
      ports: e.linkIds
        .map((id) => edgeById.get(id))
        .filter((l): l is NonNullable<typeof l> => !!l)
        .map((l) => ({ a: l.sourcePort, b: l.targetPort }))
    }))
    pages.push({
      title: multi ? `${fabric.label} — devices` : 'Topology — devices',
      subtitle: custom ? 'Positions: Topology tab (user layout)' : 'Positions: Topology tab (auto layout)',
      nodes,
      edges,
      pairs: scene.pairs.filter((p) => p.bracket).map((p) => ({ id: p.id, memberIds: p.memberIds, label: p.label })),
      orientation
    })
  }

  const input: TopologyVisioInput = {
    projectName: args.projectName,
    customer: args.customer,
    generatedAt: args.generatedAt,
    generator: `DCN Designer${args.appVersion ? ` v${args.appVersion}` : ''}`,
    pages,
    substitutions
  }
  const { problems, sheets } = buildTopologyDiagram(input, diag)
  const bytes = diag.save()
  return {
    bytes,
    substitutions,
    problems,
    pageTitles: pages.map((p) => p.title),
    sheets: sheets.map((s) => s.label),
    noBundle: !store
  }
}
