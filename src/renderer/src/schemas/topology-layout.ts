import { z } from 'zod'

// topology_layout.yaml — per-project node positions for the Topology
// View. Mirrors the Phase 5/6 fork pattern: when absent, the view shows
// the automatic tiered layout; the first manual drag writes this file
// with `source: 'user'` + `forked_at`. "Snap to default" for a level
// removes that level's entries; "Reset all" deletes the file.
//
// v1.2: positions are stored per *scene* (level × orientation) because the
// hierarchical view lets the user drag tiles at every level — the fabric
// globe, the Spines/Leaves stacks, and individual switches are all
// independent objects. `positions` (v1.0, flat elk positions) is kept so
// old files still parse, but nothing reads it any more.

export const TopologyNodePositionSchema = z.object({
  device_id: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite()
})
export type TopologyNodePosition = z.infer<typeof TopologyNodePositionSchema>

export const TopologyScenePositionSchema = z.object({
  // e.g. "fabrics|vertical", "fabric:pod-0|horizontal", "devices:fabric|vertical"
  scene: z.string().min(1),
  node_id: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite()
})
export type TopologyScenePosition = z.infer<typeof TopologyScenePositionSchema>

export const TopologyLayoutFileSchema = z.object({
  schema_version: z.literal(1),
  source: z.enum(['auto', 'user']).default('auto'),
  // ISO timestamp of the last auto-layout write. Null after the user
  // has dragged and we've flipped to fork state.
  seeded_at: z.string().nullable().default(null),
  // ISO timestamp of the first user drag. Null while still in auto state.
  forked_at: z.string().nullable().default(null),
  // v1.0 flat positions — parsed for compatibility, no longer applied.
  positions: z.array(TopologyNodePositionSchema).default([]),
  // v1.2 per-scene positions.
  scene_positions: z.array(TopologyScenePositionSchema).default([]),
  // Which layout engine wrote the file. Tile geometry changes bump this;
  // files from another generator are ignored (not deleted).
  generator: z.string().nullable().default(null),
  // Phase 14 — the Topology tab's "Show servers" checkbox. Saved here so
  // the PDF and Visio exports draw exactly what the screen shows.
  show_servers: z.boolean().default(false)
})
export type TopologyLayoutFile = z.infer<typeof TopologyLayoutFileSchema>

export const TOPOLOGY_LAYOUT_GENERATOR = 'cp-tiles-v2'
