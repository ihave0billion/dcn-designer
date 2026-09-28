import type {
  FabricMode,
  FabricRequest,
  PortGroupName,
  PortGroupSpec,
  RackPlacement,
  SolverWarning,
  SwitchSpec,
  TierResult,
  VpcPair
} from './types'
import { pickUplinkGroup } from './tier'

// Phase 14 — vPC leaf pairs (docs/VPC_PAIRS_PLAN.md).
//
// Three things live here, all pure:
//   1. the effective peer-link settings for a fabric mode,
//   2. the uplink budget after the peer-link reservation (decision 5: the
//      solver reduces uplinks per leaf to what remains and warns),
//   3. the solver's pairing (decision 2: consecutive leaves of a tier — the
//      same two-per-rack grouping the rack placement uses — an odd leaf
//      out is flagged, not paired).

export const DEFAULT_FABRIC_MODE: FabricMode = 'nxos-evpn'
export const DEFAULT_PEER_LINK_MEMBERS = 2
export const PEER_LINK_MEMBERS_MIN = 1
export const PEER_LINK_MEMBERS_MAX = 4

export interface EffectiveVpcSettings {
  mode: FabricMode
  peer_link: boolean
  port_channel: boolean
  members: number
}

export function effectiveVpcSettings(
  fabric: Pick<FabricRequest, 'mode' | 'peer_link_enabled' | 'peer_link_members' | 'peer_link_port_channel'>
): EffectiveVpcSettings {
  const mode = fabric.mode ?? DEFAULT_FABRIC_MODE
  const wanted = fabric.peer_link_members ?? DEFAULT_PEER_LINK_MEMBERS
  const members = Math.min(PEER_LINK_MEMBERS_MAX, Math.max(PEER_LINK_MEMBERS_MIN, Math.floor(wanted)))
  if (mode === 'nxos-classic') return { mode, peer_link: true, port_channel: true, members }
  if (mode === 'aci') return { mode, peer_link: false, port_channel: false, members: 0 }
  const enabled = fabric.peer_link_enabled ?? true
  return {
    mode,
    peer_link: enabled,
    port_channel: enabled && (fabric.peer_link_port_channel ?? true),
    members: enabled ? members : 0
  }
}

export interface PeerLinkGroupChoice {
  group: PortGroupName
  ports: number
  speed_g: number
  /** True when the peer-link shares the group the spine uplinks come from. */
  shares_uplink_group: boolean
}

// Decision 3 — which port group a leaf spends on its peer-link.
//   1. the library's `peer_link_ports` group when set;
//   2. else the highest-speed uplink group (the tier's uplink group — a smart
//      switch lands on its 400G ports, never the 100G secondaries) — but only
//      when that leaves room for the configured spine uplinks;
//   3. else — never for a smart switch, whose peer-link must stay on its
//      400G ports — the leaf's OTHER uplink group when it has enough ports
//      (the FX3 case: 2×100G uplinks stay for the spines, the 4×25G group
//      carries the peer-link);
//   4. else the uplink group anyway — the budget below then reduces uplinks
//      per leaf and warns.
export function peerLinkGroupFor(sw: SwitchSpec, members: number, uplinksPerLeaf: number): PeerLinkGroupChoice {
  const groups: Record<PortGroupName, PortGroupSpec | null> = {
    uplink: sw.uplink,
    secondary_uplink: sw.secondary_uplink,
    primary: sw.primary
  }
  const picked = pickUplinkGroup(sw)
  const uplinkGroup: PortGroupName = picked ? (picked.choice === 'secondary' ? 'secondary_uplink' : 'uplink') : 'primary'
  const choose = (name: PortGroupName): PeerLinkGroupChoice => {
    const g = groups[name] ?? sw.primary
    return { group: name, ports: g.ports, speed_g: g.speed_g, shares_uplink_group: name === uplinkGroup }
  }
  if (sw.peer_link_group && groups[sw.peer_link_group]) return choose(sw.peer_link_group)
  const main = groups[uplinkGroup] ?? sw.primary
  if (main.ports - members >= uplinksPerLeaf) return choose(uplinkGroup)
  const other: PortGroupName | null = uplinkGroup === 'uplink' ? 'secondary_uplink' : uplinkGroup === 'secondary_uplink' ? 'uplink' : null
  if (!sw.capabilities.smart_switch && other && groups[other] && groups[other]!.ports >= members) return choose(other)
  return choose(uplinkGroup)
}

export interface UplinkBudget {
  configured: number
  effective: number
  /** Members reserved per leaf (0 = no peer-link). */
  reserved: number
  warnings: SolverWarning[]
}

