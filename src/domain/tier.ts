import type {
  SwitchSpec,
  TierRequest,
  TierResult,
  UplinkChoice,
  SolverWarning
} from './types'

export interface ResolvedTier {
  result: TierResult
  warnings: SolverWarning[]
}

// Picks the uplink group with the higher per-port speed (v8 rule 13).
// When the switch only has a primary uplink (or only a secondary), that
// one wins by default.
export function pickUplinkGroup(sw: SwitchSpec): {
  choice: UplinkChoice
  ports: number
  speed_g: number
} | null {
  const pri = sw.uplink
  const sec = sw.secondary_uplink
  if (!pri && !sec) return null
  if (pri && !sec) return { choice: 'primary', ports: pri.ports, speed_g: pri.speed_g }
  if (!pri && sec) return { choice: 'secondary', ports: sec.ports, speed_g: sec.speed_g }
  // Both present — higher per-port speed wins.
  // Tie-break on more ports, then prefer primary.
  if (pri!.speed_g > sec!.speed_g) {
    return { choice: 'primary', ports: pri!.ports, speed_g: pri!.speed_g }
  }
  if (sec!.speed_g > pri!.speed_g) {
    return { choice: 'secondary', ports: sec!.ports, speed_g: sec!.speed_g }
  }
  if (pri!.ports >= sec!.ports) {
    return { choice: 'primary', ports: pri!.ports, speed_g: pri!.speed_g }
  }
  return { choice: 'secondary', ports: sec!.ports, speed_g: sec!.speed_g }
}

// XOR check (v8 rule 8): endpoint_count and switch_count cannot both be
// filled on the same row. Returns the status code consumed by the
// TierResult.
function xorStatus(req: TierRequest): TierResult['xor_status'] {
  const hasEnd = req.endpoint_count != null && req.endpoint_count > 0
  const hasSw = req.switch_count != null && req.switch_count > 0
  if (hasEnd && hasSw) return 'both-set'
  if (!hasEnd && !hasSw) return 'empty'
  if (!req.leaf_model_id) return 'no-model'
  return 'ok'
}

// Builds a "skipped" tier result for empty / invalid rows so the caller
// can present a full table without nulls (v8 rule 2 — DESIGN VALID on
// first open; surfaces problems via xor_status, not via missing data).
function emptyTier(
  req: TierRequest,
  status: TierResult['xor_status'],
  sw: SwitchSpec | null
): TierResult {
  return {
    speed_tier_label: req.speed_tier_label,
    leaf_model_id: req.leaf_model_id ?? '',
    endpoint_count_input: req.endpoint_count ?? null,
    switch_count_input: req.switch_count ?? null,
    leaves_required: 0,
    endpoints_supported: 0,
    host_ports_per_leaf: sw?.primary.ports ?? 0,
    host_speed_g: sw?.primary.speed_g ?? 0,
    effective_uplink_ports: 0,
    effective_uplink_speed_g: 0,
    effective_uplink_choice: 'primary',
    override_uplink_speed_applied_g: null,
    host_bw_g: 0,
    uplink_bw_g: 0,
    xor_status: status,
    server_model_id: req.server_model_id ?? null,
    vpc_pairs: req.vpc_pairs ?? true
  }
}

