import { pickUplinkGroup } from './tier'
import type {
  BreakoutAnalysis,
  BreakoutPair,
  SolverWarning,
  SpineResult,
  SwitchSpec,
  TierResult
} from './types'

const HA_MIN_SPINES = 2 // v8 rule 7

export interface SpineComputation {
  spine: SpineResult | null
  breakout: BreakoutAnalysis | null
  warnings: SolverWarning[]
}

interface SpinePortGroup {
  ports: number
  speed_g: number
}

// A spine's "downlink" surface is whichever port group it presents.
// For a 'spine'-role switch, that's `primary`. For a 'both'-role switch
// used as a spine, we prefer the higher-speed group (mirrors v8 picking
// the uplink side of a leaf with both groups — same heuristic, applied
// at the spine layer to face the leaves' uplinks).
function pickSpinePorts(sw: SwitchSpec): SpinePortGroup {
  if (sw.role === 'spine') {
    return { ports: sw.primary.ports, speed_g: sw.primary.speed_g }
  }
  const picked = pickUplinkGroup(sw)
  if (picked) return { ports: picked.ports, speed_g: picked.speed_g }
  return { ports: sw.primary.ports, speed_g: sw.primary.speed_g }
}

export function computeSpine(
  tiers: TierResult[],
  spine: SwitchSpec | null,
  uplinks_per_leaf: number,
  uplinks_per_spine: number,
  breakout_pairs: BreakoutPair[]
): SpineComputation {
  const warnings: SolverWarning[] = []

  if (!spine) {
    warnings.push({
      code: 'NO_SPINE_MODEL_SELECTED',
      severity: 'error',
      message: 'No spine model selected.'
    })
    return { spine: null, breakout: null, warnings }
  }

  const ports = pickSpinePorts(spine)

  const active = tiers.filter((t) => t.xor_status === 'ok' && t.leaves_required > 0)
  const total_leaves = active.reduce((acc, t) => acc + t.leaves_required, 0)
  const total_leaf_uplinks = total_leaves * uplinks_per_leaf
  const total_uplink_bw_g = active.reduce((acc, t) => acc + t.uplink_bw_g, 0)

  // Three independent constraints.
  const spine_total_bw_g = ports.ports * ports.speed_g
  const spines_capacity = spine_total_bw_g > 0 ? Math.ceil(total_uplink_bw_g / spine_total_bw_g) : 0

  let spines_touching: number | null
  let spine_touching_divisible = true
  if (uplinks_per_spine <= 0) {
    spines_touching = null
    spine_touching_divisible = false
  } else if (uplinks_per_leaf % uplinks_per_spine !== 0) {
    spines_touching = null
    spine_touching_divisible = false
    warnings.push({
      code: 'UPLINKS_NOT_DIVISIBLE_BY_PER_SPINE',
      severity: 'error',
      message: `Uplinks/leaf (${uplinks_per_leaf}) is not evenly divisible by uplinks/spine (${uplinks_per_spine}).`,
      context: { uplinks_per_leaf, uplinks_per_spine }
    })
  } else {
    spines_touching = uplinks_per_leaf / uplinks_per_spine
  }

  const spines_port_count = ports.ports > 0 ? Math.ceil(total_leaf_uplinks / ports.ports) : 0

  const candidates = [HA_MIN_SPINES, spines_capacity, spines_touching ?? 0, spines_port_count]
  const spines_needed = Math.max(...candidates)
  const required_uplinks_per_leaf = spines_needed * uplinks_per_spine

  if (required_uplinks_per_leaf > uplinks_per_leaf) {
    warnings.push({
      code: 'EXTRA_UPLINKS_NEEDED',
      severity: 'error',
      message: `Increase Total Uplinks/Leaf to ${required_uplinks_per_leaf} to reach all ${spines_needed} spines.`,
      context: {
        current_uplinks_per_leaf: uplinks_per_leaf,
        required_uplinks_per_leaf,
        spines_needed
      }
    })
  }

  // Spine port-count vs total uplink ports (Dashboard check)
  if (ports.ports > 0 && total_leaf_uplinks > ports.ports * spines_needed) {
    warnings.push({
      code: 'SPINE_PORTS_INSUFFICIENT',
      severity: 'error',
      message: `Spine ports (${ports.ports * spines_needed}) cannot cover ${total_leaf_uplinks} leaf uplinks.`,
      context: { spine_ports_total: ports.ports * spines_needed, total_leaf_uplinks }
    })
  }

  const spineResult: SpineResult = {
    spine_model_id: spine.id,
    spine_ports: ports.ports,
    spine_speed_g: ports.speed_g,
    total_leaves,
    total_leaf_uplinks,
    spines_capacity,
    spines_touching,
    spines_port_count,
    spines_needed,
    required_uplinks_per_leaf,
    spine_touching_divisible
  }

  // ────────────────────────────────────────────────────────────────
  // Breakout pass (S3 — 400G → 4× 100G)
  // ────────────────────────────────────────────────────────────────
  const max_leaf_uplink_speed_g = active.reduce(
    (acc, t) => Math.max(acc, t.effective_uplink_speed_g),
    0
  )
  const fanout = 4
  // Physically applicable when 4× leaf speed ≤ spine speed (strictly less than
  // is the practical case; equal speeds make breakout pointless).
  const breakout_applicable =
    max_leaf_uplink_speed_g > 0 &&
    ports.speed_g > 0 &&
    max_leaf_uplink_speed_g * fanout <= ports.speed_g &&
    max_leaf_uplink_speed_g < ports.speed_g

  const spines_port_count_with_breakout =
    ports.ports > 0 ? Math.ceil(total_leaf_uplinks / (ports.ports * fanout)) : 0
  const spines_with_breakout = breakout_applicable
    ? Math.max(
        HA_MIN_SPINES,
        spines_capacity,
        spines_touching ?? 0,
        spines_port_count_with_breakout
      )
    : spines_needed

  const uplinks_per_leaf_with_breakout = spines_with_breakout * uplinks_per_spine
  const base_valid_in_uplinks = required_uplinks_per_leaf <= uplinks_per_leaf
  const breakout_valid_in_uplinks = uplinks_per_leaf_with_breakout <= uplinks_per_leaf
  const reduces_spine_count = breakout_applicable && spines_with_breakout < spines_needed
  const flips_to_valid =
    breakout_applicable && !base_valid_in_uplinks && breakout_valid_in_uplinks

  // Look up a verified breakout pair for the recommendation.
  const recommended_pair = breakout_applicable
    ? (breakout_pairs.find(
        (p) => p.fanout === fanout && p.spine_pid && p.leaf_pid
      ) ?? null)
    : null

  const patch_panel_needed = recommended_pair?.requires_patch_panel ?? false

  if (reduces_spine_count || flips_to_valid) {
    warnings.push({
      code: 'BREAKOUT_RECOMMENDED',
      severity: flips_to_valid ? 'warn' : 'info',
      message: flips_to_valid
        ? `Breakout (4:1) makes this design valid — spine count drops to ${spines_with_breakout}.`
        : `Breakout (4:1) reduces spine count to ${spines_with_breakout}.`,
      context: {
        spines_no_breakout: spines_needed,
        spines_with_breakout,
        recommended_spine_pid: recommended_pair?.spine_pid ?? null,
        recommended_leaf_pid: recommended_pair?.leaf_pid ?? null
      }
    })
  }

  if ((reduces_spine_count || flips_to_valid) && patch_panel_needed) {
    warnings.push({
      code: 'BREAKOUT_PATCH_PANEL_NEEDED',
      severity: 'warn',
      message: `Verified breakout pair ${recommended_pair?.spine_pid} → ${recommended_pair?.leaf_pid} uses different connectors (${recommended_pair?.spine_connector} at spine, ${recommended_pair?.leaf_connector} at leaf) — a patch panel (cassette / breakout module) is required.`,
      context: {
        spine_connector: recommended_pair?.spine_connector ?? null,
        leaf_connector: recommended_pair?.leaf_connector ?? null
      }
    })
  }

  const breakout: BreakoutAnalysis = {
    applicable: breakout_applicable,
    fanout,
    spines_with_breakout: breakout_applicable ? spines_with_breakout : spines_needed,
    uplinks_per_leaf_with_breakout,
    reduces_spine_count,
    flips_to_valid,
    recommended_pair,
    patch_panel_needed
  }

  return { spine: spineResult, breakout, warnings }
}
