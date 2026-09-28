import type { CableLink, CableLinkKind } from '@/schemas/cable-links'
import type { DesignResult } from '@domain'
import type { Switch } from '@/schemas/switches'
import { DEFAULT_CABLE_MEDIA, type CableMedia } from './cable-bom'

// v1.6.2 — transceiver BOM derived from the wiring.
//
// The solver's `design.optics_bom` only ever described the breakout
// scenario, so a plain 400G fabric reported "no optics". Procurement needs
// the count regardless of whether a PID has been chosen yet, so this module
// walks cable_links.yaml and counts one transceiver per PORT END on fiber
// media, broken out by side (spine / leaf / peer-link), switch model, speed,
// media and optic PID:
//   • a DAC or AOC end is cable-integrated — counted, but no transceiver;
//   • a breakout spine port (`Eth1/1/1`…`/4`) is one physical port and one
//     optic, so sub-ports collapse onto their base port; its PID is the
//     breakout pair's spine PID and its speed the spine's;
//   • an end with no PID still counts — the row says the PID is not set and
//     carries the switch library's optic hint (form factor) as a pointer.

export type OpticSide = 'spine' | 'leaf' | 'ipn' | 'other'

export interface OpticsBomRow {
  side: OpticSide
  kind: CableLinkKind
  model_id: string | null
  speed_g: number
  media: CableMedia
  /** Optic PID when the link (or the breakout pair) names one. */
  optic_id: string | null
  /** Switch library `optic_hint` for the model — shown when no PID is set. */
  optic_hint: string | null
  count: number
}

export interface OpticsBom {
  rows: OpticsBomRow[]
  /** Fiber ends = transceivers to order (sum of `rows[].count`). */
  total_transceivers: number
  /** Transceivers whose PID is still unset. */
  ends_without_pid: number
  /** DAC / AOC ends — cable-integrated, no transceiver. */
  integrated_ends: number
  /** All distinct port ends seen (transceivers + integrated). */
  total_ends: number
  by_side: { spine: number; leaf: number; peer_link: number; other: number }
}

export interface BuildOpticsBomInput {
  links: CableLink[]
  design: Pick<DesignResult, 'rack_layout' | 'spine' | 'breakout'>
  switches?: Switch[]
  default_media?: CableMedia | null
}

const SIDE_ORDER: Record<OpticSide, number> = { spine: 0, leaf: 1, ipn: 2, other: 3 }
const KIND_ORDER: Record<CableLinkKind, number> = { uplink: 0, 'vpc-peer-link': 1, server: 2 }

/** Base port for a breakout sub-port: `Eth1/1/3` → `Eth1/1`; anything else unchanged. */
export function physicalPort(port: string): { base: string; isSubPort: boolean } {
  const segs = port.split('/')
  if (segs.length >= 3 && /^\d+$/.test(segs[segs.length - 1])) {
    return { base: segs.slice(0, -1).join('/'), isSubPort: true }
  }
  return { base: port, isSubPort: false }
}

function sideOf(role: string | undefined, deviceId: string): OpticSide {
  const r = role ?? deviceId.split('-')[0]
  if (r === 'spine') return 'spine'
  if (r === 'leaf') return 'leaf'
  if (r === 'ipn') return 'ipn'
  return 'other'
}

/**
 * The library's `optic_hint` names a form factor per port group, e.g.
 * "SFP28 (primary) / QSFP-DD (uplink) / QSFP28 (secondary uplink)". Pick the
 * group whose speed matches the end (an uplink end at 400G → QSFP-DD); a
 * single-segment hint ("QSFP-DD") is returned as is.
 */