// Decision 5. The peer-link takes `members` ports out of every leaf's
// uplink group. When a tier's group can no longer carry the configured
// uplinks, uplinks_per_leaf drops to the largest multiple of
// uplinks_per_spine that fits the tightest tier (never below
// uplinks_per_spine itself — the spine math then reports the shortfall).
export function uplinkBudgetAfterPeerLink(
  fabric: Pick<FabricRequest, 'uplinks_per_leaf' | 'uplinks_per_spine'>,
  reserved: number,
  tierRequests: Array<{ leaf_model_id: string | null; endpoint_count: number | null; switch_count: number | null }>,
  switches: SwitchSpec[]
): UplinkBudget {
  const configured = fabric.uplinks_per_leaf
  const warnings: SolverWarning[] = []
  if (reserved <= 0) return { configured, effective: configured, reserved: 0, warnings }

  let tightest = Infinity
  const touched: string[] = []
  const seen = new Set<string>()
  for (const t of tierRequests) {
    if (!t.leaf_model_id) continue
    const active = (t.endpoint_count ?? 0) > 0 || (t.switch_count ?? 0) > 0
    if (!active) continue
    const sw = switches.find((s) => s.id === t.leaf_model_id)
    if (!sw || seen.has(sw.id)) continue
    seen.add(sw.id)
    const choice = peerLinkGroupFor(sw, reserved, configured)
    const label = choice.group === 'primary' ? 'primary' : choice.group === 'uplink' ? 'uplink' : 'secondary uplink'
    touched.push(`${sw.id}: ${reserved} of ${choice.ports} ${label} ports (${choice.speed_g}G)${choice.shares_uplink_group ? '' : ', spine uplinks untouched'}`)
    if (!choice.shares_uplink_group) continue
    tightest = Math.min(tightest, Math.max(0, choice.ports - reserved))
  }
  if (touched.length > 0) {
    warnings.push({
      code: 'VPC_PEER_LINK_RESERVED',
      severity: 'info',
      message: `vPC peer-link reserves ${reserved} port${reserved === 1 ? '' : 's'} per leaf (${touched.join('; ')}).`,
      context: { reserved }
    })
  }
  if (!Number.isFinite(tightest) || tightest >= configured) {
    return { configured, effective: configured, reserved, warnings }
  }
  const per = Math.max(1, fabric.uplinks_per_spine)
  const effective = Math.max(per, Math.floor(tightest / per) * per)
  if (effective < configured) {
    warnings.push({
      code: 'VPC_UPLINKS_REDUCED',
      severity: 'warn',
      message: `Uplinks per leaf reduced from ${configured} to ${effective}: the vPC peer-link consumed ${reserved} uplink port${reserved === 1 ? '' : 's'} per leaf. Spine math re-run with ${effective}.`,
      context: { configured, effective, reserved }
    })
  }
  return { configured, effective, reserved, warnings }
}

export interface PairingResult {
  pairs: VpcPair[]
  unpaired: string[]
  warnings: SolverWarning[]
}

function leafOrdinal(deviceId: string): number {
  const m = /(\d+)\s*$/.exec(deviceId)
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER
}

// Decision 2. Leaves are paired in the order the solver numbers them
// (leaf-1 + leaf-2, leaf-3 + leaf-4, …), never across models or ACI pods.
// That is exactly placeRacks' pod grouping, so a pair also shares a rack
// when the inventory allows it.
export function pairLeaves(rack_layout: RackPlacement[]): PairingResult {
  const leaves: Array<{ id: string; key: string; ord: number }> = []
  for (const rack of rack_layout) {
    for (const d of rack.devices) {
      if (d.role !== 'leaf') continue
      leaves.push({ id: d.device_id, key: `${d.model_id}|${d.pod_index ?? ''}`, ord: leafOrdinal(d.device_id) })
    }
  }
  leaves.sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id))

  // Preserve first-seen group order so pair ids follow the leaf numbering.
  const groups = new Map<string, string[]>()
  for (const l of leaves) groups.set(l.key, [...(groups.get(l.key) ?? []), l.id])

  const pairs: VpcPair[] = []
  const unpaired: string[] = []
  for (const ids of groups.values()) {
    for (let i = 0; i + 1 < ids.length; i += 2) {
      pairs.push({ id: `pair-${pairs.length + 1}`, members: [ids[i], ids[i + 1]] })
    }
    if (ids.length % 2 === 1) unpaired.push(ids[ids.length - 1])
  }
  const warnings: SolverWarning[] = unpaired.map((id) => ({
    code: 'VPC_ODD_LEAF',
    severity: 'warn',
    message: `${id} has no vPC peer (odd leaf in its tier) — single-attached hosts only.`,
    context: { device_id: id }
  }))
  return { pairs, unpaired, warnings }
}

// Convenience for tests / callers that only have tier counts (mirrors the
// leaf-N numbering of rack.ts).
export function pairLeavesFromTiers(tiers: TierResult[]): PairingResult {
  const devices: RackPlacement['devices'] = []
  let serial = 0
  for (const t of tiers) {
    if (t.xor_status !== 'ok' || t.leaves_required <= 0) continue
    for (let i = 0; i < t.leaves_required; i++) {
      serial += 1
      devices.push({ device_id: `leaf-${serial}`, model_id: t.leaf_model_id, role: 'leaf', start_u: 1, ru: 1, label: '', pod_index: null })
    }
  }
  return pairLeaves([{ rack_name: 'Fabric', size_u: 0, pdu_kw_budget: null, estimated_power_w: 0, devices, over_budget: false }])
}
