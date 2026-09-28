import { z } from 'zod'

// ────────────────────────────────────────────────────────────────────
// Catalog (subset of the library schemas the solver actually reads)
// ────────────────────────────────────────────────────────────────────

export interface PortGroupSpec {
  ports: number
  speed_g: number
}

export interface SwitchCapabilitiesSpec {
  rocev2: boolean
  aci_leaf?: boolean
  aci_spine?: boolean
  nxos?: boolean
  // Phase 14 — a smart switch (integrated DPU) keeps its peer-link on the
  // fastest uplink group even when that costs spine uplinks (decision 3).
  smart_switch?: boolean
}

export type PortGroupName = 'uplink' | 'secondary_uplink' | 'primary'

export interface SwitchSpec {
  id: string
  role: 'spine' | 'leaf' | 'both'
  primary: PortGroupSpec
  uplink: PortGroupSpec | null
  secondary_uplink: PortGroupSpec | null
  ru: number | null
  power_w: number | null
  capabilities: SwitchCapabilitiesSpec
  // Phase 14 — which port group the library's `peer_link_ports` template
  // names (null/undefined = the default rule in vpc.ts chooses).
  peer_link_group?: PortGroupName | null
}

export interface ServerSpec {
  id: string
  ru: number | null
  power_w: number | null
}

// IPN router — Phase 2b. Lives in its own library file (decision
// 2026-05-18) so SwitchSpec stays focused on leaf/spine concerns and
// IPN-specific fields (multipod, multisite, MPLS handoff) don't have
// to be optional on every switch.
export interface IpnRouterCapabilitiesSpec {
  multipod: boolean
  multisite?: boolean
  mpls_handoff?: boolean
}

export interface IpnRouterSpec {
  id: string
  primary: PortGroupSpec
  ru: number | null
  power_w: number | null
  capabilities: IpnRouterCapabilitiesSpec
}

export const IpnRouterSchema = z.object({
  id: z.string().min(1),
  model_display: z.string().min(1).optional(),
  vendor: z.string().min(1).optional(),
  primary: z.object({
    ports: z.number().int().positive(),
    speed_g: z.number().positive(),
    speed_options_g: z.array(z.number().positive()).optional(),
    naming_template: z.string().optional()
  }),
  ru: z.number().nullable(),
  power_w: z.number().nullable(),
  capabilities: z.object({
    multipod: z.boolean(),
    multisite: z.boolean().optional(),
    mpls_handoff: z.boolean().optional()
  }),
  availability: z.string().optional(),
  notes: z.string().optional(),
  // Phase 13 — Visio export hints (see renderer/schemas/switches.ts VisioHintSchema)
  visio: z
    .object({ master: z.string().nullable().default(null), image: z.string().nullable().default(null) })
    .optional()
})
export type IpnRouterFileEntry = z.infer<typeof IpnRouterSchema>

export const IpnRoutersFileSchema = z.object({
  schema_version: z.literal(1),
  ipn_routers: z.array(IpnRouterSchema)
})
export type IpnRoutersFile = z.infer<typeof IpnRoutersFileSchema>

// ────────────────────────────────────────────────────────────────────
// Breakout pairs (loaded from seed/breakout_pairs.yaml or workspace)
// ────────────────────────────────────────────────────────────────────

export const BreakoutPairSchema = z.object({
  spine_pid: z.string().min(1),
  leaf_pid: z.string().min(1),
  fanout: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]),
  spine_connector: z.string().min(1),
  leaf_connector: z.string().min(1),
  requires_patch_panel: z.boolean(),
  verified_by: z.string().min(1),
  notes: z.string().nullable().optional()
})
export type BreakoutPair = z.infer<typeof BreakoutPairSchema>

export const BreakoutPairsFileSchema = z.object({
  schema_version: z.literal(1),
  pairs: z.array(BreakoutPairSchema)
})
export type BreakoutPairsFile = z.infer<typeof BreakoutPairsFileSchema>

