import { computeTier } from './tier'
import { computeSpine } from './spine'
import { checkUseCaseConstraints } from './use-case'
import { placeRacks } from './rack'
import { buildCandidates } from './multipod'
import { pickIpnRouter } from './ipn'
import type {
  DesignResult,
  DesignSummary,
  OpticsBomEntry,
  SolverContext,
  SolverRequirements,
  SolverWarning,
  SpineResult,
  TierResult
} from './types'

function formatOversub(host_g: number, uplink_g: number): {
  ratio: number
  label: string
} {
  if (uplink_g <= 0 || host_g <= 0) {
    return { ratio: 0, label: '—' }
  }
  const ratio = host_g / uplink_g
  return { ratio, label: `${ratio.toFixed(2)}:1` }
}

function isBlockingError(w: SolverWarning): boolean {
  return w.severity === 'error'
}

function buildOpticsBom(
  tiers: TierResult[],
  spine: SpineResult | null,
  breakout: ReturnType<typeof computeSpine>['breakout'],
  uplinks_per_leaf: number
): OpticsBomEntry[] {
  // Phase 2 only emits a minimal hint — the Cable Links UI (Phase 6)
  // will do the real intersection against per-switch optics files.
  if (!spine || !breakout) return []
  const active = tiers.filter((t) => t.xor_status === 'ok' && t.leaves_required > 0)
  const bom: OpticsBomEntry[] = []

  // Total uplinks at the leaf side = leaves * uplinks_per_leaf.
  const total_leaf_uplinks = active.reduce(
    (acc, t) => acc + t.leaves_required * uplinks_per_leaf,
    0
  )
  if (total_leaf_uplinks <= 0) return bom

  // S1 (400G ↔ 400G) when spine and leaf speeds match.
  // S2 (400G ↔ 100G direct) when verified non-breakout pair exists
  //    (rare; v8 lists one verified pair).
  // S3 (400G → 4× 100G) when breakout is recommended.
  if (breakout.recommended_pair && (breakout.reduces_spine_count || breakout.flips_to_valid)) {
    bom.push({
      optic_id: breakout.recommended_pair.spine_pid,
      count: breakout.spines_with_breakout * spine.spine_ports,
      scenario: 'S3',
      location: 'spine',
      notes: `Breakout 1×→${breakout.fanout}×`
    })
    bom.push({
      optic_id: breakout.recommended_pair.leaf_pid,
      count: total_leaf_uplinks,
      scenario: 'S3',
      location: 'leaf',
      notes: null
    })
  }

  return bom
}

