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
}

export interface SwitchSpec {
  id: string
  role: 'spine' | 'leaf' | 'both'
  primary: PortGroupSpec
  uplink: PortGroupSpec | null
  secondary_uplink: PortGroupSpec | null
  ru: number | null
  power_w: number | null
  capabilities: SwitchCapabilitiesSpec
}

export interface ServerSpec {
  id: string
  ru: number | null
  power_w: number | null
}

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
}

export interface FabricRequest {
  uplinks_per_leaf: number
  uplinks_per_spine: number
  spine_model_id: string | null
  use_case: UseCase
  input_mode: InputMode
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
  device_id: string // e.g. "leaf-1", "spine-2", "server-3"
  model_id: string
  role: 'spine' | 'leaf' | 'server'
  start_u: number
  ru: number
  label: string
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

export interface DesignResult {
  schema_version: 1
  summary: DesignSummary
  tiers: TierResult[]
  spine: SpineResult | null // null when no spine model selected
  breakout: BreakoutAnalysis | null
  optics_bom: OpticsBomEntry[]
  rack_layout: RackPlacement[]
  warnings: SolverWarning[]
}
