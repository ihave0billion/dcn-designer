import { z } from 'zod'

// cable_links.yaml — port-to-port wiring between fabric devices.
// Phase 6 scope: spine ↔ leaf only. Server ↔ leaf is implicit and not
// rendered as links. The schema is generic so host wiring could be
// added later without a migration.
//
// Auto-seeded by Generate Design when no fork exists. First user edit
// (Add Link, Edit Link, Delete Link, Import CSV) flips the file into a
// "fork" state — solver regen leaves it alone after that. Reset button
// deletes the file and the next Generate Design re-seeds.

export const CableEndpointSchema = z.object({
  rack: z.string().nullable().default(null),
  device_id: z.string().min(1),
  port: z.string().min(1)
})
export type CableEndpoint = z.infer<typeof CableEndpointSchema>

export const CableLinkSchema = z.object({
  id: z.string().min(1),
  device_a: CableEndpointSchema,
  device_b: CableEndpointSchema,
  speed_g: z.number().positive(),
  optic_id: z.string().nullable().default(null),
  patch_panel_id: z.string().nullable().default(null),
  label: z.string().default(''),
  length_m: z.number().nonnegative().nullable().default(null),
  notes: z.string().nullable().default(null)
})
export type CableLink = z.infer<typeof CableLinkSchema>

export const CableLinksFileSchema = z.object({
  schema_version: z.literal(1),
  source: z.enum(['solver', 'user']).default('solver'),
  // ISO timestamp the file was last written by the solver. Null after
  // the user has edited and we've flipped to fork state.
  seeded_at: z.string().nullable().default(null),
  // ISO timestamp the user first edited. Null while still seeded.
  forked_at: z.string().nullable().default(null),
  links: z.array(CableLinkSchema).default([])
})
export type CableLinksFile = z.infer<typeof CableLinksFileSchema>
