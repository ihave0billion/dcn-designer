import {
  comparePortNames,
  type TopologyGraph,
  type TopologyNode,
  type TopologyRole
} from './topology-extractor'
import { nicLabel, type ServerInfoResolver } from './server-symbols'
import { OOB_MGMT_LABEL } from '@domain'

// Nexus Dashboard–style hierarchical topology (v1.1).
//
// The flat TopologyGraph (spines + leaves + IPNs, one edge per cable) is
// folded into three zoom levels, mirroring ND's "All fabrics → fabric →
// switches" drill-down:
//
//   fabrics  — one globe tile per fabric (= ACI pod, or the whole design
//              when single-pod) plus IPN routers as external nodes.
//   fabric   — inside one fabric: a stacked "Spines" tile and a stacked
//              "Leaves" tile (the user's requested intermediate step),
//              IPNs still shown as external nodes.
//   devices  — every spine and leaf of the fabric laid out in rows.
//
// Everything here is pure: given a graph + level + options, produce the
// scene (nodes, edges) and a deterministic tiered layout. The React view
// just renders what comes back.

export type HealthStatus = 'healthy' | 'warning' | 'minor' | 'major' | 'critical' | 'unknown'

const STATUS_RANK: Record<HealthStatus, number> = {
  healthy: 0,
  unknown: 1,
  warning: 2,
  minor: 3,
  major: 4,
  critical: 5
}

export function worstStatus(statuses: HealthStatus[]): HealthStatus {
  let worst: HealthStatus = 'healthy'
  for (const s of statuses) if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s
  return worst
}

// Design-health for a single device. There is no operational telemetry in
// a design tool, so status reflects what the design itself can tell us:
//   minor    — orphan: referenced by a cable link but missing from the
//              rack layout (dashed in the old view).
//   warning  — no cable links at all while peers of the same role have some.
export function deviceStatus(node: TopologyNode, graph: TopologyGraph): HealthStatus {
  if (node.model_id === 'unknown') return 'minor'
  if (node.usedPorts.length === 0) {
    const peersWired = graph.nodes.some(
      (n) => n.role === node.role && n.id !== node.id && n.usedPorts.length > 0
    )
    if (peersWired) return 'warning'
  }
  return 'healthy'
}

// ────────────────────────────────────────────────────────────────────
// Fabrics
// ────────────────────────────────────────────────────────────────────

export interface Fabric {
  id: string
  label: string
  podIndex: number | null
  spineIds: string[]
  leafIds: string[]
  // Phase 17 — Nexus Dashboard nodes attached to this fabric's leaves.
  ndIds: string[]
}

// Partition the graph into fabrics. Spines carry `pod_index` only on
// multi-pod designs (single-pod leaves carry a *pairing* index instead,
// so leaves alone can't define a fabric). One fabric per distinct spine
// pod; leaves follow their pod_index, falling back to the first fabric.
export function buildFabrics(graph: TopologyGraph, fabricName: string): Fabric[] {
  const spines = graph.nodes.filter((n) => n.role === 'spine')
  const leaves = graph.nodes.filter((n) => n.role === 'leaf')
  const nds = graph.nodes.filter((n) => n.role === 'nd')
  const spinePods = [...new Set(spines.map((s) => s.pod_index).filter((p): p is number => p != null))]
    .sort((a, b) => a - b)

  if (spinePods.length === 0) {
    return [
      {
        id: 'fabric',
        label: fabricName || 'Fabric',
        podIndex: null,
        spineIds: spines.map((s) => s.id),
        leafIds: leaves.map((l) => l.id),
        ndIds: nds.map((n) => n.id)
      }
    ]
  }

  const fabrics: Fabric[] = spinePods.map((pod) => ({
    id: `pod-${pod}`,
    label: `Pod ${pod + 1}`,
    podIndex: pod,
    spineIds: spines.filter((s) => s.pod_index === pod).map((s) => s.id),
    leafIds: [],
    ndIds: []
  }))
  // Spines without a pod on a multi-pod design — keep them visible in pod 1.
  for (const s of spines) if (s.pod_index == null) fabrics[0].spineIds.push(s.id)
  const fabricOfLeaf = new Map<string, Fabric>()
  for (const l of leaves) {
    const f = fabrics.find((x) => x.podIndex === l.pod_index) ?? fabrics[0]
    f.leafIds.push(l.id)
    fabricOfLeaf.set(l.id, f)
  }
  // Phase 17 — a Nexus Dashboard node follows the leaf its data links reach.
  for (const n of nds) {
    const e = graph.edges.find((x) => x.kind === 'nd-data' && (x.source === n.id || x.target === n.id))
    const leafId = e ? (e.source === n.id ? e.target : e.source) : null
    const f = (leafId && fabricOfLeaf.get(leafId)) || fabrics[0]
    f.ndIds.push(n.id)
  }
  return fabrics
}

