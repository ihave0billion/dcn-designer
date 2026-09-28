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

// Phase 13 — how the Visio exporter draws this model. Both optional: the
// resolver falls back to the exact Cisco master ("<id> Front"), an alias,
// a product photo in library/visio/images/, then a generated schematic panel.
export const VisioHintSchema = z.object({
  // Master name inside the extracted stencil bundle (library/visio/index.json).
  master: z.string().nullable().default(null),
  // Path (relative to <workspace>/library/visio/) of a PNG/JPEG front view.
  image: z.string().nullable().default(null)
})
export type VisioHint = z.infer<typeof VisioHintSchema>

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
  attachments: z.array(z.string()).default([]),
  visio: VisioHintSchema.optional(),
  // Phase 14 — port template for the vPC peer-link, e.g. "Eth1/{49..50}".
  // Null = default rule: the first ports of the highest-speed uplink group
  // (spine uplinks are then taken from the end of that group). Smart
  // switches thereby land on their 400G ports, never the 100G secondaries.
  peer_link_ports: z.string().nullable().default(null)
})
export type Switch = z.infer<typeof SwitchSchema>

export const SwitchesFileSchema = z.object({
  schema_version: z.literal(1),
  switches: z.array(SwitchSchema)
})
export type SwitchesFile = z.infer<typeof SwitchesFileSchema>
