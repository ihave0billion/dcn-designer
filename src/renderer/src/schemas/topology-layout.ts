import { z } from 'zod'

// topology_layout.yaml — per-project node positions for the Topology
// View (Phase 7). Mirrors the Phase 5/6 fork pattern: when absent, the
// view runs `elkjs` and shows the auto-layout; the first manual drag
// writes this file with `source: 'user'` + `forked_at`. Reset deletes
// the file and the next visit re-runs elkjs.
//
// Phase 7 Q1 scope: only spines + leaves are nodes.

export const TopologyNodePositionSchema = z.object({
  device_id: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite()
})
export type TopologyNodePosition = z.infer<typeof TopologyNodePositionSchema>

export const TopologyLayoutFileSchema = z.object({
  schema_version: z.literal(1),
  source: z.enum(['auto', 'user']).default('auto'),
  // ISO timestamp of the last auto-layout write. Null after the user
  // has dragged and we've flipped to fork state.
  seeded_at: z.string().nullable().default(null),
  // ISO timestamp of the first user drag. Null while still in auto state.
  forked_at: z.string().nullable().default(null),
  positions: z.array(TopologyNodePositionSchema).default([])
})
export type TopologyLayoutFile = z.infer<typeof TopologyLayoutFileSchema>
