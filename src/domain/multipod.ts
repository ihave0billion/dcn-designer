import { computeSpine } from './spine'
import { pickUplinkGroup } from './tier'
import { placeRacks, synthesizeLogicalLayout } from './rack'
import type {
  NexusDashboardResult,
  BreakoutAnalysis,
  BreakoutPair,
  CandidateId,
  DesignCandidate,
  FabricRequest,
  IpnRouterSpec,
  MultiPodAnalysis,
  OpticsBomEntry,
  RackDevicePlacement,
  RackInventoryEntry,
  RackPlacement,
  SolverWarning,
  SpineResult,
  SwitchSpec,
  TierResult
} from './types'

// Phase 2b — solver-global constants (decision 2026-05-18).
// `IPN_PORTS_PER_SPINE_PER_IPN` is the Cisco reference reservation:
// each spine in each pod consumes this many ports per IPN router it
// connects to. With the HA default of 2 IPN routers, that's 8 spine
// ports per spine reserved for IPN connectivity.
export const IPN_PORTS_PER_SPINE_PER_IPN = 4
export const IPN_HA_MIN = 2

// Solver-suggested IPN rack (Phase 9b). When a multi-pod candidate is
// committed the IPN routers land here; the Design-view commit handler
// adds a matching "IPN" entry to requirements.racks so Rack View renders
// it (Rack View is driven by requirements.racks).
export const IPN_RACK_NAME = 'IPN'
export const IPN_RACK_SIZE_U = 44
const DEFAULT_IPN_RU = 1
const DEFAULT_IPN_POWER_W = 800

const HA_MIN_SPINES = 2 // v8 rule 7
const FANOUT_WITH_BREAKOUT = 4

// Map each fabric device id to its 0-based ACI pod. Spine ids are
// `spine-1..total_spines`, chunked by spines_per_pod; leaf ids are
// `leaf-1..total_leaves`, chunked by the leaves_per_pod split. Mirrors
// the device-id scheme placeRacks() emits so we can annotate its output.
function buildPodIndexMaps(
  total_spines: number,
  spines_per_pod: number,
  leaves_per_pod: number[]
): { spinePod: Map<string, number>; leafPod: Map<string, number> } {
  const spinePod = new Map<string, number>()
  for (let i = 0; i < total_spines; i++) {
    const pod = spines_per_pod > 0 ? Math.floor(i / spines_per_pod) : 0
    spinePod.set(`spine-${i + 1}`, pod)
  }
  const leafPod = new Map<string, number>()
  let serial = 0
  for (let pod = 0; pod < leaves_per_pod.length; pod++) {
    for (let k = 0; k < leaves_per_pod[pod]; k++) {
      serial += 1
      leafPod.set(`leaf-${serial}`, pod)
    }
  }
  return { spinePod, leafPod }
}

// Annotate a flat (single-pod-style) rack layout with ACI pod_index per
// spine/leaf and append a dedicated IPN rack carrying `ipn_count`
// routers. Returns a new layout array; the input is not mutated. When
// the layout is empty (no rack inventory) it's returned unchanged — the
// IPN rack is only meaningful alongside placed spines/leaves.
export function annotateMultiPodLayout(
  layout: RackPlacement[],
  opts: {
    total_spines: number
    spines_per_pod: number
    leaves_per_pod: number[]
    ipn_router: IpnRouterSpec
    ipn_count: number
  }
): RackPlacement[] {
  if (layout.length === 0) return layout
  const { spinePod, leafPod } = buildPodIndexMaps(
    opts.total_spines,
    opts.spines_per_pod,
    opts.leaves_per_pod
  )
  const annotated: RackPlacement[] = layout.map((rack) => ({
    ...rack,
    devices: rack.devices.map((d) => {
      if (d.role === 'spine') return { ...d, pod_index: spinePod.get(d.device_id) ?? null }
      if (d.role === 'leaf') return { ...d, pod_index: leafPod.get(d.device_id) ?? null }
      return { ...d, pod_index: null }
    })
  }))

  // Build the IPN rack (top-of-rack packed, HA routers stacked downward).
  const ipn_ru = opts.ipn_router.ru ?? DEFAULT_IPN_RU
  const ipn_power = opts.ipn_router.power_w ?? DEFAULT_IPN_POWER_W
  const ipnDevices: RackDevicePlacement[] = []
  for (let i = 0; i < opts.ipn_count; i++) {
    ipnDevices.push({
      device_id: `ipn-${i + 1}`,
      model_id: opts.ipn_router.id,
      role: 'ipn' as const,
      start_u: IPN_RACK_SIZE_U - i * ipn_ru - ipn_ru + 1,
      ru: ipn_ru,
      label: `IPN ${i + 1} (${opts.ipn_router.id})`,
      pod_index: null
    })
  }
  annotated.push({
    rack_name: IPN_RACK_NAME,
    size_u: IPN_RACK_SIZE_U,
    pdu_kw_budget: null,
    estimated_power_w: ipn_power * opts.ipn_count,
    devices: ipnDevices,
    over_budget: false
  })
  return annotated
}

