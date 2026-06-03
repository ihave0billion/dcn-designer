import type { CandidateId, DesignCandidate, DesignResult, DesignSummary } from '@domain'

// Phase 9b — committed-candidate projection.
//
// The solver publishes a 4-candidate matrix plus a `committed_candidate_id`.
// Downstream views (Rack / Links / Topology) read design.yaml's TOP-LEVEL
// summary / spine / breakout / rack_layout / optics_bom — they don't know
// about the matrix. To make "the active design = the committed candidate"
// (PROJECT_PLAN), we re-project the committed candidate onto those
// top-level fields. `candidates`, `tiers`, and the global `warnings` list
// are preserved so the Design view's candidate cards and the global
// validation list keep working.

export function findCandidate(
  design: DesignResult,
  id: CandidateId
): DesignCandidate | null {
  return design.candidates.find((c) => c.id === id) ?? null
}

function summaryFromCandidate(design: DesignResult, c: DesignCandidate): DesignSummary {
  const total_leaves = c.multipod
    ? c.multipod.leaves_per_pod.reduce((a, b) => a + b, 0)
    : c.spine?.total_leaves ?? design.summary.total_leaves
  const spines_with_breakout = c.breakout?.applicable
    ? c.breakout.spines_with_breakout * (c.multipod?.pods_needed ?? 1)
    : null
  return {
    total_leaves,
    total_spines: c.total_spines,
    total_servers: 0,
    spines_no_breakout: c.total_spines,
    spines_with_breakout,
    total_host_bw_g: c.total_host_bw_g,
    total_uplink_bw_g: c.total_uplink_bw_g,
    computed_oversub_ratio: c.computed_oversub_ratio,
    computed_oversub_label: c.computed_oversub_label,
    valid: c.valid,
    breakout_required_to_be_valid: c.breakout_variant === 'with_breakout' && c.valid
  }
}

// Return a DesignResult whose top-level fields mirror the committed
// candidate. Pass `committedId` to project a different candidate (the
// commit handler uses this); omit it to re-project whatever
// `design.committed_candidate_id` already is.
export function projectCommittedCandidate(
  design: DesignResult,
  committedId?: CandidateId
): DesignResult {
  const id = committedId ?? design.committed_candidate_id
  const c = findCandidate(design, id)
  if (!c) return design
  return {
    ...design,
    committed_candidate_id: id,
    summary: summaryFromCandidate(design, c),
    spine: c.spine,
    breakout: c.breakout,
    rack_layout: c.rack_layout,
    optics_bom: c.optics_bom
  }
}

// True when the committed candidate is a multi-pod design (has IPN
// routers + pods). Used by the Rack-rack/IPN-seed wiring.
export function isCommittedMultiPod(design: DesignResult): boolean {
  const c = findCandidate(design, design.committed_candidate_id)
  return Boolean(c?.multipod && c.total_ipn_routers > 0)
}