// ────────────────────────────────────────────────────────────────────
// Solver inputs
// ────────────────────────────────────────────────────────────────────

export type UseCase = 'dcn' | 'ai' | 'hpc' | 'storage'
export type InputMode = 'aggregate' | 'per_leaf'

// One row in the leaf-tier design table. Either endpoint_count XOR
// switch_count is set (v8 hard rule 8); both null means the row is
// empty.
export interface TierRequest {
  speed_tier_label: string // free-text label like "25G" — display only
  endpoint_count: number | null
  switch_count: number | null
  leaf_model_id: string | null // null → row is skipped
  override_uplink_speed_g: number | null
  // Phase 14 — server model of the tier (display only: the Topology
  // "Show servers" symbol). Passed through to TierResult.
  server_model_id?: string | null
  // Phase 14 — false = leaves of this tier are not vPC-paired at all.
  vpc_pairs?: boolean
}

// Phase 14 — vPC leaf pairs. See renderer/schemas/project.ts FabricSchema
// for the mode semantics; the solver only needs the effective reservation.
export type FabricMode = 'nxos-classic' | 'nxos-evpn' | 'aci'

export interface FabricRequest {
  uplinks_per_leaf: number
  uplinks_per_spine: number
  spine_model_id: string | null
  use_case: UseCase
  input_mode: InputMode
  // Phase 2b — ACI Multi-Pod controls.
  // `aci_multipod_allowed` defaults to true (decision 2026-05-18): the
  // candidate matrix is always computed so the user can discover the
  // option. Setting false blocks multi-pod candidates with
  // MULTIPOD_LICENSE_BLOCKED. UI toggle ships in Phase 9b.
  aci_multipod_allowed?: boolean
  ipn_router_model_id?: string | null
  // Phase 14 — vPC leaf pairs. `mode` defaults to 'nxos-evpn';
  // `peer_link_members` (1–4, default 2) ports per leaf are reserved for
  // the peer-link when the mode has one (classic always, EVPN when
  // `peer_link_enabled`, never ACI). The solver reduces uplinks_per_leaf
  // to what is left and warns.
  mode?: FabricMode
  peer_link_enabled?: boolean
  peer_link_members?: number
  peer_link_port_channel?: boolean
}

export interface RackInventoryEntry {
  name: string
  size_u: number
  pdu_kw_budget: number | null
}

export interface SolverRequirements {
  fabric: FabricRequest
  tiers: TierRequest[]
  racks?: RackInventoryEntry[]
}

export interface SolverContext {
  switches: SwitchSpec[]
  servers?: ServerSpec[]
  breakout_pairs: BreakoutPair[]
  ipn_routers?: IpnRouterSpec[]
}

// ────────────────────────────────────────────────────────────────────
// Solver outputs
// ────────────────────────────────────────────────────────────────────

export type UplinkChoice = 'primary' | 'secondary'

export interface TierResult {
  speed_tier_label: string
  leaf_model_id: string
  endpoint_count_input: number | null
  switch_count_input: number | null
  leaves_required: number
  endpoints_supported: number
  host_ports_per_leaf: number
  host_speed_g: number
  effective_uplink_ports: number
  effective_uplink_speed_g: number
  effective_uplink_choice: UplinkChoice
  override_uplink_speed_applied_g: number | null
  host_bw_g: number
  uplink_bw_g: number
  xor_status: 'ok' | 'empty' | 'both-set' | 'no-model' | 'unknown-model'
  // Phase 14 — pass-through of TierRequest.server_model_id (display only).
  server_model_id?: string | null
  // Phase 14 — pass-through of TierRequest.vpc_pairs (default true).
  vpc_pairs?: boolean
}

export interface SpineResult {
  spine_model_id: string
  spine_ports: number
  spine_speed_g: number
  total_leaves: number
  total_leaf_uplinks: number
  spines_capacity: number
  spines_touching: number | null // null when not evenly divisible
  spines_port_count: number
  spines_needed: number // MAX(2, capacity, touching, port_count)
  required_uplinks_per_leaf: number // spines_needed * uplinks_per_spine
  spine_touching_divisible: boolean // false → INVALID per v8 rule
}

