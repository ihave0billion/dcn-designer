import { z } from 'zod'

// ────────────────────────────────────────────────────────────────────
// Project metadata
// ────────────────────────────────────────────────────────────────────

export const ProjectMetaSchema = z.object({
  name: z.string().min(1),
  customer: z.string().default(''),
  site: z.string().default(''),
  created: z.string(),
  last_edited: z.string()
})
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>

// ────────────────────────────────────────────────────────────────────
// Current network (mirrors WIP `Sizing` tab context fields)
// ────────────────────────────────────────────────────────────────────

export const DeploymentTypeSchema = z.enum(['greenfield', 'brownfield'])
export type DeploymentType = z.infer<typeof DeploymentTypeSchema>

export const CurrentNetworkSchema = z.object({
  topology: z.string().default(''),
  deployment_type: DeploymentTypeSchema.default('greenfield'),
  existing_endpoints: z.number().int().nonnegative().nullable().default(null),
  existing_racks: z.number().int().nonnegative().nullable().default(null),
  notes: z.string().default('')
})
export type CurrentNetwork = z.infer<typeof CurrentNetworkSchema>

// ────────────────────────────────────────────────────────────────────
// Use case
// ────────────────────────────────────────────────────────────────────

export const UseCaseSchema = z.enum(['dcn', 'ai', 'hpc', 'storage'])
export type UseCase = z.infer<typeof UseCaseSchema>

export const InputModeSchema = z.enum(['aggregate', 'per_leaf'])
export type InputMode = z.infer<typeof InputModeSchema>

// ────────────────────────────────────────────────────────────────────
// Tier rows (leaf-design table) — v8 rule 8 XOR endpoint/switch count
// ────────────────────────────────────────────────────────────────────

export const TierRowSchema = z.object({
  speed_tier_label: z.string().default(''),
  endpoint_count: z.number().int().nonnegative().nullable().default(null),
  switch_count: z.number().int().nonnegative().nullable().default(null),
  leaf_model_id: z.string().nullable().default(null),
  override_uplink_speed_g: z.number().positive().nullable().default(null)
})
export type TierRow = z.infer<typeof TierRowSchema>

// ────────────────────────────────────────────────────────────────────
// Fabric (uplinks + spine selection)
// ────────────────────────────────────────────────────────────────────

export const FabricSchema = z.object({
  uplinks_per_leaf: z.number().int().positive().default(4),
  uplinks_per_spine: z.number().int().positive().default(2),
  spine_model_id: z.string().nullable().default(null)
})
export type Fabric = z.infer<typeof FabricSchema>

// ────────────────────────────────────────────────────────────────────
// Constraints
// ────────────────────────────────────────────────────────────────────

export const LicenseTierSchema = z.enum(['essentials', 'advantage', 'premier']).nullable()

export const ConstraintsSchema = z.object({
  aci_capable_required: z.boolean().default(false),
  rocev2_required: z.boolean().default(false),
  license_tier: LicenseTierSchema.default(null),
  cooling: z.string().default(''),
  notes: z.string().default('')
})
export type Constraints = z.infer<typeof ConstraintsSchema>

// ────────────────────────────────────────────────────────────────────
// Rack inventory
// ────────────────────────────────────────────────────────────────────

export const RackInventoryRowSchema = z.object({
  name: z.string().min(1),
  size_u: z.number().int().positive().default(42),
  pdu_kw_budget: z.number().positive().nullable().default(null),
  location: z.string().default(''),
  tags: z.array(z.string()).default([])
})
export type RackInventoryRow = z.infer<typeof RackInventoryRowSchema>

// ────────────────────────────────────────────────────────────────────
// Full requirements file
// ────────────────────────────────────────────────────────────────────

export const RequirementsFileSchema = z.object({
  schema_version: z.literal(1),
  project: ProjectMetaSchema,
  current_network: CurrentNetworkSchema.default({
    topology: '',
    deployment_type: 'greenfield',
    existing_endpoints: null,
    existing_racks: null,
    notes: ''
  }),
  use_case: UseCaseSchema.default('dcn'),
  input_mode: InputModeSchema.default('aggregate'),
  tiers: z.array(TierRowSchema).default([]),
  fabric: FabricSchema.default({
    uplinks_per_leaf: 4,
    uplinks_per_spine: 2,
    spine_model_id: null
  }),
  constraints: ConstraintsSchema.default({
    aci_capable_required: false,
    rocev2_required: false,
    license_tier: null,
    cooling: '',
    notes: ''
  }),
  racks: z.array(RackInventoryRowSchema).default([]),
  cable_tray_m: z.number().nonnegative().nullable().default(null),
  target_oversub_informational: z.number().positive().nullable().default(null)
})
export type RequirementsFile = z.infer<typeof RequirementsFileSchema>

// Helper: produce a fresh requirements file given project metadata
export function emptyRequirements(project: ProjectMeta): RequirementsFile {
  return {
    schema_version: 1,
    project,
    current_network: {
      topology: '',
      deployment_type: 'greenfield',
      existing_endpoints: null,
      existing_racks: null,
      notes: ''
    },
    use_case: 'dcn',
    input_mode: 'aggregate',
    tiers: [],
    fabric: { uplinks_per_leaf: 4, uplinks_per_spine: 2, spine_model_id: null },
    constraints: {
      aci_capable_required: false,
      rocev2_required: false,
      license_tier: null,
      cooling: '',
      notes: ''
    },
    racks: [],
    cable_tray_m: null,
    target_oversub_informational: null
  }
}
