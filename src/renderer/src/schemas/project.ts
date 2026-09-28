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
  override_uplink_speed_g: z.number().positive().nullable().default(null),
  // Phase 14 — the server model attached to this tier (servers.yaml id).
  // Only the Topology "Show servers" symbol reads it (label = model + NIC
  // speed); null = a generic server labelled with the tier's host speed.
  server_model_id: z.string().nullable().default(null),
  // Phase 14 — false = this tier's leaves are never vPC-paired (no
  // peer-link, no reservation, single-attached hosts). Decision 2026-09-28:
  // the SITE-A's FX3 management tier is not vPC'd.
  vpc_pairs: z.boolean().default(true)
})
export type TierRow = z.infer<typeof TierRowSchema>

// ────────────────────────────────────────────────────────────────────
// Fabric (uplinks + spine selection)
// ────────────────────────────────────────────────────────────────────

// Phase 14 — fabric mode drives the vPC leaf-pair semantics:
//   nxos-classic  peer-link + port-channel mandatory
//   nxos-evpn     peer-link optional (default on), port-channel optional (default on)
//   aci           no peer-link, no port-channel — pairs are logical only
// Existing projects (no `mode` in the file) load as nxos-evpn with the
// peer-link on, which is what the SITE-A smart-switch design needs.
export const FabricModeSchema = z.enum(['nxos-classic', 'nxos-evpn', 'aci'])
export type FabricMode = z.infer<typeof FabricModeSchema>

export const PEER_LINK_MEMBERS_MIN = 1
export const PEER_LINK_MEMBERS_MAX = 4

export const FabricSchema = z.object({
  uplinks_per_leaf: z.number().int().positive().default(4),
  uplinks_per_spine: z.number().int().positive().default(2),
  spine_model_id: z.string().nullable().default(null),
  mode: FabricModeSchema.default('nxos-evpn'),
  // EVPN only: draw/seed the vPC peer-link at all (classic forces on, ACI off).
  peer_link_enabled: z.boolean().default(true),
  // Cables in the peer-link, at the port's native speed (1–4, default 2).
  peer_link_members: z
    .number()
    .int()
    .min(PEER_LINK_MEMBERS_MIN)
    .max(PEER_LINK_MEMBERS_MAX)
    .default(2),
  // EVPN only: bundle the peer-link as a port-channel (classic forces on, ACI off).
  peer_link_port_channel: z.boolean().default(true),
  // ACI Multi-Pod controls (Phase 9b). `aci_multipod_allowed` defaults
  // to true so the candidate matrix is always computed and the user can
  // discover the option; setting false blocks multi-pod candidates.
  // `ipn_router_model_id` selects which IPN router (from
  // ipn_routers.yaml) terminates the spine↔IPN links; null = solver
  // falls back to the first library entry.
  aci_multipod_allowed: z.boolean().default(true),
  ipn_router_model_id: z.string().nullable().default(null)
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
  size_u: z.number().int().positive().default(44),
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
    spine_model_id: null,
    mode: 'nxos-evpn',
    peer_link_enabled: true,
    peer_link_members: 2,
    peer_link_port_channel: true
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
    fabric: {
      uplinks_per_leaf: 4,
      uplinks_per_spine: 2,
      spine_model_id: null,
      mode: 'nxos-evpn',
      peer_link_enabled: true,
      peer_link_members: 2,
      peer_link_port_channel: true,
      aci_multipod_allowed: true,
      ipn_router_model_id: null
    },
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

// ────────────────────────────────────────────────────────────────────
// Phase 14 — effective vPC settings for a fabric mode. The mode forces
// the classic / ACI cases; only EVPN honours the two checkboxes.
// ────────────────────────────────────────────────────────────────────

export interface EffectiveVpc {
  mode: FabricMode
  /** True when leaf pairs are wired with a physical peer-link. */
  peer_link: boolean
  /** True when that peer-link is bundled as a port-channel. */
  port_channel: boolean
  /** Cables in the peer-link (0 when there is no peer-link). */
  members: number
}

export function effectiveVpc(fabric: Pick<Fabric, 'mode' | 'peer_link_enabled' | 'peer_link_members' | 'peer_link_port_channel'>): EffectiveVpc {
  const members = Math.min(PEER_LINK_MEMBERS_MAX, Math.max(PEER_LINK_MEMBERS_MIN, fabric.peer_link_members))
  switch (fabric.mode) {
    case 'nxos-classic':
      return { mode: fabric.mode, peer_link: true, port_channel: true, members }
    case 'aci':
      return { mode: fabric.mode, peer_link: false, port_channel: false, members: 0 }
    default:
      return {
        mode: fabric.mode,
        peer_link: fabric.peer_link_enabled,
        port_channel: fabric.peer_link_enabled && fabric.peer_link_port_channel,
        members: fabric.peer_link_enabled ? members : 0
      }
  }
}

export const FABRIC_MODE_LABEL: Record<FabricMode, string> = {
  'nxos-classic': 'NX-OS classic (vPC)',
  'nxos-evpn': 'NX-OS VXLAN EVPN',
  aci: 'ACI'
}
