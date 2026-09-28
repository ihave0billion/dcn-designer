import { solve } from '@domain'
import type {
  BreakoutPair,
  DesignResult,
  IpnRouterSpec,
  SolverContext,
  SolverRequirements,
  SwitchSpec
} from '@domain'
import type { Switch } from '@/schemas/switches'
import type { RequirementsFile } from '@/schemas/project'
import type { PortGroupName } from '@domain'
import { expandPortTemplate } from './port-template'

// Phase 14 — which port group the library's peer_link_ports template names
// (its ports must all belong to one group); null when unset or unresolvable.
export function peerLinkGroupOf(s: Switch): PortGroupName | null {
  if (!s.peer_link_ports) return null
  let ports: string[]
  try {
    ports = expandPortTemplate(s.peer_link_ports)
  } catch {
    return null
  }
  if (ports.length === 0) return null
  const groups: Array<[PortGroupName, typeof s.primary | null]> = [
    ['uplink', s.uplink],
    ['secondary_uplink', s.secondary_uplink],
    ['primary', s.primary]
  ]
  for (const [name, g] of groups) {
    if (!g) continue
    try {
      const all = expandPortTemplate(g.naming_template)
      if (ports.every((p) => all.includes(p))) return name
    } catch {
      // ignore a broken template
    }
  }
  return null
}

// Renderer's library Switch schema carries display + capability detail
// the solver does not look at. Project down to the SwitchSpec shape
// `@domain` expects.
export function switchToSpec(s: Switch): SwitchSpec {
  return {
    id: s.id,
    role: s.role,
    primary: { ports: s.primary.ports, speed_g: s.primary.speed_g },
    uplink: s.uplink ? { ports: s.uplink.ports, speed_g: s.uplink.speed_g } : null,
    secondary_uplink: s.secondary_uplink
      ? { ports: s.secondary_uplink.ports, speed_g: s.secondary_uplink.speed_g }
      : null,
    ru: s.ru,
    power_w: s.power_w,
    capabilities: {
      rocev2: s.capabilities.rocev2,
      aci_leaf: s.capabilities.aci_leaf,
      aci_spine: s.capabilities.aci_spine,
      nxos: s.capabilities.nxos,
      smart_switch: s.capabilities.smart_switch || s.capabilities.dpu_integrated
    },
    peer_link_group: peerLinkGroupOf(s)
  }
}

export function requirementsToSolverInput(req: RequirementsFile): SolverRequirements {
  return {
    fabric: {
      uplinks_per_leaf: req.fabric.uplinks_per_leaf,
      uplinks_per_spine: req.fabric.uplinks_per_spine,
      spine_model_id: req.fabric.spine_model_id,
      use_case: req.use_case,
      input_mode: req.input_mode,
      aci_multipod_allowed: req.fabric.aci_multipod_allowed,
      ipn_router_model_id: req.fabric.ipn_router_model_id,
      // Phase 14 — vPC leaf pairs
      mode: req.fabric.mode,
      peer_link_enabled: req.fabric.peer_link_enabled,
      peer_link_members: req.fabric.peer_link_members,
      peer_link_port_channel: req.fabric.peer_link_port_channel
    },
    tiers: req.tiers.map((t) => ({
      speed_tier_label: t.speed_tier_label,
      endpoint_count: t.endpoint_count,
      switch_count: t.switch_count,
      leaf_model_id: t.leaf_model_id,
      override_uplink_speed_g: t.override_uplink_speed_g,
      server_model_id: t.server_model_id ?? null,
      vpc_pairs: t.vpc_pairs ?? true,
      oob_management: t.oob_management ?? false
    })),
    racks: req.racks.map((r) => ({
      name: r.name,
      size_u: r.size_u,
      pdu_kw_budget: r.pdu_kw_budget
    })),
    racks_per_row: req.racks_per_row ?? null,
    // Phase 17 — Nexus Dashboard cluster (null cluster = none).
    nexus_dashboard: req.nexus_dashboard?.cluster_model_id
      ? {
          cluster_model_id: req.nexus_dashboard.cluster_model_id,
          node_count: req.nexus_dashboard.node_count,
          data_speed_g: req.nexus_dashboard.data_speed_g,
          mgmt_speed_g: req.nexus_dashboard.mgmt_speed_g,
          attach_pair_id: req.nexus_dashboard.attach_pair_id
        }
      : null
  }
}

export interface SolveInputs {
  requirements: RequirementsFile
  switches: Switch[]
  breakoutPairs: BreakoutPair[]
  ipnRouters?: IpnRouterSpec[]
}

export function runSolver({
  requirements,
  switches,
  breakoutPairs,
  ipnRouters
}: SolveInputs): DesignResult {
  const context: SolverContext = {
    switches: switches.map(switchToSpec),
    breakout_pairs: breakoutPairs,
    ipn_routers: ipnRouters
  }
  return solve(requirementsToSolverInput(requirements), context)
}