// ────────────────────────────────────────────────────────────────────
// Scene
// ────────────────────────────────────────────────────────────────────

export type SceneLevel =
  | { kind: 'fabrics' }
  | { kind: 'fabric'; fabricId: string }
  | { kind: 'devices'; fabricId: string }

// Phase 14 adds 'server': the "Show servers" symbol under a leaf or a vPC pair.
// Phase 17 adds 'cloud': the OOB-management network outside the design.
export type SceneNodeKind = 'fabric' | 'group' | 'device' | 'ipn' | 'server' | 'cloud'

// Phase 14 — the server symbol's payload (decision 7/8).
export interface SceneServer {
  /** Leaves the symbol hangs from — two for a vPC pair, one otherwise. */
  leafIds: string[]
  /** servers.yaml id, or null for the generic symbol. */
  modelId: string | null
  /** True when the symbol stands for dual-attached hosts (a vPC pair). */
  dual: boolean
  nicSpeedG: number | null
  ru: number
}

export interface SceneNode {
  id: string
  kind: SceneNodeKind
  label: string
  sublabel: string | null
  role: TopologyRole | null
  // Devices folded into this tile (1 for a device / IPN).
  memberIds: string[]
  count: number
  status: HealthStatus
  fabricId: string | null
  device: TopologyNode | null
  // Layout tier: 0 = external/IPN row, 1 = spine row, 2 = leaf row, 3 = servers.
  tier: number
  // Phase 14 — server symbols sort under their leaves rather than by label.
  sortKey?: string
  server?: SceneServer
  // Phase 17 — tiles that are not row-packed but centred under other tiles
  // (ND nodes under their attach leaves, the OOB cloud under the ND nodes).
  anchorIds?: string[]
}

// Phase 14 — how an edge is drawn: fabric links (spine↔leaf), inter-pod
// links (dashed), vPC peer-links (red) and server lines (thin, one per NIC).
// Phase 17 — Nexus Dashboard data links (solid, link colour) and management
// links (dashed, muted).
export type SceneEdgeKind = 'fabric' | 'ipn' | 'vpc-peer-link' | 'server' | 'nd-data' | 'nd-mgmt'

export interface SceneEdge {
  id: string
  kind: SceneEdgeKind
  source: string
  target: string
  linkIds: string[]
  count: number
  speeds: number[]
  totalG: number
  label: string
}

// Phase 14 — a vPC pair at the device level. `bracket` is true when the
// pair has no peer-link drawn between its members (ACI, or the peer-link
// switched off) so the renderer joins them with a bracket instead.
export interface ScenePair {
  id: string
  // Phase 17 — 'nd' is the Nexus Dashboard cluster bracket (always drawn).
  kind: 'vpc' | 'nd'
  memberIds: string[]
  label: string
  bracket: boolean
}

export interface Scene {
  level: SceneLevel
  nodes: SceneNode[]
  edges: SceneEdge[]
  pairs: ScenePair[]
  breadcrumb: Array<{ label: string; level: SceneLevel }>
}