export interface BreakoutAnalysis {
  applicable: boolean
  fanout: number // 4 for S3
  spines_with_breakout: number
  uplinks_per_leaf_with_breakout: number
  reduces_spine_count: boolean
  flips_to_valid: boolean
  recommended_pair: BreakoutPair | null
  patch_panel_needed: boolean
}

export type OpticsBomScenario = 'S1' | 'S2' | 'S3'

export interface OpticsBomEntry {
  optic_id: string
  count: number
  scenario: OpticsBomScenario
  location: 'spine' | 'leaf'
  notes: string | null
}

export interface RackDevicePlacement {
  device_id: string // e.g. "leaf-1", "spine-2", "server-3", "ipn-1"
  model_id: string
  role: 'spine' | 'leaf' | 'server' | 'ipn'
  start_u: number
  ru: number
  label: string
  // ACI Multi-Pod membership (Phase 9b). null on single-pod designs and
  // on IPN routers (which are shared across pods). Spines + leaves in a
  // multi-pod candidate carry their 0-based pod index so the Topology
  // view can draw pod boundaries.
  pod_index?: number | null
}

export interface RackPlacement {
  rack_name: string
  size_u: number
  pdu_kw_budget: number | null
  estimated_power_w: number
  devices: RackDevicePlacement[]
  over_budget: boolean
}

export type WarningCode =
  | 'XOR_BOTH_SET'
  | 'XOR_EMPTY_ROW'
  | 'UPLINKS_NOT_DIVISIBLE_BY_PER_SPINE'
  | 'EXTRA_UPLINKS_NEEDED'
  | 'UPLINKS_EXCEED_AVAILABLE_PORTS'
  | 'SPINE_PORTS_INSUFFICIENT'
  | 'AI_HPC_NOT_1TO1'
  | 'AI_HPC_NO_ROCEV2'
  | 'OVERRIDE_EXCEEDS_RATED'
  | 'BREAKOUT_RECOMMENDED'
  | 'BREAKOUT_PATCH_PANEL_NEEDED'
  | 'RACK_OVER_PDU_BUDGET'
  | 'RACK_INSUFFICIENT_SPACE'
  | 'UNKNOWN_LEAF_MODEL'
  | 'UNKNOWN_SPINE_MODEL'
  | 'NO_SPINE_MODEL_SELECTED'
  // Phase 2b — Multi-Pod ACI
  | 'MULTIPOD_REQUIRED'
  | 'MULTIPOD_RECOMMENDED'
  | 'MULTIPOD_LICENSE_BLOCKED'
  | 'IPN_PORTS_INSUFFICIENT'
  | 'IPN_MODEL_NOT_SELECTED'
  // Phase 14 — vPC leaf pairs
  | 'VPC_PEER_LINK_RESERVED'
  | 'VPC_UPLINKS_REDUCED'
  | 'VPC_ODD_LEAF'

export interface SolverWarning {
  code: WarningCode
  severity: 'error' | 'warn' | 'info'
  message: string
  context?: Record<string, string | number | boolean | null>
}

export interface DesignSummary {
  total_leaves: number
  total_spines: number
  total_servers: number
  spines_no_breakout: number
  spines_with_breakout: number | null
  total_host_bw_g: number
  total_uplink_bw_g: number
  computed_oversub_ratio: number // host_bw / uplink_bw — 1 means 1:1
  computed_oversub_label: string // e.g. "3.00:1"
  valid: boolean
  breakout_required_to_be_valid: boolean
}

// ────────────────────────────────────────────────────────────────────
// Phase 2b — Multi-Pod candidate matrix
//
// The solver computes four candidates in parallel along two axes:
//   pod_variant     : 'single' | 'multi'
//   breakout_variant: 'no_breakout' | 'with_breakout'
//
// Each candidate carries its own SpineResult, RackPlacement, optics
// BOM, and warnings — independent design verdicts. The primary
// candidate (auto-promoted as "simplest valid") is published at the
// top level for backward compatibility with Phase 2 readers; the full
// matrix is available in `candidates[]` for the Phase 9b UI.
// ────────────────────────────────────────────────────────────────────

