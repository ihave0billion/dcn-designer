import { z } from 'zod'

// patch_panels.yaml — curated list of MPO ↔ LC (and similar) cassettes
// surfaced in the Cable Links manager when a link needs a connector
// conversion (e.g. spine MPO-12 → leaf LC for a 4× breakout).
//
// When the curated list has no entry matching a given connector pair,
// the UI synthesises a placeholder SKU like `PP-MPO12-LC` (see
// `lib/patch-panel-resolver.ts`). The synthetic SKU is not stored in
// this file — it lives only on the cable_links.yaml link record.

export const PatchPanelSchema = z.object({
  id: z.string().min(1),
  vendor: z.string().min(1),
  description: z.string().default(''),
  connector_a: z.string().min(1),
  connector_b: z.string().min(1),
  fanout: z.number().int().positive(),
  media: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  data_sheet_url: z.string().nullable().default(null)
})
export type PatchPanel = z.infer<typeof PatchPanelSchema>

export const PatchPanelsFileSchema = z.object({
  schema_version: z.literal(1),
  patch_panels: z.array(PatchPanelSchema).default([])
})
export type PatchPanelsFile = z.infer<typeof PatchPanelsFileSchema>
