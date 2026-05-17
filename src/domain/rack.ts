import type {
  RackInventoryEntry,
  RackPlacement,
  SolverWarning,
  SpineResult,
  SwitchSpec,
  TierResult
} from './types'

// Defaults used when the library doesn't specify (N9K.md doesn't carry
// ru / power_w for many models). Conservative-ish numbers; the user can
// override per-switch in the library UI later.
const DEFAULT_RU = 1
const DEFAULT_SWITCH_POWER_W = 800

interface PendingDevice {
  device_id: string
  model_id: string
  role: 'spine' | 'leaf' | 'server'
  ru: number
  power_w: number
  label: string
  pod_index: number | null // leaves are paired in pods (0, 1, 2 …)
}

function ru(sw: SwitchSpec | undefined): number {
  return sw?.ru ?? DEFAULT_RU
}

function powerW(sw: SwitchSpec | undefined): number {
  return sw?.power_w ?? DEFAULT_SWITCH_POWER_W
}

function pushDevice(
  rack: RackPlacement,
  d: PendingDevice
): boolean {
  const used_u = rack.devices.reduce((acc, x) => acc + x.ru, 0)
  if (used_u + d.ru > rack.size_u) return false
  if (rack.pdu_kw_budget != null) {
    const next_power_kw = (rack.estimated_power_w + d.power_w) / 1000
    if (next_power_kw > rack.pdu_kw_budget) return false
  }
  // Top-of-rack pack: first switch lands at U(size_u), each subsequent
  // device stacks below it. start_u is the device's bottom edge — for a
  // 1U device at the top of a 44U rack, start_u = 44; for a 2U device
  // at the top, start_u = 43 (occupies U43–U44).
  const start_u = rack.size_u - used_u - d.ru + 1
  rack.devices.push({
    device_id: d.device_id,
    model_id: d.model_id,
    role: d.role,
    start_u,
    ru: d.ru,
    label: d.label
  })
  rack.estimated_power_w += d.power_w
  return true
}

export interface RackPlacementResult {
  layout: RackPlacement[]
  warnings: SolverWarning[]
}

export function placeRacks(
  spine: SpineResult | null,
  tiers: TierResult[],
  switches: SwitchSpec[],
  rack_inventory: RackInventoryEntry[]
): RackPlacementResult {
  const warnings: SolverWarning[] = []

  if (rack_inventory.length === 0) {
    return { layout: [], warnings }
  }

  const layout: RackPlacement[] = rack_inventory.map((r) => ({
    rack_name: r.name,
    size_u: r.size_u,
    pdu_kw_budget: r.pdu_kw_budget,
    estimated_power_w: 0,
    devices: [],
    over_budget: false
  }))

  // ──────────────────────────────────────────────────────────────────
  // Build the device queue: spines first (HA-spread), then leaves
  // grouped into pods of 2.
  // ──────────────────────────────────────────────────────────────────
  const queue: PendingDevice[] = []

  if (spine && spine.spines_needed > 0) {
    const sw = switches.find((s) => s.id === spine.spine_model_id)
    for (let i = 0; i < spine.spines_needed; i++) {
      queue.push({
        device_id: `spine-${i + 1}`,
        model_id: spine.spine_model_id,
        role: 'spine',
        ru: ru(sw),
        power_w: powerW(sw),
        label: `Spine ${i + 1} (${spine.spine_model_id})`,
        pod_index: null
      })
    }
  }

  let leaf_serial = 0
  for (const tier of tiers) {
    if (tier.xor_status !== 'ok' || tier.leaves_required <= 0) continue
    const sw = switches.find((s) => s.id === tier.leaf_model_id)
    for (let i = 0; i < tier.leaves_required; i++) {
      leaf_serial += 1
      queue.push({
        device_id: `leaf-${leaf_serial}`,
        model_id: tier.leaf_model_id,
        role: 'leaf',
        ru: ru(sw),
        power_w: powerW(sw),
        label: `Leaf ${leaf_serial} (${tier.leaf_model_id})`,
        pod_index: Math.floor(i / 2)
      })
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Spines: distribute across separate racks (HA), one rack at a time.
  // ──────────────────────────────────────────────────────────────────
  const spine_queue = queue.filter((q) => q.role === 'spine')
  let rackCursor = 0
  for (const s of spine_queue) {
    let placed = false
    for (let attempt = 0; attempt < layout.length; attempt++) {
      const rack = layout[(rackCursor + attempt) % layout.length]
      if (pushDevice(rack, s)) {
        placed = true
        rackCursor = (rackCursor + attempt + 1) % layout.length
        break
      }
    }
    if (!placed) {
      warnings.push({
        code: 'RACK_INSUFFICIENT_SPACE',
        severity: 'error',
        message: `Could not place ${s.label} — no rack has room or PDU headroom.`,
        context: { device_id: s.device_id, model_id: s.model_id }
      })
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Leaves: pack pods together. Each pod (2 leaves) prefers an empty
  // rack first; falls back to any rack that fits.
  // ──────────────────────────────────────────────────────────────────
  const leaves_by_pod = new Map<number, PendingDevice[]>()
  for (const q of queue) {
    if (q.role !== 'leaf' || q.pod_index == null) continue
    const arr = leaves_by_pod.get(q.pod_index) ?? []
    arr.push(q)
    leaves_by_pod.set(q.pod_index, arr)
  }
  const sorted_pods = [...leaves_by_pod.keys()].sort((a, b) => a - b)

  for (const pod of sorted_pods) {
    const members = leaves_by_pod.get(pod)!

    // Try racks in order: prefer ones with fewer leaves so far.
    const sortedRacks = [...layout].sort((a, b) => {
      const aLeaves = a.devices.filter((d) => d.role === 'leaf').length
      const bLeaves = b.devices.filter((d) => d.role === 'leaf').length
      return aLeaves - bLeaves
    })

    let pod_placed = false
    for (const rack of sortedRacks) {
      const snapshot = {
        devices: [...rack.devices],
        power: rack.estimated_power_w
      }
      let allFit = true
      for (const m of members) {
        if (!pushDevice(rack, m)) {
          allFit = false
          break
        }
      }
      if (allFit) {
        pod_placed = true
        break
      }
      rack.devices = snapshot.devices
      rack.estimated_power_w = snapshot.power
    }

    if (!pod_placed) {
      // Last-resort: split the pod across racks rather than fail.
      for (const m of members) {
        let placed = false
        for (const rack of layout) {
          if (pushDevice(rack, m)) {
            placed = true
            break
          }
        }
        if (!placed) {
          warnings.push({
            code: 'RACK_INSUFFICIENT_SPACE',
            severity: 'error',
            message: `Could not place ${m.label} — racks are full or over PDU budget.`,
            context: { device_id: m.device_id, model_id: m.model_id }
          })
        }
      }
    }
  }

  for (const rack of layout) {
    if (rack.pdu_kw_budget != null && rack.estimated_power_w / 1000 > rack.pdu_kw_budget) {
      rack.over_budget = true
      warnings.push({
        code: 'RACK_OVER_PDU_BUDGET',
        severity: 'error',
        message: `Rack "${rack.rack_name}" estimated ${(rack.estimated_power_w / 1000).toFixed(2)}kW exceeds PDU budget ${rack.pdu_kw_budget}kW.`,
        context: {
          rack: rack.rack_name,
          estimated_kw: Number((rack.estimated_power_w / 1000).toFixed(3)),
          budget_kw: rack.pdu_kw_budget
        }
      })
    }
  }

  return { layout, warnings }
}