export function opticHintForSpeed(sw: Switch | undefined, speed_g: number): string | null {
  const hint = sw?.optic_hint ?? null
  if (!hint) return null
  const segments = hint.split('/').map((seg) => seg.trim()).filter(Boolean)
  if (segments.length <= 1) return hint
  const groups: Array<{ label: string; speed: number | null }> = [
    { label: 'uplink', speed: sw?.uplink?.speed_g ?? null },
    { label: 'secondary uplink', speed: sw?.secondary_uplink?.speed_g ?? null },
    { label: 'primary', speed: sw?.primary?.speed_g ?? null }
  ]
  for (const g of groups) {
    if (g.speed !== speed_g) continue
    const seg = segments.find((x) => new RegExp(`\\(${g.label}\\)`, 'i').test(x))
    if (seg) return seg.replace(/\s*\([^)]*\)\s*$/, '').trim()
  }
  return hint
}

/** Human label for a row's side, shared by the UI and the PDF. */
export function opticSideLabel(row: Pick<OpticsBomRow, 'side' | 'kind'>): string {
  if (row.kind === 'vpc-peer-link') return 'Leaf (peer-link)'
  switch (row.side) {
    case 'spine':
      return 'Spine'
    case 'leaf':
      return 'Leaf'
    case 'ipn':
      return 'IPN'
    default:
      return 'Other'
  }
}

export function buildOpticsBom({ links, design, switches, default_media }: BuildOpticsBomInput): OpticsBom {
  const defaultMedia: CableMedia = default_media ?? DEFAULT_CABLE_MEDIA
  const device = new Map<string, { role: string; model_id: string }>()
  for (const rack of design.rack_layout) {
    for (const d of rack.devices) device.set(d.device_id, { role: d.role, model_id: d.model_id })
  }
  const switchById = new Map<string, Switch>()
  for (const s of switches ?? []) switchById.set(s.id, s)

  const seenEnds = new Set<string>()
  const rows = new Map<string, OpticsBomRow>()
  const bom: OpticsBom = {
    rows: [],
    total_transceivers: 0,
    ends_without_pid: 0,
    integrated_ends: 0,
    total_ends: 0,
    by_side: { spine: 0, leaf: 0, peer_link: 0, other: 0 }
  }

  for (const link of links) {
    const kind: CableLinkKind = link.kind ?? 'uplink'
    const media: CableMedia = link.media ?? defaultMedia
    for (const end of [link.device_a, link.device_b]) {
      const { base, isSubPort } = physicalPort(end.port)
      const endKey = `${end.device_id}|${base}`
      if (seenEnds.has(endKey)) continue
      seenEnds.add(endKey)
      bom.total_ends += 1

      if (media === 'dac' || media === 'aoc') {
        bom.integrated_ends += 1
        continue
      }

      const info = device.get(end.device_id)
      const side = sideOf(info?.role, end.device_id)
      const breakoutSpineEnd = isSubPort && side === 'spine'
      const speed_g = breakoutSpineEnd && design.spine ? design.spine.spine_speed_g : link.speed_g
      const optic_id = breakoutSpineEnd
        ? (design.breakout?.recommended_pair?.spine_pid ?? link.optic_id ?? null)
        : (link.optic_id ?? null)
      const model_id = info?.model_id ?? null
      const optic_hint = model_id ? opticHintForSpeed(switchById.get(model_id), speed_g) : null

      const key = `${side}|${kind}|${model_id ?? ''}|${speed_g}|${media}|${optic_id ?? ''}`
      const existing = rows.get(key)
      if (existing) existing.count += 1
      else rows.set(key, { side, kind, model_id, speed_g, media, optic_id, optic_hint, count: 1 })

      bom.total_transceivers += 1
      if (!optic_id) bom.ends_without_pid += 1
      if (kind === 'vpc-peer-link') bom.by_side.peer_link += 1
      else if (side === 'spine') bom.by_side.spine += 1
      else if (side === 'leaf') bom.by_side.leaf += 1
      else bom.by_side.other += 1
    }
  }

  bom.rows = [...rows.values()].sort(
    (a, b) =>
      SIDE_ORDER[a.side] - SIDE_ORDER[b.side] ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      b.speed_g - a.speed_g ||
      (a.model_id ?? '').localeCompare(b.model_id ?? '') ||
      (a.optic_id ?? '').localeCompare(b.optic_id ?? '')
  )
  return bom
}
