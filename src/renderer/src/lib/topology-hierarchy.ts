import {
  comparePortNames,
  type TopologyGraph,
  type TopologyNode,
  type TopologyRole
} from './topology-extractor'

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
}

// Partition the graph into fabrics. Spines carry `pod_index` only on
// multi-pod designs (single-pod leaves carry a *pairing* index instead,
// so leaves alone can't define a fabric). One fabric per distinct spine
// pod; leaves follow their pod_index, falling back to the first fabric.
export function buildFabrics(graph: TopologyGraph, fabricName: string): Fabric[] {
  const spines = graph.nodes.filter((n) => n.role === 'spine')
  const leaves = graph.nodes.filter((n) => n.role === 'leaf')
  const spinePods = [...new Set(spines.map((s) => s.pod_index).filter((p): p is number => p != null))]
    .sort((a, b) => a - b)

  if (spinePods.length === 0) {
    return [
      {
        id: 'fabric',
        label: fabricName || 'Fabric',
        podIndex: null,
        spineIds: spines.map((s) => s.id),
        leafIds: leaves.map((l) => l.id)
      }
    ]
  }

  const fabrics: Fabric[] = spinePods.map((pod) => ({
    id: `pod-${pod}`,
    label: `Pod ${pod + 1}`,
    podIndex: pod,
    spineIds: spines.filter((s) => s.pod_index === pod).map((s) => s.id),
    leafIds: []
  }))
  // Spines without a pod on a multi-pod design — keep them visible in pod 1.
  for (const s of spines) if (s.pod_index == null) fabrics[0].spineIds.push(s.id)
  for (const l of leaves) {
    const f = fabrics.find((x) => x.podIndex === l.pod_index) ?? fabrics[0]
    f.leafIds.push(l.id)
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

export type SceneNodeKind = 'fabric' | 'group' | 'device' | 'ipn'

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
  // Layout tier: 0 = external/IPN row, 1 = spine row, 2 = leaf row.
  tier: number
}

export interface SceneEdge {
  id: string
  source: string
  target: string
  linkIds: string[]
  count: number
  speeds: number[]
  totalG: number
  label: string
}

export interface Scene {
  level: SceneLevel
  nodes: SceneNode[]
  edges: SceneEdge[]
  breadcrumb: Array<{ label: string; level: SceneLevel }>
}

export interface SceneOptions {
  aggregate: boolean
}

export const GROUP_ID = (fabricId: string, role: 'spine' | 'leaf'): string =>
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
    sublabel: `${f.spineIds.length} spine${f.spineIds.length === 1 ? '' : 's'} · ${f.leafIds.length} lea${f.leafIds.length === 1 ? 'f' : 'ves'}`,
    role: null,
    memberIds: [...f.spineIds, ...f.leafIds],
    count: f.spineIds.length + f.leafIds.length,
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
  const groupTile = (f: Fabric, role: 'spine' | 'leaf'): SceneNode => {
    const ids = role === 'spine' ? f.spineIds : f.leafIds
    const models = [...new Set(ids.map((id) => byId.get(id)?.model_id).filter(Boolean))]
    return {
      id: GROUP_ID(f.id, role),
      kind: 'group',
      label: role === 'spine' ? 'Spines' : 'Leaves',
      sublabel: models.length === 1 ? String(models[0]) : `${models.length} models`,
      role,
      memberIds: ids,
      count: ids.length,
      status: worstStatus(ids.map((id) => statusOf.get(id) ?? 'unknown')),
      fabricId: f.id,
      device: null,
      tier: role === 'spine' ? 1 : 2
    }
  }
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
    tier: n.role === 'spine' ? 1 : 2
  })

  // Seed the nodes that always appear at this level.
  const ipns = graph.nodes.filter((n) => n.role === 'ipn')
  if (level.kind === 'fabrics') {
    for (const f of fabrics) nodes.set(f.id, fabricTile(f, 1))
    for (const n of ipns) nodes.set(n.id, ipnTile(n))
  } else if (currentFabric) {
    if (level.kind === 'fabric') {
      if (currentFabric.spineIds.length > 0)
        nodes.set(GROUP_ID(currentFabric.id, 'spine'), groupTile(currentFabric, 'spine'))
      if (currentFabric.leafIds.length > 0)
        nodes.set(GROUP_ID(currentFabric.id, 'leaf'), groupTile(currentFabric, 'leaf'))
    } else {
      for (const id of currentFabric.spineIds) {
        const n = byId.get(id)
        if (n) nodes.set(id, deviceTile(n, currentFabric))
      }
      for (const id of currentFabric.leafIds) {
        const n = byId.get(id)
        if (n) nodes.set(id, deviceTile(n, currentFabric))
      }
    }
  }

  // Where does a cable endpoint land at this level? null = not shown.
  const endpointNode = (deviceId: string): SceneNode | null => {
    const dev = byId.get(deviceId)
    if (!dev) return null
    if (dev.role === 'ipn') {
      if (!nodes.has(dev.id)) nodes.set(dev.id, ipnTile(dev))
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
      const role = dev.role === 'spine' ? 'spine' : 'leaf'
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
    const key = opts.aggregate ? `${a.id}|${b.id}` : `link:${e.id}`
    const existing = edgeMap.get(key)
    if (existing) {
      existing.linkIds.push(e.id)
      existing.count += 1
      existing.totalG += e.speed_g
      if (!existing.speeds.includes(e.speed_g)) existing.speeds.push(e.speed_g)
    } else {
      edgeMap.set(key, {
        id: key,
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

  return {
    level,
    nodes: [...nodes.values()],
    edges,
    breadcrumb: breadcrumbFor(level, fabrics)
  }
}

export function edgeLabel(e: Pick<SceneEdge, 'count' | 'speeds' | 'totalG'>): string {
  if (e.count === 1) return `${e.speeds[0]}G`
  if (e.speeds.length === 1) return `${e.count} × ${e.speeds[0]}G`
  return `${e.count} links · ${e.totalG}G`
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
// Leaf 10).
export function layoutScene(
  nodes: SceneNode[],
  orientation: Orientation = 'vertical'
): Map<string, Point> {
  const tiers = new Map<number, SceneNode[]>()
  for (const n of nodes) {
    const arr = tiers.get(n.tier) ?? []
    arr.push(n)
    tiers.set(n.tier, arr)
  }
  const tierKeys = [...tiers.keys()].sort((a, b) => a - b)
  for (const k of tierKeys) tiers.get(k)!.sort((a, b) => comparePortNames(a.label, b.label))

  const stride = TILE_W + TILE_GAP
  const widest = Math.max(0, ...tierKeys.map((k) => tiers.get(k)!.length)) * stride - TILE_GAP

  const out = new Map<string, Point>()
  tierKeys.forEach((k, rowIndex) => {
    const row = tiers.get(k)!
    const rowWidth = row.length * stride - TILE_GAP
    const offset = (widest - rowWidth) / 2
    row.forEach((n, i) => {
      const along = offset + i * stride
      const across = rowIndex * (TILE_H + TIER_GAP)
      out.set(n.id, orientation === 'vertical' ? { x: along, y: across } : { x: across, y: along })
    })
  })
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
