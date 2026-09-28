import type {
  NexusDashboardRequest,
  NexusDashboardResult,
  RackPlacement,
  SolverWarning,
  TierResult,
  VpcPair
} from './types'

// Phase 17 — Cisco Nexus Dashboard physical cluster (v1.7.0).
//
// The two orderable cluster PIDs are a code catalogue rather than
// servers.yaml entries: they must never show up in a tier's server-model
// dropdown, and existing workspaces do not re-copy library seeds. Figures
// come from the ND 4.x deployment guide / hardware setup guide:
//   • data network  = 2 of the VIC's 4 × 10/25/50G ports (fabric0, fabric1),
//     Linux bond0 active-standby, one cable to each leaf of a pair;
//   • management    = mgmt0 + mgmt1 (mLOM), bond1 active-standby, 1G or 10G;
//   • a cluster PID ships 3 nodes; a 1-node cluster is also supported.

export type NdClusterModelId = 'ND-CLUSTER-G5S' | 'ND-CLUSTER-G5L'

export interface NdClusterSpec {
  cluster_model_id: NdClusterModelId
  node_model_id: string
  display: string
  /** Rack units per node. */
  ru: number
  /** Estimated draw per node in W (dual 1200 W PSUs; no datasheet typical figure). */
  power_w: number
  /** Nodes shipped under the cluster PID. */
  nodes: number
  /** Node-side data port names (bond0 members), in cabling order. */
  data_ports: [string, string]
  /** Node-side management port names (bond1 members). */
  mgmt_ports: [string, string]
  data_speeds_g: readonly number[]
  mgmt_speeds_g: readonly number[]
  /** Transceiver form factor hints for the optics BOM. */
  data_optic_hint: string
  mgmt_optic_hint: Record<number, string>
}

export const ND_DATA_PORTS: [string, string] = ['fabric0', 'fabric1']
export const ND_MGMT_PORTS: [string, string] = ['mgmt0', 'mgmt1']
export const ND_DATA_SPEEDS_G = [10, 25, 50] as const
export const ND_MGMT_SPEEDS_G = [1, 10] as const
export const ND_DEFAULT_NODE_COUNT = 3
/** Per-node power used for rack PDU math and the BOM (estimate, flagged as such). */
export const ND_NODE_POWER_W = 600
export const ND_DEFAULT_DATA_SPEED_G = 25
export const ND_DEFAULT_MGMT_SPEED_G = 10
/** Reserved device id of the OOB-management cloud endpoint (no OOB tier in the design). */
export const OOB_MGMT_DEVICE_ID = 'oob-mgmt'
export const OOB_MGMT_LABEL = 'OOB management network'
/** Port name used on the cloud end of a management cable. */
export const OOB_MGMT_PORT = 'OOB'

const MGMT_HINTS: Record<number, string> = { 1: 'SFP (1G)', 10: 'SFP+ (10G)' }

export const ND_CLUSTERS: Record<NdClusterModelId, NdClusterSpec> = {
  'ND-CLUSTER-G5S': {
    cluster_model_id: 'ND-CLUSTER-G5S',
    node_model_id: 'ND-NODE-G5S',
    display: 'Nexus Dashboard cluster, Gen 5 small (3 × ND-NODE-G5S, 1RU)',
    ru: 1,
    power_w: ND_NODE_POWER_W,
    nodes: 3,
    data_ports: ND_DATA_PORTS,
    mgmt_ports: ND_MGMT_PORTS,
    data_speeds_g: ND_DATA_SPEEDS_G,
    mgmt_speeds_g: ND_MGMT_SPEEDS_G,
    data_optic_hint: 'SFP28 (VIC 10/25/50G)',
    mgmt_optic_hint: MGMT_HINTS
  },
  'ND-CLUSTER-G5L': {
    cluster_model_id: 'ND-CLUSTER-G5L',
    node_model_id: 'ND-NODE-G5L',
    display: 'Nexus Dashboard cluster, Gen 5 large (3 × ND-NODE-G5L, 2RU)',
    ru: 2,
    power_w: ND_NODE_POWER_W,
    nodes: 3,
    data_ports: ND_DATA_PORTS,
    mgmt_ports: ND_MGMT_PORTS,
    data_speeds_g: ND_DATA_SPEEDS_G,
    mgmt_speeds_g: ND_MGMT_SPEEDS_G,
    data_optic_hint: 'SFP28 (VIC 10/25/50G)',
    mgmt_optic_hint: MGMT_HINTS
  }
}

export const ND_CLUSTER_IDS: NdClusterModelId[] = ['ND-CLUSTER-G5S', 'ND-CLUSTER-G5L']

export function isNdClusterModelId(id: string | null | undefined): id is NdClusterModelId {
  return id === 'ND-CLUSTER-G5S' || id === 'ND-CLUSTER-G5L'
}

/** Catalogue entry for a cluster PID or a node PID; null when neither. */
export function ndSpecFor(modelId: string | null | undefined): NdClusterSpec | null {
  if (!modelId) return null
  if (isNdClusterModelId(modelId)) return ND_CLUSTERS[modelId]
  return ND_CLUSTER_IDS.map((id) => ND_CLUSTERS[id]).find((s) => s.node_model_id === modelId) ?? null
}

export const ND_DEVICE_ID = (index: number): string => `nd-${index}`