export interface SceneOptions {
  aggregate: boolean
  // Phase 14 — draw one server symbol per leaf / per vPC pair (device level).
  showServers?: boolean
  serverInfo?: ServerInfoResolver
}

export const SERVER_NODE_ID = (key: string): string => `server:${key}`

export const GROUP_ID = (fabricId: string, role: 'spine' | 'leaf' | 'nd'): string =>
  `group:${fabricId}:${role}`

export function buildScene(
  graph: TopologyGraph,
  fabrics: Fabric[],
  level: SceneLevel,
  opts: SceneOptions
): Scene {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const fabricOf = new Map<string, Fabric>()
  for (const f of fabrics) {
    for (const id of f.spineIds) fabricOf.set(id, f)
    for (const id of f.leafIds) fabricOf.set(id, f)
    for (const id of f.ndIds) fabricOf.set(id, f)
  }
  const statusOf = new Map(graph.nodes.map((n) => [n.id, deviceStatus(n, graph)]))
  const fabricStatus = (f: Fabric): HealthStatus =>
    worstStatus([...f.spineIds, ...f.leafIds].map((id) => statusOf.get(id) ?? 'unknown'))

  const nodes = new Map<string, SceneNode>()
  const currentFabricId = level.kind === 'fabrics' ? null : level.fabricId
  const currentFabric = fabrics.find((f) => f.id === currentFabricId) ?? null

  const fabricTile = (f: Fabric, tier: number): SceneNode => ({
    id: f.id,
    kind: 'fabric',
    label: f.label,
    sublabel:
      `${f.spineIds.length} spine${f.spineIds.length === 1 ? '' : 's'} · ${f.leafIds.length} lea${f.leafIds.length === 1 ? 'f' : 'ves'}` +
      (f.ndIds.length ? ` · ND ×${f.ndIds.length}` : ''),
    role: null,
    memberIds: [...f.spineIds, ...f.leafIds, ...f.ndIds],
    count: f.spineIds.length + f.leafIds.length + f.ndIds.length,
    status: fabricStatus(f),
    fabricId: f.id,
    device: null,
    tier
  })
  const ipnTile = (n: TopologyNode): SceneNode => ({
    id: n.id,
    kind: 'ipn',
    label: n.label,
    sublabel: n.model_id,
    role: 'ipn',
    memberIds: [n.id],
    count: 1,
    status: statusOf.get(n.id) ?? 'unknown',
    fabricId: null,
    device: n,
    tier: 0
  })
  const groupTile = (f: Fabric, role: 'spine' | 'leaf' | 'nd'): SceneNode => {
    const ids = role === 'spine' ? f.spineIds : role === 'leaf' ? f.leafIds : f.ndIds
    const models = [...new Set(ids.map((id) => byId.get(id)?.model_id).filter(Boolean))]
    return {
      id: GROUP_ID(f.id, role),
      kind: 'group',
      label: role === 'spine' ? 'Spines' : role === 'leaf' ? 'Leaves' : 'Nexus Dashboard',
      sublabel: models.length === 1 ? String(models[0]) : `${models.length} models`,
      role,
      memberIds: ids,
      count: ids.length,
      status: worstStatus(ids.map((id) => statusOf.get(id) ?? 'unknown')),
      fabricId: f.id,
      device: null,
      tier: role === 'spine' ? 1 : role === 'leaf' ? 2 : 3
    }
  }
  // Phase 17 — ND node tiles sit centred under the leaves their data links reach.
  const ndAnchors = (graph.nexusDashboard?.data_leaf_ids ?? []).filter((id, i, arr) => arr.indexOf(id) === i)
  const deviceTile = (n: TopologyNode, f: Fabric): SceneNode => ({
    id: n.id,
    kind: 'device',
    label: n.label,
    sublabel: n.model_id,
    role: n.role,
    memberIds: [n.id],
    count: 1,
    status: statusOf.get(n.id) ?? 'unknown',
    fabricId: f.id,
    device: n,
    tier: n.role === 'spine' ? 1 : n.role === 'nd' ? 3 : 2,
    ...(n.role === 'nd' && ndAnchors.length ? { anchorIds: ndAnchors } : {})
  })
  // Phase 17 — the OOB-management cloud: external at the fabrics level (under
  // the globe), under the ND nodes otherwise.
  const cloudTile = (n: TopologyNode): SceneNode => ({
    id: n.id,
    kind: 'cloud',
    label: n.label || OOB_MGMT_LABEL,
    sublabel: 'outside this design',
    role: 'oob',
    memberIds: [n.id],
    count: 1,
    status: 'healthy',
    fabricId: null,
    device: n,
    tier: level.kind === 'fabrics' ? 2 : 4,
    ...(level.kind === 'devices' && currentFabric?.ndIds.length ? { anchorIds: [...currentFabric.ndIds] } : {})
  })

  // Seed the nodes that always appear at this level.
  const ipns = graph.nodes.filter((n) => n.role === 'ipn')
  const clouds = graph.nodes.filter((n) => n.role === 'oob')
  if (level.kind === 'fabrics') {
    for (const f of fabrics) nodes.set(f.id, fabricTile(f, 1))
    for (const n of ipns) nodes.set(n.id, ipnTile(n))
  } else if (currentFabric) {
    if (level.kind === 'fabric') {
      if (currentFabric.spineIds.length > 0)
        nodes.set(GROUP_ID(currentFabric.id, 'spine'), groupTile(currentFabric, 'spine'))
      if (currentFabric.leafIds.length > 0)
        nodes.set(GROUP_ID(currentFabric.id, 'leaf'), groupTile(currentFabric, 'leaf'))
      if (currentFabric.ndIds.length > 0)
        nodes.set(GROUP_ID(currentFabric.id, 'nd'), groupTile(currentFabric, 'nd'))
    } else {
      for (const id of [...currentFabric.spineIds, ...currentFabric.leafIds, ...currentFabric.ndIds]) {
        const n = byId.get(id)
        if (n) nodes.set(id, deviceTile(n, currentFabric))
      }
    }
  }
  // Phase 17 — the OOB cloud is always visible when the design has one.
  for (const n of clouds) nodes.set(n.id, cloudTile(n))

  // Where does a cable endpoint land at this level? null = not shown.
  const endpointNode = (deviceId: string): SceneNode | null => {
    const dev = byId.get(deviceId)
    if (!dev) return null
    if (dev.role === 'ipn') {
      if (!nodes.has(dev.id)) nodes.set(dev.id, ipnTile(dev))
      return nodes.get(dev.id)!
    }
    if (dev.role === 'oob') {
      if (!nodes.has(dev.id)) nodes.set(dev.id, cloudTile(dev))
      return nodes.get(dev.id)!
    }
    const f = fabricOf.get(deviceId)
    if (!f) return null
    if (level.kind === 'fabrics') return nodes.get(f.id) ?? null
    if (f.id !== currentFabricId) {
      // Another fabric, reached through a cable — show it as an external
      // globe so the link has somewhere to land (ND does the same).
      if (!nodes.has(f.id)) nodes.set(f.id, fabricTile(f, 0))
      return nodes.get(f.id)!
    }
    if (level.kind === 'fabric') {
      const role = dev.role === 'spine' ? 'spine' : dev.role === 'nd' ? 'nd' : 'leaf'
      return nodes.get(GROUP_ID(f.id, role)) ?? null
    }
    return nodes.get(dev.id) ?? null
  }

  const edgeMap = new Map<string, SceneEdge>()
  for (const e of graph.edges) {
    const s = endpointNode(e.source)
    const t = endpointNode(e.target)
    if (!s || !t || s.id === t.id) continue
    // Normalise direction so spine→leaf, ipn→spine, ipn→fabric read top-down.
    const [a, b] = s.tier <= t.tier ? [s, t] : [t, s]
    const kind: SceneEdgeKind =
      e.kind === 'vpc-peer-link'
        ? 'vpc-peer-link'
        : e.kind === 'nd-data' || e.kind === 'nd-mgmt'
          ? e.kind
          : s.role === 'ipn' || t.role === 'ipn'
            ? 'ipn'
            : 'fabric'
    const key = opts.aggregate ? `${a.id}|${b.id}|${kind}` : `link:${e.id}`
    const existing = edgeMap.get(key)
    if (existing) {
      existing.linkIds.push(e.id)
      existing.count += 1
      existing.totalG += e.speed_g
      if (!existing.speeds.includes(e.speed_g)) existing.speeds.push(e.speed_g)
    } else {
      edgeMap.set(key, {
        id: key,
        kind,
        source: a.id,
        target: b.id,
        linkIds: [e.id],
        count: 1,
        speeds: [e.speed_g],
        totalG: e.speed_g,
        label: ''
      })
    }
  }
  const edges = [...edgeMap.values()].map((e) => ({ ...e, label: edgeLabel(e) }))

  // ── Phase 14: vPC pairs + server symbols (device level only) ──────
  const pairs: ScenePair[] = []
  if (level.kind === 'devices') {
    const peerLinked = new Set<string>()
    for (const e of edges) {
      if (e.kind === 'vpc-peer-link') peerLinked.add(`${e.source}|${e.target}`).add(`${e.target}|${e.source}`)
    }
    for (const p of graph.pairs ?? []) {
      if (!nodes.has(p.members[0]) || !nodes.has(p.members[1])) continue
      pairs.push({
        id: p.id,
        kind: 'vpc',
        memberIds: [...p.members],
        label: 'vPC pair',
        bracket: !peerLinked.has(`${p.members[0]}|${p.members[1]}`)
      })
    }
    // Phase 17 — the Nexus Dashboard cluster bracket around its node tiles.
    const ndTiles = [...nodes.values()].filter((n) => n.kind === 'device' && n.role === 'nd')
    if (ndTiles.length > 0) {
      pairs.push({
        id: 'nd-cluster',
        kind: 'nd',
        memberIds: ndTiles.map((n) => n.id),
        label: graph.nexusDashboard?.cluster_model_id ?? 'Nexus Dashboard',
        bracket: true
      })
    }

    if (opts.showServers && opts.serverInfo) {
      const seen = new Set<string>()
      const leafTiles = [...nodes.values()].filter((n) => n.kind === 'device' && n.role === 'leaf')
      for (const tile of leafTiles) {
        if (seen.has(tile.id)) continue
        const pair = pairs.find((p) => p.memberIds.includes(tile.id)) ?? null
        const leafIds = pair ? pair.memberIds : [tile.id]
        for (const id of leafIds) seen.add(id)
        const info = opts.serverInfo(tile.device ?? { id: tile.id, model_id: tile.sublabel ?? 'unknown' })
        if (!info) continue
        const dual = leafIds.length === 2
        const sid = SERVER_NODE_ID(pair ? pair.id : tile.id)
        const members = leafIds.map((id) => nodes.get(id)!)
        nodes.set(sid, {
          id: sid,
          kind: 'server',
          label: info.label,
          sublabel: nicLabel(info, dual),
          role: null,
          memberIds: leafIds,
          count: 1,
          status: 'healthy',
          fabricId: currentFabricId,
          device: null,
          tier: 3,
          sortKey: members.map((m) => m.label).sort(comparePortNames)[0],
          server: { leafIds, modelId: info.model_id, dual, nicSpeedG: info.nic_speed_g, ru: info.ru }
        })
        // One line per NIC (decision 8): to each leaf of a pair, or `nics`
        // lines to the single leaf. Never aggregated — the fan IS the message.
        const lines = dual ? leafIds.map((id) => ({ leaf: id, k: 0 })) : Array.from({ length: Math.max(1, Math.min(4, info.nics)) }, (_, k) => ({ leaf: leafIds[0], k }))
        for (const l of lines) {
          const speed = info.nic_speed_g ?? 0
          edges.push({
            id: `${sid}|${l.leaf}|${l.k}`,
            kind: 'server',
            source: l.leaf,
            target: sid,
            linkIds: [],
            count: 1,
            speeds: speed ? [speed] : [],
            totalG: speed,
            label: speed ? `${speed}G` : ''
          })
        }
      }
    }
  }

  return {
    level,
    nodes: [...nodes.values()],
    edges,
    pairs,
    breadcrumb: breadcrumbFor(level, fabrics)
  }
}