export function solve(
  requirements: SolverRequirements,
  context: SolverContext
): DesignResult {
  const warnings: SolverWarning[] = []

  // ──────────────────────────────────────────────────────────────────
  // Per-tier math (v8 rules 8, 13)
  // ──────────────────────────────────────────────────────────────────
  const tierResults: TierResult[] = []
  for (const t of requirements.tiers) {
    const r = computeTier(t, requirements.fabric.uplinks_per_leaf, context.switches)
    tierResults.push(r.result)
    warnings.push(...r.warnings)
  }

  // ──────────────────────────────────────────────────────────────────
  // Spine + breakout (v8 rules 7, 13)
  // ──────────────────────────────────────────────────────────────────
  const spineSw = requirements.fabric.spine_model_id
    ? (context.switches.find((s) => s.id === requirements.fabric.spine_model_id) ?? null)
    : null
  if (requirements.fabric.spine_model_id && !spineSw) {
    warnings.push({
      code: 'UNKNOWN_SPINE_MODEL',
      severity: 'error',
      message: `Spine model "${requirements.fabric.spine_model_id}" not found in the library.`,
      context: { spine_model_id: requirements.fabric.spine_model_id }
    })
  }
  const spineComp = computeSpine(
    tierResults,
    spineSw,
    requirements.fabric.uplinks_per_leaf,
    requirements.fabric.uplinks_per_spine,
    context.breakout_pairs
  )
  warnings.push(...spineComp.warnings)

  // ──────────────────────────────────────────────────────────────────
  // Use-case enforcement (v8 rule 10 — 1:1 only on AI/HPC)
  // ──────────────────────────────────────────────────────────────────
  warnings.push(
    ...checkUseCaseConstraints(
      requirements.fabric.use_case,
      tierResults,
      context.switches,
      requirements.fabric.spine_model_id
    )
  )

  // ──────────────────────────────────────────────────────────────────
  // Rack placement
  // ──────────────────────────────────────────────────────────────────
  const rackResult = placeRacks(
    spineComp.spine,
    tierResults,
    context.switches,
    requirements.racks ?? []
  )
  warnings.push(...rackResult.warnings)

  // ──────────────────────────────────────────────────────────────────
  // Roll up summary
  // ──────────────────────────────────────────────────────────────────
  const total_host_bw_g = tierResults.reduce((acc, t) => acc + t.host_bw_g, 0)
  const total_uplink_bw_g = tierResults.reduce((acc, t) => acc + t.uplink_bw_g, 0)
  const oversub = formatOversub(total_host_bw_g, total_uplink_bw_g)
  const total_leaves = spineComp.spine?.total_leaves ?? 0
  const total_spines = spineComp.spine?.spines_needed ?? 0

  const hasBlockingError = warnings.some(isBlockingError)
  const breakout_flips = spineComp.breakout?.flips_to_valid ?? false

  // The design is "valid" iff there's no blocking error OR the only
  // blocker is "extra uplinks needed" and breakout would flip to valid
  // (mirrors v8 Dashboard's "VALID with breakout" message).
  const onlyBlockerIsExtraUplinks =
    warnings.filter(isBlockingError).every((w) => w.code === 'EXTRA_UPLINKS_NEEDED')

  const valid = !hasBlockingError || (onlyBlockerIsExtraUplinks && breakout_flips)
  const breakout_required_to_be_valid = onlyBlockerIsExtraUplinks && breakout_flips

  const summary: DesignSummary = {
    total_leaves,
    total_spines,
    total_servers: 0, // Phase 2 has no server inputs yet
    spines_no_breakout: total_spines,
    spines_with_breakout: spineComp.breakout?.applicable
      ? spineComp.breakout.spines_with_breakout
      : null,
    total_host_bw_g,
    total_uplink_bw_g,
    computed_oversub_ratio: oversub.ratio,
    computed_oversub_label: oversub.label,
    valid,
    breakout_required_to_be_valid
  }

  // ──────────────────────────────────────────────────────────────────
  // Phase 2b — 4-way candidate matrix (single/multi × no/with breakout)
  //
  // The top-level `summary`, `spine`, `breakout`, `rack_layout`,
  // `optics_bom`, and `warnings` continue to represent the canonical
  // single-pod-no-breakout view — Phase 2 readers keep working. The
  // candidate matrix is published as a parallel array; Phase 9b UI
  // renders comparison cards from it.
  // ──────────────────────────────────────────────────────────────────
  const ipn_router = pickIpnRouter(context.ipn_routers, requirements.fabric.ipn_router_model_id)
  const candidatesOut = buildCandidates({
    tiers: tierResults,
    spine_switch: spineSw,
    ipn_router,
    fabric: requirements.fabric,
    breakout_pairs: context.breakout_pairs,
    switches: context.switches,
    rack_inventory: requirements.racks ?? []
  })
  warnings.push(...candidatesOut.fabric_warnings)

  return {
    schema_version: 1,
    summary,
    tiers: tierResults,
    spine: spineComp.spine,
    breakout: spineComp.breakout,
    optics_bom: buildOpticsBom(
      tierResults,
      spineComp.spine,
      spineComp.breakout,
      requirements.fabric.uplinks_per_leaf
    ),
    rack_layout: rackResult.layout,
    warnings,
    candidates: candidatesOut.candidates,
    primary_candidate_id: candidatesOut.primary_candidate_id,
    committed_candidate_id: candidatesOut.primary_candidate_id
  }
}

export type {
  DesignResult,
  DesignSummary,
  SolverContext,
  SolverRequirements,
  SolverWarning,
  TierResult,
  SpineResult,
  BreakoutAnalysis
} from './types'
