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

// Phase 14 — what a cable is for. Old files carry no `kind` and parse as
// spine↔leaf uplinks. Peer-links are the vPC pair's leaf↔leaf cables;
// 'server' is reserved for host wiring (not seeded — the topology draws
// server symbols from the tier, not from links).
// Phase 17 — 'nd-data' (Nexus Dashboard node fabric0/1 → leaf) and
// 'nd-mgmt' (node mgmt0/1 → OOB leaf, or the `oob-mgmt` cloud endpoint).
export const CableLinkKindSchema = z.enum(['uplink', 'vpc-peer-link', 'server', 'nd-data', 'nd-mgmt'])
export type CableLinkKind = z.infer<typeof CableLinkKindSchema>

// v1.6.1 — cable media. Null/absent = the project default
// (requirements.default_cable_media, MMF unless changed).
export const CableLinkMediaSchema = z.enum(['mmf', 'smf', 'dac', 'aoc'])
export type CableLinkMedia = z.infer<typeof CableLinkMediaSchema>

export const CableLinkSchema = z.object({
  id: z.string().min(1),
  kind: CableLinkKindSchema.default('uplink'),
  media: CableLinkMediaSchema.nullable().optional(),
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