export function edgeLabel(e: Pick<SceneEdge, 'count' | 'speeds' | 'totalG'> & { kind?: SceneEdgeKind }): string {
  const base = e.count === 1 ? `${e.speeds[0]}G` : e.speeds.length === 1 ? `${e.count} × ${e.speeds[0]}G` : `${e.count} links · ${e.totalG}G`
  return e.kind === 'vpc-peer-link' ? `${base} peer-link` : e.kind === 'nd-mgmt' ? `${base} mgmt` : base
}

function breadcrumbFor(level: SceneLevel, fabrics: Fabric[]): Scene['breadcrumb'] {
  const crumbs: Scene['breadcrumb'] = [{ label: 'All fabrics', level: { kind: 'fabrics' } }]
  if (level.kind === 'fabrics') return crumbs
  const f = fabrics.find((x) => x.id === level.fabricId)
  crumbs.push({ label: f?.label ?? level.fabricId, level: { kind: 'fabric', fabricId: level.fabricId } })
  if (level.kind === 'devices') {
    crumbs.push({ label: 'Switches', level: { kind: 'devices', fabricId: level.fabricId } })
  }
  return crumbs
}

// What double-clicking a tile does. Returns the next level, or null when
// the tile is already fully expanded (a device / IPN).
export function drillInto(node: SceneNode, level: SceneLevel): SceneLevel | null {
  if (node.kind === 'fabric' && node.fabricId) return { kind: 'fabric', fabricId: node.fabricId }
  if (node.kind === 'group' && node.fabricId) return { kind: 'devices', fabricId: node.fabricId }
  void level
  return null
}