// Mirrors the same heuristic as spine.ts: a 'spine'-role switch
// presents `primary` as its downlink surface, a 'both'-role switch
// reuses pickUplinkGroup when it has one.
function pickSpinePorts(sw: SwitchSpec): { ports: number; speed_g: number } {
  if (sw.role === 'spine') {
    return { ports: sw.primary.ports, speed_g: sw.primary.speed_g }
  }
  const picked = pickUplinkGroup(sw)
  if (picked) return { ports: picked.ports, speed_g: picked.speed_g }
  return { ports: sw.primary.ports, speed_g: sw.primary.speed_g }
}

// Round-robin even split: distribute `total` across `pods` so the
// largest pod is at most 1 more than the smallest, descending order.
// Decision 2026-05-18 (Phase 2b interview): deterministic, no user
// input; 111 leaves over 2 pods → [56, 55].
export function distributeEvenly(total: number, pods: number): number[] {
  if (pods <= 0 || total < 0) return []
  const base = Math.floor(total / pods)
  const rem = total - base * pods
  const out: number[] = []
  for (let i = 0; i < pods; i++) {
    out.push(base + (i < rem ? 1 : 0))
  }
  return out
}

// Multi-pod sizing: minimum pods so each pod fits within the HA-floor
// spine count after IPN port reservation. Caps the explored range at
// 16 pods — exceeding that is almost certainly a sizing mistake the
// user wants surfaced as INVALID rather than a deeper search.
function computeMinPods(
  total_leaves: number,
  uplinks_per_leaf: number,
  effective_spine_ports: number,
  fanout: number
): number {
  if (total_leaves <= 0 || effective_spine_ports <= 0 || uplinks_per_leaf <= 0) {
    return IPN_HA_MIN
  }
  const max_leaves_per_pod = Math.floor(
    (HA_MIN_SPINES * effective_spine_ports * fanout) / uplinks_per_leaf
  )
  if (max_leaves_per_pod <= 0) return IPN_HA_MIN
  return Math.max(IPN_HA_MIN, Math.ceil(total_leaves / max_leaves_per_pod))
}

// Scales the active tier results into a "synthetic per-pod tier set"
// — same leaf models and per-row uplink characteristics, but with
// `leaves_required` reduced to `pod_leaf_count` (round-robin across
// tiers) and `host_bw_g`/`uplink_bw_g` scaled proportionally.
//
// Why: computeSpine consumes TierResult[] and reads leaves_required +
// uplink_bw_g. To reuse the same spine math under a per-pod view,
// we pass in a scaled copy rather than duplicating the algorithm.
function scaleTiersForPod(
  tiers: TierResult[],
  total_leaves: number,
  pod_leaf_count: number
): TierResult[] {
  if (total_leaves <= 0 || pod_leaf_count <= 0) return tiers.map((t) => ({ ...t }))
  const scale = pod_leaf_count / total_leaves
  return tiers.map((t) => {
    if (t.xor_status !== 'ok' || t.leaves_required <= 0) return { ...t }
    const pod_leaves = Math.round(t.leaves_required * scale)
    const pod_host_bw = t.host_bw_g * scale
    const pod_uplink_bw = t.uplink_bw_g * scale
    return {
      ...t,
      leaves_required: pod_leaves,
      host_bw_g: pod_host_bw,
      uplink_bw_g: pod_uplink_bw
    }
  })
}