export interface PlanNexusDashboardInput {
  request: NexusDashboardRequest | null | undefined
  tiers: TierResult[]
  /** The solver's pairing (pair ids follow the leaf numbering). */
  pairs: VpcPair[]
}

export interface PlanNexusDashboardOutput {
  result: NexusDashboardResult | null
  warnings: SolverWarning[]
}

// Leaf ids of a tier, in the `leaf-N` numbering placeRacks / the topology use.
function leafIdsByTier(tiers: TierResult[]): Map<TierResult, string[]> {
  const out = new Map<TierResult, string[]>()
  let serial = 0
  for (const t of tiers) {
    if (t.xor_status !== 'ok' || t.leaves_required <= 0) continue
    const ids: string[] = []
    for (let i = 0; i < t.leaves_required; i++) {
      serial += 1
      ids.push(`leaf-${serial}`)
    }
    out.set(t, ids)
  }
  return out
}

// Two attachment leaves for a set of tiers: the first pair whose members are
// in one of the tiers, else the tier's first two leaves, else its single
// leaf twice. Null when the tiers hold no leaves at all.
function attachLeaves(
  tiers: TierResult[],
  leafIds: Map<TierResult, string[]>,
  pairs: VpcPair[],
  preferredPairId: string | null
): { leaves: [string, string]; pair_id: string | null } | null {
  const ids = new Set(tiers.flatMap((t) => leafIds.get(t) ?? []))
  if (ids.size === 0) return null
  if (preferredPairId) {
    const p = pairs.find((x) => x.id === preferredPairId)
    if (p && p.members.every((m) => ids.has(m))) return { leaves: [p.members[0], p.members[1]], pair_id: p.id }
  }
  const first = pairs.find((p) => p.members.every((m) => ids.has(m)))
  if (first) return { leaves: [first.members[0], first.members[1]], pair_id: first.id }
  const ordered = tiers.flatMap((t) => leafIds.get(t) ?? [])
  return { leaves: [ordered[0], ordered[1] ?? ordered[0]], pair_id: null }
}

export function planNexusDashboard({ request, tiers, pairs }: PlanNexusDashboardInput): PlanNexusDashboardOutput {
  const warnings: SolverWarning[] = []
  if (!request || !isNdClusterModelId(request.cluster_model_id)) return { result: null, warnings }
  const spec = ND_CLUSTERS[request.cluster_model_id]
  const nodeCount = Math.max(1, Math.min(spec.nodes, Math.floor(request.node_count ?? ND_DEFAULT_NODE_COUNT)))
  const dataSpeed = request.data_speed_g ?? ND_DEFAULT_DATA_SPEED_G
  const mgmtSpeed = request.mgmt_speed_g ?? ND_DEFAULT_MGMT_SPEED_G

  const leafIds = leafIdsByTier(tiers)
  const active = [...leafIds.keys()]
  const dataTiers = active.filter((t) => !t.oob_management)
  const oobTiers = active.filter((t) => t.oob_management)

  const data = attachLeaves(dataTiers.length ? dataTiers : active, leafIds, pairs, request.attach_pair_id ?? null)
  if (request.attach_pair_id && data && data.pair_id !== request.attach_pair_id) {
    warnings.push({
      code: 'ND_ATTACH_PAIR_NOT_FOUND',
      severity: 'warn',
      message: `Nexus Dashboard: leaf pair "${request.attach_pair_id}" is not in this design — the cluster is attached to ${data.pair_id ?? `${data.leaves[0]} / ${data.leaves[1]}`} instead.`,
      context: { attach_pair_id: request.attach_pair_id }
    })
  }
  if (!data) {
    warnings.push({
      code: 'ND_NO_LEAVES',
      severity: 'warn',
      message: 'Nexus Dashboard: the design has no leaves to attach the cluster to — no data links seeded.'
    })
  }
  const mgmt = oobTiers.length ? attachLeaves(oobTiers, leafIds, pairs, null) : null
  if (oobTiers.length && !mgmt) {
    warnings.push({
      code: 'ND_NO_OOB_LEAVES',
      severity: 'warn',
      message: 'Nexus Dashboard: the OOB management tier has no leaves — management links go to the OOB cloud.'
    })
  }

  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    device_id: ND_DEVICE_ID(i + 1),
    model_id: spec.node_model_id,
    label: `ND node ${i + 1} (${spec.node_model_id})`,
    ru: spec.ru
  }))

  return {
    result: {
      cluster_model_id: spec.cluster_model_id,
      node_model_id: spec.node_model_id,
      node_count: nodeCount,
      ru_per_node: spec.ru,
      data_speed_g: dataSpeed,
      mgmt_speed_g: mgmtSpeed,
      data_ports: [...spec.data_ports],
      mgmt_ports: [...spec.mgmt_ports],
      data_leaf_ids: data ? [...data.leaves] : [],
      attach_pair_id: data?.pair_id ?? null,
      mgmt_leaf_ids: mgmt ? [...mgmt.leaves] : null,
      nodes
    },
    warnings
  }
}

/** Rack that holds a device, or null. */
export function rackOfDevice(layout: RackPlacement[], deviceId: string): RackPlacement | null {
  for (const r of layout) if (r.devices.some((d) => d.device_id === deviceId)) return r
  return null
}
