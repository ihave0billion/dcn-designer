import { z } from 'zod'

export const RoleSchema = z.enum(['spine', 'leaf', 'both'])
export type Role = z.infer<typeof RoleSchema>

export const AvailabilitySchema = z.enum(['available', 'future', 'eos'])
export type Availability = z.infer<typeof AvailabilitySchema>

export const PortGroupSchema = z.object({
  ports: z.number().int().positive(),
  speed_g: z.number().positive(),
  speed_options_g: z.array(z.number().positive()).default([]),
  naming_template: z.string()
})
export type PortGroup = z.infer<typeof PortGroupSchema>

export const SwitchCapabilitiesSchema = z.object({
  aci_leaf: z.boolean().default(false),
  aci_spine: z.boolean().default(false),
  nxos: z.boolean().default(true),
  rocev2: z.boolean().default(false),
  deep_buffer: z.boolean().default(false),
  smart_switch: z.boolean().default(false),
  ult_low_latency: z.boolean().default(false),
  poe: z.boolean().default(false),
  macsec: z.boolean().default(false),
  hpc: z.boolean().default(false),
  ai_ml: z.boolean().default(false),
  dpu_integrated: z.boolean().default(false)
})
export type SwitchCapabilities = z.infer<typeof SwitchCapabilitiesSchema>

export const SwitchSchema = z.object({
  id: z.string().min(1),
  model_display: z.string().min(1),
  vendor: z.string().min(1),
  role: RoleSchema,
  category: z.string().min(1),
  primary: PortGroupSchema,
  uplink: PortGroupSchema.nullable(),
  secondary_uplink: PortGroupSchema.nullable(),
  ru: z.number().int().positive().nullable(),
  power_w: z.number().positive().nullable(),
  optic_hint: z.string().nullable(),
  capabilities: SwitchCapabilitiesSchema,
  aci_note: z.string().nullable(),
  asic: z.string().nullable(),
  availability: AvailabilitySchema,
  available_from: z.string().nullable(),
  notes: z.string().nullable(),
  data_sheet_url: z.string().nullable(),
  attachments: z.array(z.string()).default([])
})
export type Switch = z.infer<typeof SwitchSchema>

export const SwitchesFileSchema = z.object({
  schema_version: z.literal(1),
  switches: z.array(SwitchSchema)
})
export type SwitchesFile = z.infer<typeof SwitchesFileSchema>
