import type {
  SolverWarning,
  SwitchSpec,
  TierResult,
  UseCase
} from './types'

const ROCEV2_USE_CASES: ReadonlyArray<UseCase> = ['ai', 'hpc']

export function requiresNonBlocking(use_case: UseCase): boolean {
  return use_case === 'ai' || use_case === 'hpc'
}

// AI/HPC fabrics must be non-blocking (1:1): per-tier host BW must
// equal uplink BW. Storage and DCN tolerate oversubscription.
export function checkUseCaseConstraints(
  use_case: UseCase,
  tiers: TierResult[],
  switches: SwitchSpec[],
  spine_id: string | null
): SolverWarning[] {
  const warnings: SolverWarning[] = []
  if (!requiresNonBlocking(use_case)) return warnings

  for (const tier of tiers) {
    if (tier.xor_status !== 'ok' || tier.leaves_required <= 0) continue
    if (tier.host_bw_g !== tier.uplink_bw_g) {
      warnings.push({
        code: 'AI_HPC_NOT_1TO1',
        severity: 'error',
        message: `Tier "${tier.speed_tier_label}" is ${tier.host_bw_g}G host vs ${tier.uplink_bw_g}G uplink — ${use_case.toUpperCase()} fabric requires 1:1 (non-blocking).`,
        context: {
          tier: tier.speed_tier_label,
          host_bw_g: tier.host_bw_g,
          uplink_bw_g: tier.uplink_bw_g
        }
      })
    }

    // Filter check: RoCEv2-capable leaf required for AI/HPC.
    const sw = switches.find((s) => s.id === tier.leaf_model_id)
    if (sw && !sw.capabilities.rocev2) {
      warnings.push({
        code: 'AI_HPC_NO_ROCEV2',
        severity: 'warn',
        message: `Leaf "${sw.id}" is not flagged RoCEv2-capable in the library — ${use_case.toUpperCase()} fabrics should use RoCEv2 leaves.`,
        context: { tier: tier.speed_tier_label, leaf_model_id: sw.id }
      })
    }
  }

  if (spine_id) {
    const spine = switches.find((s) => s.id === spine_id)
    if (spine && !spine.capabilities.rocev2) {
      warnings.push({
        code: 'AI_HPC_NO_ROCEV2',
        severity: 'warn',
        message: `Spine "${spine.id}" is not flagged RoCEv2-capable in the library.`,
        context: { spine_model_id: spine.id }
      })
    }
  }

  return warnings
}

// Filters candidate switches to those that are RoCEv2-capable for AI/HPC
// fabrics. Exposed for the future Requirements UI's leaf-picker dropdown.
export function candidateLeavesFor(
  use_case: UseCase,
  switches: SwitchSpec[]
): SwitchSpec[] {
  const leafLike = switches.filter((s) => s.role === 'leaf' || s.role === 'both')
  if (!ROCEV2_USE_CASES.includes(use_case)) return leafLike
  return leafLike.filter((s) => s.capabilities.rocev2)
}

export function candidateSpinesFor(
  use_case: UseCase,
  switches: SwitchSpec[]
): SwitchSpec[] {
  const spineLike = switches.filter((s) => s.role === 'spine' || s.role === 'both')
  if (!ROCEV2_USE_CASES.includes(use_case)) return spineLike
  return spineLike.filter((s) => s.capabilities.rocev2)
}
