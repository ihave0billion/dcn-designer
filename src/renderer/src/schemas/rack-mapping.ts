import { z } from 'zod'

// rack_mapping.yaml — user-curated rack layout that takes precedence over
// design.yaml.rack_layout. Auto-created the moment the user makes their
// first edit in Rack View (Phase 5, Q1 decision: auto-fork on first edit).
//
// Reset returns to the solver layout by deleting this file.

export const RackDeviceRoleSchema = z.enum(['spine', 'leaf', 'server', 'blank'])
export type RackDeviceRole = z.infer<typeof RackDeviceRoleSchema>

export const RackMappingDeviceSchema = z.object({
  device_id: z.string().min(1), // unique within the fork, e.g. "leaf-1"
  model_id: z.string().nullable(), // null for blank panels
  role: RackDeviceRoleSchema,
  start_u: z.number().int().positive(), // 1-indexed, U1 at the bottom
  ru: z.number().int().positive(),
  label: z.string().default('')
})
export type RackMappingDevice = z.infer<typeof RackMappingDeviceSchema>

export const RackMappingRackSchema = z.object({
  rack_id: z.string().min(1), // matches a name in requirements.yaml.racks
  devices: z.array(RackMappingDeviceSchema).default([])
})
export type RackMappingRack = z.infer<typeof RackMappingRackSchema>

export const RackMappingFileSchema = z.object({
  schema_version: z.literal(1),
  forked_at: z.string(),
  racks: z.array(RackMappingRackSchema).default([])
})
export type RackMappingFile = z.infer<typeof RackMappingFileSchema>