export type PodVariant = 'single' | 'multi'
export type BreakoutVariant = 'no_breakout' | 'with_breakout'

// Stable IDs — Phase 9b UI keys candidate cards/buttons off these.
export type CandidateId =
  | 'single_no_breakout'
  | 'single_with_breakout'
  | 'multi_no_breakout'
  | 'multi_with_breakout'

export interface MultiPodAnalysis {
  pods_needed: number
  leaves_per_pod: number[] // index = pod_index; sum == total_leaves
  spines_per_pod: number // each pod gets identical spine count (HA mirrored)
  ipn_routers_needed: number // HA floor of 2; grows if IPN port budget runs out
  ipn_router_model_id: string | null
  ports_per_spine_per_ipn: number // global constant (4) — exposed for UI clarity
  spine_to_ipn_links: number // total cable count: spines × ipn × ports
  effective_spine_ports: number // spine_ports - (ipn × ports_per_spine_per_ipn)
}

export interface DesignCandidate {
  id: CandidateId
  pod_variant: PodVariant
  breakout_variant: BreakoutVariant
  valid: boolean
  // The five fields below mirror Phase 2's per-design output — each
  // candidate runs the same computeSpine + breakout pass internally so
  // each carries its own verdict.
  spine: SpineResult | null
  breakout: BreakoutAnalysis | null
  multipod: MultiPodAnalysis | null // null on single-pod candidates
  rack_layout: RackPlacement[]
  optics_bom: OpticsBomEntry[]
  warnings: SolverWarning[]
  // Per-candidate totals (mostly mirror DesignSummary fields but
  // scoped to this candidate — the top-level summary still reflects
  // the canonical single-pod-no-breakout view for Phase 2 readers).
  total_spines: number
  total_ipn_routers: number
  total_host_bw_g: number
  total_uplink_bw_g: number
  computed_oversub_ratio: number
  computed_oversub_label: string
}

// Phase 14 — the vPC view of a design: effective mode/peer-link settings,
// the uplink budget after the peer-link reservation, and the solver's leaf
// pairing (device ids from rack_layout). `pairs` is the seed for the
// per-project leaf_pairs.yaml; consumers prefer that file when present.
export interface VpcPair {
  id: string // "pair-1", "pair-2", …
  members: [string, string]
}

export interface VpcSummary {
  mode: FabricMode
  peer_link: boolean
  port_channel: boolean
  /** Cables per peer-link (0 when there is no peer-link). */
  members: number
  configured_uplinks_per_leaf: number
  /** Uplinks per leaf actually used for the spine math. */
  effective_uplinks_per_leaf: number
  pairs: VpcPair[]
  /** Leaves that could not be paired (odd leaf out of a tier). */
  unpaired: string[]
}

export interface DesignResult {
  schema_version: 1
  summary: DesignSummary
  tiers: TierResult[]
  spine: SpineResult | null // null when no spine model selected
  breakout: BreakoutAnalysis | null
  optics_bom: OpticsBomEntry[]
  rack_layout: RackPlacement[]
  warnings: SolverWarning[]
  // Phase 2b — full candidate matrix and the auto-promoted choice.
  // `candidates` always has 4 entries (one per CandidateId). `primary`
  // is the simplest valid one (fewer pods first, then no-breakout if
  // tied) or, when nothing is valid, the canonical single_no_breakout
  // so consumers always have something to render. `committed` mirrors
  // `primary` until the Phase 9b UI exposes the "commit this candidate"
  // toggle.
  candidates: DesignCandidate[]
  primary_candidate_id: CandidateId
  committed_candidate_id: CandidateId
  // Phase 14 — optional so design.yaml files written before v1.4 still parse.
  vpc?: VpcSummary
}