export function parentLevel(level: SceneLevel): SceneLevel | null {
  if (level.kind === 'fabrics') return null
  if (level.kind === 'fabric') return { kind: 'fabrics' }
  return { kind: 'fabric', fabricId: level.fabricId }
}

// Stable key for a level — used to store per-level positions.
export function levelKey(level: SceneLevel): string {
  if (level.kind === 'fabrics') return 'fabrics'
  return `${level.kind}:${level.fabricId}`
}

export function sameLevel(a: SceneLevel, b: SceneLevel): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'fabrics') return true
  return (a as { fabricId: string }).fabricId === (b as { fabricId: string }).fabricId
}

// ────────────────────────────────────────────────────────────────────
// Layout — deterministic tiers, no solver needed
// ────────────────────────────────────────────────────────────────────

export type Orientation = 'vertical' | 'horizontal'

// Tile footprint used by both the layout and the renderer. Width covers
// the label pill under the 56px icon tile.
export const TILE_W = 124
export const TILE_H = 100
export const TILE_GAP = 14
export const TIER_GAP = 150

export interface Point {
  x: number
  y: number
}

// Rows by tier, each centred on the widest row; columns instead when
// horizontal. Items in a row follow natural label order (Leaf 2 before
// Leaf 10). A tier with more than ROW_MAX tiles wraps into balanced rows
// (45 leaves → 23 + 22) so very wide fabrics stay readable.
//
// Phase 14: the two leaves of a vPC pair never straddle a row break (their
// peer-link would otherwise cross the whole page), and a server symbol is
// not row-packed at all — it sits centred under the leaf / pair it hangs
// from, one tier gap below that leaf row.
export const ROW_MAX = 40

