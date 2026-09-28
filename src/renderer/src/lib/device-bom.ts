import type { DesignResult } from '@domain'
import { DEFAULT_SWITCH_POWER_W } from '@domain'
import type { Switch } from '@/schemas/switches'
import { ndSpecFor } from '@domain'

// Phase 9 — hardware BOM, rolled up from the solver's rack placement.
//
// `design.rack_layout` is the authoritative device list: it already reflects
// the committed candidate (Phase 9b re-projects it), so counting it gets the
// multi-pod spine count and the IPN routers for free. RU comes from the
// placement itself.
//
// Power comes from the switch library — but N9K.md carries no power figure for
// most models, so `seed/switches.yaml` ships power_w: null across the board.
// The solver's rack placement already falls back to DEFAULT_SWITCH_POWER_W
// when estimating per-rack draw, so this BOM uses the SAME fallback: reporting
// "unknown" here would have put an estimated rack total and a blank BOM total
// on facing pages of one document. Rows fed by the fallback are flagged so the
// report can say the number is an estimate rather than a datasheet figure.

export interface DeviceBomRow {
  role: 'spine' | 'leaf' | 'server' | 'ipn' | 'nd'
  model_id: string
  count: number
  ru_each: number | null
  ru_total: number
  power_w_each: number
  power_w_total: number
  /** True when the model isn't in the switch library at all. */
  unknown_model: boolean
  /** True when power_w_each is the default estimate, not a library figure. */
  power_estimated: boolean
  /** Phase 17 — the orderable cluster PID behind a Nexus Dashboard node row. */
  cluster_model_id?: string | null
}

export interface DeviceBom {
  rows: DeviceBomRow[]
  total_devices: number
  total_ru: number
  total_power_w: number
  /** True when at least one row has no library entry at all. */
  has_unknown_models: boolean
  /** Devices whose power came from the library rather than the fallback. */
  power_known_devices: number
  /** True when any row's power is the default estimate — label the total. */
  has_estimated_power: boolean
  /** Phase 17 — the Nexus Dashboard cluster on the BOM (null when none). */
  nd_cluster: { cluster_model_id: string; node_model_id: string; node_count: number } | null
}

const ROLE_ORDER: Record<DeviceBomRow['role'], number> = {
  spine: 0,
  ipn: 1,
  leaf: 2,
  server: 3,
  nd: 4
}

export function buildDeviceBom(design: DesignResult, switches: Switch[]): DeviceBom {
  const byModel = new Map<string, Switch>()
  for (const s of switches) byModel.set(s.id, s)

  const rows = new Map<string, DeviceBomRow>()

  for (const rack of design.rack_layout) {
    for (const d of rack.devices) {
      const key = `${d.role}|${d.model_id}`
      const existing = rows.get(key)
      if (existing) {
        existing.count += 1
        existing.ru_total += d.ru
        existing.power_w_total += existing.power_w_each
        continue
      }
      const spec = byModel.get(d.model_id)
      const nd = d.role === 'nd' ? ndSpecFor(d.model_id) : null
      const powerEach = nd ? nd.power_w : spec?.power_w ?? DEFAULT_SWITCH_POWER_W
      rows.set(key, {
        role: d.role,
        model_id: d.model_id,
        count: 1,
        ru_each: d.ru,
        ru_total: d.ru,
        power_w_each: powerEach,
        power_w_total: powerEach,
        unknown_model: spec == null && nd == null,
        power_estimated: nd ? true : spec?.power_w == null,
        cluster_model_id: nd?.cluster_model_id ?? null
      })
    }
  }

  const out = [...rows.values()].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.model_id.localeCompare(b.model_id)
  )

  const totalDevices = out.reduce((n, r) => n + r.count, 0)
  const powerKnown = out
    .filter((r) => !r.power_estimated)
    .reduce((n, r) => n + r.count, 0)

  const ndRow = out.find((r) => r.role === 'nd' && r.cluster_model_id)
  return {
    rows: out,
    nd_cluster: ndRow
      ? { cluster_model_id: ndRow.cluster_model_id!, node_model_id: ndRow.model_id, node_count: ndRow.count }
      : null,
    total_devices: totalDevices,
    total_ru: out.reduce((n, r) => n + r.ru_total, 0),
    total_power_w: out.reduce((n, r) => n + r.power_w_total, 0),
    has_unknown_models: out.some((r) => r.unknown_model),
    power_known_devices: powerKnown,
    has_estimated_power: powerKnown < totalDevices
  }
}