export function computeTier(
  req: TierRequest,
  uplinks_per_leaf: number,
  switches: SwitchSpec[]
): ResolvedTier {
  const warnings: SolverWarning[] = []
  const status = xorStatus(req)

  // No model selected or unknown — bail with an empty row.
  if (!req.leaf_model_id) {
    return { result: emptyTier(req, status, null), warnings }
  }
  const sw = switches.find((s) => s.id === req.leaf_model_id)
  if (!sw) {
    warnings.push({
      code: 'UNKNOWN_LEAF_MODEL',
      severity: 'error',
      message: `Leaf model "${req.leaf_model_id}" not found in the switch library.`,
      context: { tier: req.speed_tier_label, leaf_model_id: req.leaf_model_id }
    })
    return { result: emptyTier(req, 'unknown-model', null), warnings }
  }

  if (status === 'both-set') {
    warnings.push({
      code: 'XOR_BOTH_SET',
      severity: 'error',
      message: `Tier "${req.speed_tier_label}" has both Endpoint Count and Switch Count filled (v8 rule 8: pick one).`,
      context: { tier: req.speed_tier_label }
    })
    return { result: emptyTier(req, 'both-set', sw), warnings }
  }
  if (status === 'empty') {
    return { result: emptyTier(req, 'empty', sw), warnings }
  }

  // Uplink auto-pick (v8 rule 13) + override (Dashboard column O).
  const picked = pickUplinkGroup(sw)
  if (!picked) {
    warnings.push({
      code: 'UNKNOWN_LEAF_MODEL',
      severity: 'error',
      message: `Leaf "${sw.id}" has no uplink ports declared in the library.`,
      context: { tier: req.speed_tier_label, leaf_model_id: sw.id }
    })
    return { result: emptyTier(req, 'unknown-model', sw), warnings }
  }
  const rated_uplink_speed_g = picked.speed_g
  const effective_uplink_speed_g =
    req.override_uplink_speed_g != null
      ? Math.min(req.override_uplink_speed_g, rated_uplink_speed_g)
      : rated_uplink_speed_g

  if (
    req.override_uplink_speed_g != null &&
    req.override_uplink_speed_g > rated_uplink_speed_g
  ) {
    warnings.push({
      code: 'OVERRIDE_EXCEEDS_RATED',
      severity: 'error',
      message: `Override uplink speed ${req.override_uplink_speed_g}G exceeds the rated ${rated_uplink_speed_g}G on ${sw.id}.`,
      context: {
        tier: req.speed_tier_label,
        rated_speed_g: rated_uplink_speed_g,
        override_speed_g: req.override_uplink_speed_g
      }
    })
  }

  if (uplinks_per_leaf > picked.ports) {
    warnings.push({
      code: 'UPLINKS_EXCEED_AVAILABLE_PORTS',
      severity: 'error',
      message: `Tier "${req.speed_tier_label}" uses ${uplinks_per_leaf} uplinks/leaf, but ${sw.id} only has ${picked.ports} uplink ports.`,
      context: { tier: req.speed_tier_label, uplinks_per_leaf, available: picked.ports }
    })
  }

  const host_ports = sw.primary.ports
  const host_speed = sw.primary.speed_g

  // Leaf count derives from the populated XOR side.
  let leaves: number
  let endpoints_supported: number
  if (req.endpoint_count != null && req.endpoint_count > 0) {
    leaves = Math.ceil(req.endpoint_count / host_ports)
    endpoints_supported = leaves * host_ports
  } else {
    // switch_count path
    leaves = req.switch_count ?? 0
    endpoints_supported = leaves * host_ports
  }

  const host_bw_g = leaves * host_ports * host_speed
  const uplink_bw_g = leaves * uplinks_per_leaf * effective_uplink_speed_g

  return {
    result: {
      speed_tier_label: req.speed_tier_label,
      leaf_model_id: sw.id,
      endpoint_count_input: req.endpoint_count ?? null,
      switch_count_input: req.switch_count ?? null,
      leaves_required: leaves,
      endpoints_supported,
      host_ports_per_leaf: host_ports,
      host_speed_g: host_speed,
      effective_uplink_ports: picked.ports,
      effective_uplink_speed_g,
      effective_uplink_choice: picked.choice,
      override_uplink_speed_applied_g: req.override_uplink_speed_g ?? null,
      host_bw_g,
      uplink_bw_g,
      xor_status: 'ok',
      server_model_id: req.server_model_id ?? null,
      vpc_pairs: req.vpc_pairs ?? true
    },
    warnings
  }
}
