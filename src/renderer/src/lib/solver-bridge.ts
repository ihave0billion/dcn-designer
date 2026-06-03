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
      nxos: s.capabilities.nxos
    }
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
      ipn_router_model_id: req.fabric.ipn_router_model_id
    },
    tiers: req.tiers.map((t) => ({
      speed_tier_label: t.speed_tier_label,
      endpoint_count: t.endpoint_count,
      switch_count: t.switch_count,
      leaf_model_id: t.leaf_model_id,
      override_uplink_speed_g: t.override_uplink_speed_g
    })),
    racks: req.racks.map((r) => ({
      name: r.name,
      size_u: r.size_u,
      pdu_kw_budget: r.pdu_kw_budget
    }))
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