// Units that must share a row: a vPC pair when its two tiles are adjacent in
// sort order, else single tiles.
function rowUnits(sorted: SceneNode[]): SceneNode[][] {
  const units: SceneNode[][] = []
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    const pa = a.device?.pair_id ?? null
    if (pa && b && b.device?.pair_id === pa) {
      units.push([a, b])
      i += 1
    } else units.push([a])
  }
  return units
}

function chunkBalanced(items: SceneNode[], max: number): SceneNode[][] {
  if (items.length <= max) return [items]
  const rows = Math.ceil(items.length / max)
  const per = Math.ceil(items.length / rows)
  const out: SceneNode[][] = []
  let row: SceneNode[] = []
  for (const unit of rowUnits(items)) {
    if (row.length > 0 && row.length + unit.length > per) {
      out.push(row)
      row = []
    }
    row.push(...unit)
  }
  if (row.length > 0) out.push(row)
  return out
}

export function layoutScene(
  nodes: SceneNode[],
  orientation: Orientation = 'vertical',
  // Phase 13 — print wants narrower rows than the canvas (a 31-wide row is a
  // thin strip on Letter); the tab keeps the default.
  rowMax: number = ROW_MAX
): Map<string, Point> {
  const tiers = new Map<number, SceneNode[]>()
  const servers: SceneNode[] = []
  // Phase 17 — anchored tiles (ND nodes, the OOB cloud) are centred under
  // their anchors in their own slot instead of being row-packed.
  const anchored: SceneNode[] = []
  for (const n of nodes) {
    if (n.kind === 'server' && n.server) {
      servers.push(n)
      continue
    }
    if (n.anchorIds && n.anchorIds.length > 0) {
      anchored.push(n)
      continue
    }
    const arr = tiers.get(n.tier) ?? []
    arr.push(n)
    tiers.set(n.tier, arr)
  }
  const tierKeys = [...tiers.keys()].sort((a, b) => a - b)
  const rows: SceneNode[][] = []
  for (const k of tierKeys) {
    const sorted = tiers.get(k)!.sort((a, b) => comparePortNames(a.sortKey ?? a.label, b.sortKey ?? b.label))
    rows.push(...chunkBalanced(sorted, rowMax))
  }

  const stride = TILE_W + TILE_GAP
  const widest = Math.max(0, ...rows.map((r) => r.length)) * stride - TILE_GAP

  // Which row each tile sits in, and which rows have servers hanging from
  // them (a server anchors to the lowest row of its leaves). A row with
  // servers gets its own server slot right below it, so wrapped leaf rows
  // never collide with the symbols of the row above.
  const rowOf = new Map<string, number>()
  rows.forEach((row, i) => row.forEach((n) => rowOf.set(n.id, i)))
  const serverRow = new Map<string, number>()
  const rowsWithServers = new Set<number>()
  for (const s of servers) {
    const anchorRows = s.server!.leafIds.map((id) => rowOf.get(id)).filter((r): r is number => r != null)
    const r = anchorRows.length ? Math.max(...anchorRows) : rows.length - 1
    serverRow.set(s.id, r)
    rowsWithServers.add(r)
  }
  const slotOf: number[] = []
  const serverSlotOf = new Map<number, number>()
  let slot = 0
  rows.forEach((_, i) => {
    slotOf[i] = slot++
    if (rowsWithServers.has(i)) serverSlotOf.set(i, slot++)
  })

  // Row-local coordinates: `along` runs across the row, `across` down the tiers.
  const local = new Map<string, { along: number; across: number }>()
  rows.forEach((row, rowIndex) => {
    const rowWidth = row.length * stride - TILE_GAP
    const offset = (widest - rowWidth) / 2
    row.forEach((n, i) => {
      local.set(n.id, { along: offset + i * stride, across: slotOf[rowIndex] * (TILE_H + TIER_GAP) })
    })
  })
  // Servers: centred under their leaves, in the server slot of their row.
  for (const s of servers) {
    const anchors = s.server!.leafIds.map((id) => local.get(id)).filter((p): p is NonNullable<typeof p> => !!p)
    const r = serverRow.get(s.id) ?? rows.length - 1
    const across = (serverSlotOf.get(r) ?? slot) * (TILE_H + TIER_GAP)
    local.set(s.id, {
      along: anchors.length ? anchors.reduce((a, p) => a + p.along, 0) / anchors.length : 0,
      across
    })
  }

  // Anchored tiles: one slot per tier below everything else; a tier's tiles
  // sit side by side, centred on the mean position of their anchors (lower
  // tiers first so the cloud can anchor to the ND row).
  const anchorTiers = [...new Set(anchored.map((n) => n.tier))].sort((a, b) => a - b)
  for (const t of anchorTiers) {
    const group = anchored.filter((n) => n.tier === t).sort((a, b) => comparePortNames(a.sortKey ?? a.label, b.sortKey ?? b.label))
    const across = slot++ * (TILE_H + TIER_GAP)
    const pts = group.flatMap((n) => n.anchorIds!.map((id) => local.get(id)).filter((p): p is NonNullable<typeof p> => !!p))
    const centre = pts.length ? pts.reduce((a, p) => a + p.along, 0) / pts.length : Math.max(0, widest - TILE_W) / 2
    const groupWidth = group.length * stride - TILE_GAP
    // `centre` is a mean of tile LEFT edges; the group's own centre sits at centre + TILE_W / 2.
    group.forEach((n, i) => local.set(n.id, { along: centre + TILE_W / 2 - groupWidth / 2 + i * stride, across }))
  }

  const out = new Map<string, Point>()
  for (const [id, p] of local) {
    out.set(id, orientation === 'vertical' ? { x: p.along, y: p.across } : { x: p.across, y: p.along })
  }
  return out
}

