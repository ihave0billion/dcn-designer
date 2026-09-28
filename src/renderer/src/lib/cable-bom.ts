import type { CableLink, CableLinkKind, CableLinkMedia } from '@/schemas/cable-links'

// Phase 9 — cable-length BOM.
//
// `requirements.cable_tray_m` has been captured since Phase 1 but was never
// consumed by anything. This module is what finally spends it: it turns the
// port-level `cable_links.yaml` wiring into an orderable cable BOM.
//
// Length model (decision 2026-08-06 — "tray run + rack slack"):
//   • Both endpoints in the SAME rack  → INTRA_RACK_RUN_M (a ToR jumper).
//     Endpoints with no rack at all count as the same rack: a design with no
//     rack inventory is one implied rack, not an un-costable one.
//   • Endpoints in DIFFERENT racks     → cable_tray_m + RACK_RISE_ALLOWANCE_M
//     at each end. A 10 m tray run is never a 10 m cable — the cable still has
//     to climb out of one cabinet and back down into the other.
//   • Then round UP to the next size on the standard ladder. You cannot order
//     a 16 m cable; you order 20 m and coil the slack.
//
// A user-entered (or CSV-imported) `length_m` always wins over the derived
// value — the derivation is a default, not an override.

/**
 * Orderable cable lengths in metres. Union of the common Cisco DAC / AOC /
 * fiber-patch ladders — nothing between these values can actually be bought.
 */
export const STANDARD_CABLE_LENGTHS_M = [1, 2, 3, 5, 7, 10, 15, 20, 25, 30, 50, 75, 100]

/** Run length assumed for a link whose endpoints share a rack. */
export const INTRA_RACK_RUN_M = 3

/** Slack added per endpoint on a cross-rack run (cabinet rise + patch). */
export const RACK_RISE_ALLOWANCE_M = 3

/**
 * Cable media. v1.6.1 — a project-level default (`requirements.default_cable_media`,
 * multimode fiber unless changed) that any link can override; media is no
 * longer guessed from the length. When a link names an optic the optic is the
 * real authority — it is carried through on the BOM row so the two can be
 * reconciled at order time.
 */
export type CableMedia = CableLinkMedia
export const DEFAULT_CABLE_MEDIA: CableMedia = 'mmf'
export const CABLE_MEDIA_OPTIONS: ReadonlyArray<{ value: CableMedia; label: string }> = [
  { value: 'mmf', label: 'MMF fiber (OM4)' },
  { value: 'smf', label: 'SMF fiber (OS2)' },
  { value: 'dac', label: 'DAC (copper)' },
  { value: 'aoc', label: 'AOC' }
]

/** Human label for a media value, shared by the UI and the PDF. */
export function cableMediaLabel(media: CableMedia): string {
  return CABLE_MEDIA_OPTIONS.find((o) => o.value === media)?.label ?? media
}

/**
 * Round a raw run up to the next orderable size. Returns null when the run is
 * longer than the longest standard cable — those need a custom pull and are
 * reported separately rather than silently clamped to 100 m.
 */
export function roundUpToStandardLength(rawM: number): number | null {
  for (const size of STANDARD_CABLE_LENGTHS_M) {
    if (rawM <= size) return size
  }
  return null
}

/** Where a link's raw length came from. */
export type LengthSource = 'user' | 'derived' | 'unknown'

export interface DerivedLength {
  raw_m: number | null
  source: LengthSource
  /** True when the two endpoints sit in different racks. */
  cross_rack: boolean
}

export function deriveLinkLength(link: CableLink, cableTrayM: number | null): DerivedLength {
  const crossRack = link.device_a.rack !== link.device_b.rack

  // An explicit length always wins — the user measured it, we didn't.
  if (link.length_m != null) {
    return { raw_m: link.length_m, source: 'user', cross_rack: crossRack }
  }

  if (!crossRack) {
    return { raw_m: INTRA_RACK_RUN_M, source: 'derived', cross_rack: false }
  }

  // Cross-rack with no tray distance on file: there is nothing to derive
  // from. Report it rather than guessing a number that would get ordered.
  if (cableTrayM == null) {
    return { raw_m: null, source: 'unknown', cross_rack: true }
  }

  return {
    raw_m: cableTrayM + RACK_RISE_ALLOWANCE_M * 2,
    source: 'derived',
    cross_rack: true
  }
}

export interface CableBomRow {
  /**
   * Orderable length; null when the run could not be costed (cross-rack with
   * no tray distance, or longer than the longest standard cable). Uncosted
   * links still get a row so the BOM always accounts for every cable.
   */
  ordered_length_m: number | null
  /** Phase 14 — fabric uplink vs vPC peer-link (peer-links get their own rows). */
  kind: CableLinkKind
  speed_g: number
  optic_id: string | null
  media: CableMedia
  count: number
  /** Sum of the un-rounded runs — how much cable is actually in the tray (0 when uncosted). */
  total_raw_m: number
  /** Sum of what gets ordered. The gap vs total_raw_m is coiled slack (0 when uncosted). */
  total_ordered_m: number
}

export interface CableBomUnresolved {
  reason: 'no_cable_tray_distance' | 'exceeds_longest_standard_cable'
  count: number
  /** Longest raw run in this bucket, for the over-length case. */
  max_raw_m: number | null
}