// Patch a spine switch's effective port count by IPN reservation.
// The id stays the same so downstream consumers (rack placement,
// candidate.spine.spine_model_id) report the real model. Only the
// `ports` value changes for math purposes.
function spineWithReservedPortsForIpn(
  sw: SwitchSpec,
  ipn_routers_count: number
): SwitchSpec {
  const reservation = ipn_routers_count * IPN_PORTS_PER_SPINE_PER_IPN
  const native = pickSpinePorts(sw).ports
  const effective = Math.max(0, native - reservation)
  // Mirror the same group structure spine.ts reads. For 'spine'-role
  // switches that's primary; for 'both'-role we modify primary too
  // since pickSpinePorts falls back to primary when no uplink group
  // is declared.
  if (sw.role === 'spine' || !pickUplinkGroup(sw)) {
    return { ...sw, primary: { ...sw.primary, ports: effective } }
  }
  // 'both'-role with an uplink group — patch whichever side
  // pickSpinePorts will select (higher per-port speed). Easier: patch
  // both groups symmetrically; pickSpinePorts only reads one.
  return {
    ...sw,
    primary: { ...sw.primary, ports: effective },
    uplink: sw.uplink ? { ...sw.uplink, ports: effective } : null,
    secondary_uplink: sw.secondary_uplink
      ? { ...sw.secondary_uplink, ports: effective }
      : null
  }
}

