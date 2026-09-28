import type { DesignResult } from '@domain'

// Phase 15c — endpoint headline for the Summary tab and the PDF summary block.
//
// The solver already reports `endpoints_supported` per tier (leaves × host
// ports on the leaf model) and the tier tables print it row by row, but
// nothing totalled it. This is the single place that does, so the screen
// and the report agree. `requested` is the sum of the endpoint counts the
// user typed on endpoint-mode tiers; a tier sized by switch count has no
// request and contributes only to `supported`.

export interface EndpointTotals {
  /** Host ports the solved leaves provide across every solved tier. */
  supported: number
  /** Endpoints asked for on endpoint-mode tiers (0 when every tier is switch-count mode). */
  requested: number
  /** Ports left over after the requested endpoints are placed. */
  spare: number
}

export function endpointTotals(design: Pick<DesignResult, 'tiers'>): EndpointTotals {
  let supported = 0
  let requested = 0
  for (const t of design.tiers) {
    if (t.xor_status !== 'ok') continue
    supported += t.endpoints_supported
    requested += t.endpoint_count_input ?? 0
  }
  return { supported, requested, spare: Math.max(0, supported - requested) }
}