// ────────────────────────────────────────────────────────────────────
// Filter by attributes — "model=N9K-C93; rack contains R1; leaf 3"
// ────────────────────────────────────────────────────────────────────

export type FilterOp = '=' | '!=' | 'contains' | '!contains'

export interface FilterClause {
  attr: string
  op: FilterOp
  value: string
}

const FILTER_ATTRS = ['name', 'model', 'rack', 'role', 'id', 'pod', 'ports'] as const
export type FilterAttr = (typeof FILTER_ATTRS)[number]

export function parseFilter(text: string): FilterClause[] {
  const clauses: FilterClause[] = []
  for (const raw of text.split(/[;,]/)) {
    const part = raw.trim()
    if (!part) continue
    const m =
      /^([a-zA-Z]+)\s*(!=|=|!contains|contains)\s*(.+)$/.exec(part) ??
      /^([a-zA-Z]+)\s+(!contains|contains)\s+(.+)$/.exec(part)
    if (m && (FILTER_ATTRS as readonly string[]).includes(m[1].toLowerCase())) {
      clauses.push({ attr: m[1].toLowerCase(), op: m[2] as FilterOp, value: m[3].trim() })
    } else {
      clauses.push({ attr: 'name', op: 'contains', value: part })
    }
  }
  return clauses
}

function attrValue(n: TopologyNode, attr: string): string {
  switch (attr) {
    case 'name':
      return n.label
    case 'model':
      return n.model_id
    case 'rack':
      return n.rack ?? ''
    case 'role':
      return n.role
    case 'id':
      return n.id
    case 'pod':
      return n.pod_index == null ? '' : String(n.pod_index + 1)
    case 'ports':
      return String(n.usedPorts.length)
    default:
      return ''
  }
}

export function matchesFilter(n: TopologyNode, clauses: FilterClause[]): boolean {
  for (const c of clauses) {
    const v = attrValue(n, c.attr).toLowerCase()
    const want = c.value.toLowerCase()
    const eq = v === want
    const has = v.includes(want)
    if (c.op === '=' && !eq) return false
    if (c.op === '!=' && eq) return false
    if (c.op === 'contains' && !has) return false
    if (c.op === '!contains' && has) return false
  }
  return true
}