// Minimal optics BOM for a candidate — same shape as solver.ts but
// computed against the candidate's own spine/breakout view. Kept here
// to avoid circular imports with solver.ts.
function buildCandidateOpticsBom(
  tiers: TierResult[],
  spine: SpineResult | null,
  breakout: BreakoutAnalysis | null,
  uplinks_per_leaf: number,
  pod_count: number
): OpticsBomEntry[] {
  if (!spine || !breakout) return []
  const active = tiers.filter((t) => t.xor_status === 'ok' && t.leaves_required > 0)
  const bom: OpticsBomEntry[] = []
  const total_leaf_uplinks = active.reduce(
    (acc, t) => acc + t.leaves_required * uplinks_per_leaf,
    0
  )
  if (total_leaf_uplinks <= 0) return bom

  if (breakout.recommended_pair && (breakout.reduces_spine_count || breakout.flips_to_valid)) {
    bom.push({
      optic_id: breakout.recommended_pair.spine_pid,
      // For multi-pod the spine count is per-pod; total across fabric
      // is spines_with_breakout × pod_count. We report fabric totals
      // so the BOM is order-ready.
      count: breakout.spines_with_breakout * spine.spine_ports * pod_count,
      scenario: 'S3',
      location: 'spine',
      notes: pod_count > 1
        ? `Breakout 1×→${breakout.fanout}× across ${pod_count} pods`
        : `Breakout 1×→${breakout.fanout}×`
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

function formatOversub(host_g: number, uplink_g: number): {
  ratio: number
  label: string
} {
  if (uplink_g <= 0 || host_g <= 0) return { ratio: 0, label: '—' }
  const ratio = host_g / uplink_g
  return { ratio, label: `${ratio.toFixed(2)}:1` }
}

export interface BuildCandidatesInput {
  tiers: TierResult[]
  spine_switch: SwitchSpec | null
  ipn_router: IpnRouterSpec | null
  fabric: FabricRequest
  breakout_pairs: BreakoutPair[]
  switches: SwitchSpec[]
  rack_inventory: RackInventoryEntry[]
  /** Phase 16 — physical rows of racks; see SolverRequirements.racks_per_row. */
  racks_per_row?: number | null
  /** Phase 17 — the planned Nexus Dashboard cluster (racked in every candidate). */
  nexus_dashboard?: NexusDashboardResult | null
  /**
   * Phase 10 — warnings raised before candidate construction (tier math,
   * unknown spine model, use-case constraints). They describe the inputs,
   * not a pod/breakout strategy, so any blocking error here invalidates
   * every candidate. Without this, a broken tier left the matrix all-valid
   * while the top-level summary said invalid — the committed-candidate
   * projection then overwrote the truthful verdict.
   */
  base_warnings?: SolverWarning[]
}

export interface BuildCandidatesOutput {
  candidates: DesignCandidate[]
  primary_candidate_id: CandidateId
  // Warnings the *fabric* surfaces above the candidate matrix — used
  // for cross-cutting signals like MULTIPOD_RECOMMENDED (when the
  // single-pod candidates are all invalid but multi-pod ones are).
  fabric_warnings: SolverWarning[]
}

// Build all four candidates. License gate (aci_multipod_allowed=false)
// is applied here by tagging multi-pod candidates with
// MULTIPOD_LICENSE_BLOCKED and marking them invalid.
export function buildCandidates(input: BuildCandidatesInput): BuildCandidatesOutput {
  const { tiers, spine_switch, ipn_router, fabric, breakout_pairs, switches, rack_inventory } =
    input
  const racks_per_row = input.racks_per_row ?? null
  const nd = input.nexus_dashboard ?? null
  const aci_multipod_allowed = fabric.aci_multipod_allowed !== false // default true
  const base_blocking = (input.base_warnings ?? []).filter((w) => w.severity === 'error')

  let candidates: DesignCandidate[] = [
    buildSinglePodCandidate('single_no_breakout', false, tiers, spine_switch, fabric, breakout_pairs, switches, rack_inventory, racks_per_row, nd),
    buildSinglePodCandidate('single_with_breakout', true, tiers, spine_switch, fabric, breakout_pairs, switches, rack_inventory, racks_per_row, nd),
    buildMultiPodCandidate('multi_no_breakout', false, tiers, spine_switch, ipn_router, fabric, breakout_pairs, switches, rack_inventory, racks_per_row, !aci_multipod_allowed, nd),
    buildMultiPodCandidate('multi_with_breakout', true, tiers, spine_switch, ipn_router, fabric, breakout_pairs, switches, rack_inventory, racks_per_row, !aci_multipod_allowed, nd)
  ]

  if (base_blocking.length > 0) {
    candidates = candidates.map((c) => ({
      ...c,
      valid: false,
      warnings: [...base_blocking, ...c.warnings]
    }))
  }

  const primary_candidate_id = pickPrimaryCandidate(candidates)

  // Cross-cutting fabric warnings. MULTIPOD_RECOMMENDED when no single-
  // pod candidate is valid but at least one multi-pod is.
  // MULTIPOD_REQUIRED when single-pod is structurally insufficient
  // (port-count blocker exists, only multi can save it).
  const fabric_warnings: SolverWarning[] = []
  const singles_valid = candidates
    .filter((c) => c.pod_variant === 'single')
    .some((c) => c.valid)
  const multis_valid = candidates
    .filter((c) => c.pod_variant === 'multi')
    .some((c) => c.valid)
  if (!singles_valid && multis_valid) {
    const single_blocker = candidates
      .find((c) => c.pod_variant === 'single' && !c.valid)
      ?.warnings.find((w) =>
        ['SPINE_PORTS_INSUFFICIENT', 'EXTRA_UPLINKS_NEEDED'].includes(w.code)
      )
    fabric_warnings.push({
      code: single_blocker?.code === 'SPINE_PORTS_INSUFFICIENT'
        ? 'MULTIPOD_REQUIRED'
        : 'MULTIPOD_RECOMMENDED',
      severity: 'warn',
      message:
        single_blocker?.code === 'SPINE_PORTS_INSUFFICIENT'
          ? 'Single-pod cannot fit this design — Multi-Pod ACI is required.'
          : 'Single-pod is invalid as configured — consider Multi-Pod ACI (a valid candidate exists).',
      context: { primary: primary_candidate_id }
    })
  }

  return { candidates, primary_candidate_id, fabric_warnings }
}

function buildSinglePodCandidate(
  id: 'single_no_breakout' | 'single_with_breakout',
  with_breakout: boolean,
  tiers: TierResult[],
  spine_switch: SwitchSpec | null,
  fabric: FabricRequest,
  breakout_pairs: BreakoutPair[],
  switches: SwitchSpec[],
  rack_inventory: RackInventoryEntry[],
  racks_per_row: number | null,
  nd: NexusDashboardResult | null = null
): DesignCandidate {
  const comp = computeSpine(
    tiers,
    spine_switch,
    fabric.uplinks_per_leaf,
    fabric.uplinks_per_spine,
    breakout_pairs
  )

  const active = tiers.filter((t) => t.xor_status === 'ok' && t.leaves_required > 0)
  const total_host_bw_g = active.reduce((acc, t) => acc + t.host_bw_g, 0)
  const total_uplink_bw_g = active.reduce((acc, t) => acc + t.uplink_bw_g, 0)
  const oversub = formatOversub(total_host_bw_g, total_uplink_bw_g)

  // The candidate's spine count depends on which variant: the
  // breakout variant uses breakout.spines_with_breakout, the no-
  // breakout uses spines_needed.
  const total_spines = with_breakout
    ? comp.breakout?.spines_with_breakout ?? comp.spine?.spines_needed ?? 0
    : comp.spine?.spines_needed ?? 0

  // Validity mirrors Phase 2's rules but applied to *this* variant:
  // - blocking errors (severity 'error') in computeSpine's warnings
  //   carry over; for the breakout variant we ignore EXTRA_UPLINKS_NEEDED
  //   when breakout flips it to valid.
  const blocking = comp.warnings.filter((w) => w.severity === 'error')
  let valid: boolean
  if (with_breakout) {
    // Breakout variant is invalid when:
    //  - breakout is not physically applicable (leaf/spine speeds), or
    //  - even with breakout, required_uplinks_per_leaf exceeds configured.
    const breakout_applicable = comp.breakout?.applicable ?? false
    const uplinks_per_leaf_with_breakout = comp.breakout?.uplinks_per_leaf_with_breakout ?? Infinity
    const breakout_valid_in_uplinks = uplinks_per_leaf_with_breakout <= fabric.uplinks_per_leaf
    const non_uplink_blocking = blocking.filter(
      (w) => w.code !== 'EXTRA_UPLINKS_NEEDED' && w.code !== 'SPINE_PORTS_INSUFFICIENT'
    )
    valid = breakout_applicable && breakout_valid_in_uplinks && non_uplink_blocking.length === 0
  } else {
    valid = blocking.length === 0
  }

  // Per-candidate warnings: include all from computeSpine, plus
  // explicit "breakout not applicable" for the with_breakout variant
  // when speeds don't permit it.
  const warnings: SolverWarning[] = [...comp.warnings]
  if (with_breakout && comp.breakout && !comp.breakout.applicable) {
    warnings.push({
      code: 'SPINE_PORTS_INSUFFICIENT',
      severity: 'error',
      message:
        'Breakout (4:1) is not physically applicable for this leaf/spine speed pair — this candidate cannot be valid.',
      context: { fanout: FANOUT_WITH_BREAKOUT }
    })
  }

  // Rack placement at fabric scale (same call Phase 2 makes for
  // single-pod). For the with_breakout variant we substitute the
  // spines_needed value with spines_with_breakout so the rack layout
  // reflects the actual physical spine count.
  const spine_for_racks: SpineResult | null = comp.spine
    ? { ...comp.spine, spines_needed: total_spines }
    : null
  const rackResult = placeRacks(spine_for_racks, tiers, switches, rack_inventory, racks_per_row, nd)
  warnings.push(...rackResult.warnings)

  const optics_bom = buildCandidateOpticsBom(
    tiers,
    comp.spine,
    comp.breakout,
    fabric.uplinks_per_leaf,
    1 // single pod
  )

  return {
    id,
    pod_variant: 'single',
    breakout_variant: with_breakout ? 'with_breakout' : 'no_breakout',
    valid,
    spine: comp.spine,
    breakout: comp.breakout,
    multipod: null,
    rack_layout: rackResult.layout,
    optics_bom,
    warnings,
    total_spines,
    total_ipn_routers: 0,
    total_host_bw_g,
    total_uplink_bw_g,
    computed_oversub_ratio: oversub.ratio,
    computed_oversub_label: oversub.label
  }
}

function buildMultiPodCandidate(
  id: 'multi_no_breakout' | 'multi_with_breakout',
  with_breakout: boolean,
  tiers: TierResult[],
  spine_switch: SwitchSpec | null,
  ipn_router: IpnRouterSpec | null,
  fabric: FabricRequest,
  breakout_pairs: BreakoutPair[],
  switches: SwitchSpec[],
  rack_inventory: RackInventoryEntry[],
  racks_per_row: number | null,
  license_blocked: boolean,
  nd: NexusDashboardResult | null = null
): DesignCandidate {
  const warnings: SolverWarning[] = []
  const active = tiers.filter((t) => t.xor_status === 'ok' && t.leaves_required > 0)
  const total_leaves = active.reduce((acc, t) => acc + t.leaves_required, 0)
  const total_host_bw_g = active.reduce((acc, t) => acc + t.host_bw_g, 0)
  const total_uplink_bw_g = active.reduce((acc, t) => acc + t.uplink_bw_g, 0)
  const oversub = formatOversub(total_host_bw_g, total_uplink_bw_g)
  const fanout = with_breakout ? FANOUT_WITH_BREAKOUT : 1

  if (license_blocked) {
    warnings.push({
      code: 'MULTIPOD_LICENSE_BLOCKED',
      severity: 'error',
      message:
        'Multi-Pod ACI is not allowed by current settings (fabric.aci_multipod_allowed = false).',
      context: {}
    })
  }
  if (!ipn_router) {
    warnings.push({
      code: 'IPN_MODEL_NOT_SELECTED',
      severity: 'error',
      message:
        'No IPN router available in the library. Phase 9b ships an explicit picker; until then, seed at least one entry in ipn_routers.yaml.',
      context: { ipn_router_model_id: fabric.ipn_router_model_id ?? null }
    })
  }
  if (!spine_switch) {
    // Mirror computeSpine's behavior: surface the missing spine but
    // keep building the candidate with a null SpineResult so the
    // matrix is always 4 entries.
    warnings.push({
      code: 'NO_SPINE_MODEL_SELECTED',
      severity: 'error',
      message: 'No spine model selected — multi-pod candidate cannot be sized.'
    })
    return emptyMultipodCandidate(id, with_breakout, warnings, total_host_bw_g, total_uplink_bw_g, oversub)
  }

  // Effective spine ports = native ports - (IPN HA × ports per IPN).
  const native_spine_ports = pickSpinePorts(spine_switch).ports
  const effective_spine_ports = Math.max(0, native_spine_ports - IPN_HA_MIN * IPN_PORTS_PER_SPINE_PER_IPN)

  if (effective_spine_ports <= 0) {
    warnings.push({
      code: 'SPINE_PORTS_INSUFFICIENT',
      severity: 'error',
      message: `Spine "${spine_switch.id}" has only ${native_spine_ports} ports — fewer than the ${IPN_HA_MIN * IPN_PORTS_PER_SPINE_PER_IPN} required for IPN reservation.`,
      context: { native_spine_ports, ipn_reservation: IPN_HA_MIN * IPN_PORTS_PER_SPINE_PER_IPN }
    })
    return emptyMultipodCandidate(id, with_breakout, warnings, total_host_bw_g, total_uplink_bw_g, oversub)
  }

  const pods_needed = computeMinPods(
    total_leaves,
    fabric.uplinks_per_leaf,
    effective_spine_ports,
    fanout
  )
  const leaves_per_pod = distributeEvenly(total_leaves, pods_needed)
  const max_pod_leaves = Math.max(...leaves_per_pod, 0)

  // Per-pod spine math via the existing computeSpine engine, fed a
  // synthetic per-pod tier set and a port-reduced spine switch.
  const per_pod_tiers = scaleTiersForPod(tiers, total_leaves, max_pod_leaves)
  const per_pod_spine_switch = spineWithReservedPortsForIpn(spine_switch, IPN_HA_MIN)
  const per_pod_comp = computeSpine(
    per_pod_tiers,
    per_pod_spine_switch,
    fabric.uplinks_per_leaf,
    fabric.uplinks_per_spine,
    breakout_pairs
  )

  // Per-pod warnings forwarding: computeSpine emits warnings from the
  // *no-breakout* perspective (e.g. EXTRA_UPLINKS_NEEDED when the
  // user's uplinks_per_leaf falls short of the unfanned-out spine
  // count). For the multi_with_breakout candidate we ignore those if
  // breakout flips the per-pod design to valid — same pattern as
  // buildSinglePodCandidate. For multi_no_breakout we always forward.
  const per_pod_uplinks_with_breakout =
    per_pod_comp.breakout?.uplinks_per_leaf_with_breakout ?? Infinity
  const per_pod_breakout_fixes_uplinks =
    with_breakout && per_pod_uplinks_with_breakout <= fabric.uplinks_per_leaf
  for (const w of per_pod_comp.warnings) {
    if (w.code === 'EXTRA_UPLINKS_NEEDED' || w.code === 'SPINE_PORTS_INSUFFICIENT') {
      if (per_pod_breakout_fixes_uplinks) continue
      warnings.push({ ...w, context: { ...w.context, scope: 'per_pod' } })
    }
  }

  const spines_per_pod = with_breakout
    ? per_pod_comp.breakout?.spines_with_breakout ?? per_pod_comp.spine?.spines_needed ?? HA_MIN_SPINES
    : per_pod_comp.spine?.spines_needed ?? HA_MIN_SPINES
  const total_spines = spines_per_pod * pods_needed

  // IPN port budget check.
  const ipn_routers_needed = IPN_HA_MIN
  if (ipn_router) {
    const required_ipn_ports = total_spines * IPN_PORTS_PER_SPINE_PER_IPN
    if (required_ipn_ports > ipn_router.primary.ports) {
      warnings.push({
        code: 'IPN_PORTS_INSUFFICIENT',
        severity: 'error',
        message: `IPN router "${ipn_router.id}" has ${ipn_router.primary.ports} ports — needs ${required_ipn_ports} for ${total_spines} spines × ${IPN_PORTS_PER_SPINE_PER_IPN} ports each.`,
        context: {
          ipn_id: ipn_router.id,
          available_ports: ipn_router.primary.ports,
          required_ports: required_ipn_ports,
          total_spines
        }
      })
    }
  }

  // Breakout physical applicability — same check spine.ts uses.
  if (with_breakout && per_pod_comp.breakout && !per_pod_comp.breakout.applicable) {
    warnings.push({
      code: 'SPINE_PORTS_INSUFFICIENT',
      severity: 'error',
      message:
        'Breakout (4:1) is not physically applicable for this leaf/spine speed pair — multi-pod candidate cannot use breakout.',
      context: { fanout: FANOUT_WITH_BREAKOUT }
    })
  }

  // Build a candidate-level SpineResult that reports the per-pod
  // shape (so consumers can render "spines per pod = N") while
  // total_spines on the candidate carries the fabric count.
  const spineResult: SpineResult | null = per_pod_comp.spine
    ? {
        ...per_pod_comp.spine,
        // Restore the real model id (per_pod_spine_switch is internal).
        spine_model_id: spine_switch.id,
        // Report native ports so UI consumers know the hardware spec;
        // effective port figure lives in MultiPodAnalysis.
        spine_ports: native_spine_ports,
        spines_needed: spines_per_pod,
        total_leaves: max_pod_leaves,
        total_leaf_uplinks: max_pod_leaves * fabric.uplinks_per_leaf
      }
    : null

  const breakoutResult: BreakoutAnalysis | null = per_pod_comp.breakout
    ? {
        ...per_pod_comp.breakout,
        // For multi-pod the breakout count is per-pod (the per_pod_comp
        // already returned this view); leave as-is.
        spines_with_breakout: spines_per_pod
      }
    : null

  const multipod: MultiPodAnalysis = {
    pods_needed,
    leaves_per_pod,
    spines_per_pod,
    ipn_routers_needed,
    ipn_router_model_id: ipn_router?.id ?? null,
    ports_per_spine_per_ipn: IPN_PORTS_PER_SPINE_PER_IPN,
    spine_to_ipn_links: total_spines * ipn_routers_needed * IPN_PORTS_PER_SPINE_PER_IPN,
    effective_spine_ports
  }

  // Rack layout for the fabric-wide spine count. Phase 9b annotates the
  // flat placement with ACI pod_index per spine/leaf and appends a
  // dedicated IPN rack carrying the HA IPN routers.
  const rack_spine_for_layout: SpineResult | null = per_pod_comp.spine
    ? { ...per_pod_comp.spine, spine_model_id: spine_switch.id, spines_needed: total_spines, spine_ports: native_spine_ports }
    : null
  const rackResult = placeRacks(rack_spine_for_layout, tiers, switches, rack_inventory, racks_per_row, nd)
  warnings.push(...rackResult.warnings)
  // When no rack inventory exists, placeRacks returns an empty layout. A
  // multi-pod design must still expose its full device set (every spine,
  // every leaf, both IPN routers) so the Topology graph and the
  // cable-links seeder render the committed candidate rather than falling
  // back to the flat per-pod spine count. Synthesize a logical (unracked)
  // layout in that case; annotateMultiPodLayout then pod-tags it and
  // appends the dedicated IPN rack.
  const base_layout =
    rackResult.layout.length > 0
      ? rackResult.layout
      : synthesizeLogicalLayout(rack_spine_for_layout, tiers, switches, nd)
  const rack_layout = ipn_router
    ? annotateMultiPodLayout(base_layout, {
        total_spines,
        spines_per_pod,
        leaves_per_pod,
        ipn_router,
        ipn_count: ipn_routers_needed
      })
    : base_layout

  const optics_bom = buildCandidateOpticsBom(
    per_pod_tiers,
    per_pod_comp.spine,
    per_pod_comp.breakout,
    fabric.uplinks_per_leaf,
    pods_needed
  )

  // Validity verdict.
  const blocking = warnings.filter((w) => w.severity === 'error')
  const valid = blocking.length === 0

  return {
    id,
    pod_variant: 'multi',
    breakout_variant: with_breakout ? 'with_breakout' : 'no_breakout',
    valid,
    spine: spineResult,
    breakout: breakoutResult,
    multipod,
    rack_layout,
    optics_bom,
    warnings,
    total_spines,
    total_ipn_routers: ipn_routers_needed,
    total_host_bw_g,
    total_uplink_bw_g,
    computed_oversub_ratio: oversub.ratio,
    computed_oversub_label: oversub.label
  }
}

function emptyMultipodCandidate(
  id: 'multi_no_breakout' | 'multi_with_breakout',
  with_breakout: boolean,
  warnings: SolverWarning[],
  total_host_bw_g: number,
  total_uplink_bw_g: number,
  oversub: { ratio: number; label: string }
): DesignCandidate {
  return {
    id,
    pod_variant: 'multi',
    breakout_variant: with_breakout ? 'with_breakout' : 'no_breakout',
    valid: false,
    spine: null,
    breakout: null,
    multipod: null,
    rack_layout: [],
    optics_bom: [],
    warnings,
    total_spines: 0,
    total_ipn_routers: 0,
    total_host_bw_g,
    total_uplink_bw_g,
    computed_oversub_ratio: oversub.ratio,
    computed_oversub_label: oversub.label
  }
}

// Auto-promote rule: simplest valid wins. Order is (pods asc, breakout
// asc). When no candidate is valid, fall back to single_no_breakout
// (the canonical Phase 2 view) so consumers always have something to
// render at the top level.
export function pickPrimaryCandidate(candidates: DesignCandidate[]): CandidateId {
  const order: CandidateId[] = [
    'single_no_breakout',
    'single_with_breakout',
    'multi_no_breakout',
    'multi_with_breakout'
  ]
  for (const id of order) {
    const c = candidates.find((x) => x.id === id)
    if (c?.valid) return id
  }
  return 'single_no_breakout'
}