export interface CableBom {
  rows: CableBomRow[]
  unresolved: CableBomUnresolved[]
  total_links: number
  /** Links with a priced length (total_links minus unresolved). */
  costed_links: number
  total_ordered_m: number
  /** How many rows came from a user-entered length rather than derivation. */
  user_specified_links: number
  /** Phase 14 — vPC peer-link cables (a subset of total_links). */
  peer_link_links: number
  /** Media applied to links that carry no override. */
  default_media: CableMedia
}

export interface BuildCableBomInput {
  links: CableLink[]
  cable_tray_m: number | null
  /** Project default media; links without an override use it. Defaults to MMF. */
  default_media?: CableMedia | null
}

/**
 * Aggregate port-level links into orderable cable rows, grouped by
 * (ordered length × kind × speed × optic × media). Costed rows sort
 * longest-first so the expensive runs read at the top; uncosted rows
 * (no length yet) sit above them so they cannot be missed.
 */
export function buildCableBom({ links, cable_tray_m, default_media }: BuildCableBomInput): CableBom {
  const defaultMedia: CableMedia = default_media ?? DEFAULT_CABLE_MEDIA
  const byKey = new Map<string, CableBomRow>()
  let noTray = 0
  let overLength = 0
  let overLengthMax: number | null = null
  let userSpecified = 0
  let costed = 0
  let peerLinks = 0

  for (const link of links) {
    const kind: CableLinkKind = link.kind ?? 'uplink'
    if (kind === 'vpc-peer-link') peerLinks += 1
    const { raw_m, source } = deriveLinkLength(link, cable_tray_m)
    const media: CableMedia = link.media ?? defaultMedia
    const optic = link.optic_id ?? null

    let ordered: number | null = null
    if (raw_m == null) {
      noTray += 1
    } else {
      ordered = roundUpToStandardLength(raw_m)
      if (ordered == null) {
        overLength += 1
        overLengthMax = overLengthMax == null ? raw_m : Math.max(overLengthMax, raw_m)
      } else {
        if (source === 'user') userSpecified += 1
        costed += 1
      }
    }

    const key = `${ordered ?? '?'}|${kind}|${link.speed_g}|${optic ?? ''}|${media}`
    const existing = byKey.get(key)
    if (existing) {
      existing.count += 1
      if (ordered != null && raw_m != null) {
        existing.total_raw_m += raw_m
        existing.total_ordered_m += ordered
      }
    } else {
      byKey.set(key, {
        ordered_length_m: ordered,
        kind,
        speed_g: link.speed_g,
        optic_id: optic,
        media,
        count: 1,
        total_raw_m: ordered != null && raw_m != null ? raw_m : 0,
        total_ordered_m: ordered ?? 0
      })
    }
  }

  const rows = [...byKey.values()].sort(
    (a, b) =>
      Number(b.ordered_length_m == null) - Number(a.ordered_length_m == null) ||
      (b.ordered_length_m ?? 0) - (a.ordered_length_m ?? 0) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      b.speed_g - a.speed_g ||
      a.media.localeCompare(b.media) ||
      (a.optic_id ?? '').localeCompare(b.optic_id ?? '')
  )

  const unresolved: CableBomUnresolved[] = []
  if (noTray > 0) {
    unresolved.push({ reason: 'no_cable_tray_distance', count: noTray, max_raw_m: null })
  }
  if (overLength > 0) {
    unresolved.push({
      reason: 'exceeds_longest_standard_cable',
      count: overLength,
      max_raw_m: overLengthMax
    })
  }

  return {
    rows,
    unresolved,
    total_links: links.length,
    costed_links: costed,
    total_ordered_m: rows.reduce((sum, r) => sum + r.total_ordered_m, 0),
    user_specified_links: userSpecified,
    peer_link_links: peerLinks,
    default_media: defaultMedia
  }
}

const KIND_ORDER: Record<CableLinkKind, number> = { uplink: 0, 'vpc-peer-link': 1, server: 2, 'nd-data': 3, 'nd-mgmt': 4 }

/** Short label for a BOM row's kind, shared by the UI and the PDF. */
export function cableKindLabel(kind: CableLinkKind): string {
  switch (kind) {
    case 'nd-data':
      return 'ND data'
    case 'nd-mgmt':
      return 'ND mgmt'
    case 'vpc-peer-link':
      return 'vPC peer-link'
    case 'server':
      return 'Server'
    default:
      return 'Fabric uplink'
  }
}

/** Human-readable label for an unresolved bucket, shared by the UI and the PDF. */
export function unresolvedLabel(u: CableBomUnresolved): string {
  switch (u.reason) {
    case 'no_cable_tray_distance':
      return `${u.count} cross-rack link${u.count === 1 ? '' : 's'} not costed — set Cable Tray (m) in Requirements, or enter a length on each link.`
    case 'exceeds_longest_standard_cable':
      return `${u.count} run${u.count === 1 ? '' : 's'} exceed the longest standard cable (${STANDARD_CABLE_LENGTHS_M[STANDARD_CABLE_LENGTHS_M.length - 1]} m${
        u.max_raw_m != null ? `; longest is ${u.max_raw_m} m` : ''
      }) — these need a custom pull.`
  }
}
