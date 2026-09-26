import { TOPOLOGY_LAYOUT_GENERATOR, type TopologyLayoutFile } from '@/schemas/topology-layout'
import {
  layoutScene,
  levelKey,
  type Orientation,
  type Point,
  type Scene,
  type SceneLevel
} from '@/lib/topology-hierarchy'

// Phase 13 — the one place that turns a scene into tile positions.
//
// The Topology tab and both exporters (Visio, PDF) must agree on where every
// tile sits: the automatic tiered layout, overridden by whatever the user
// dragged and saved for THIS scene (level × orientation) in
// topology_layout.yaml. Files written by another generator are parsed but
// ignored, exactly as the tab does.

/** Key under which a scene's drag positions are stored. */
export function sceneKeyFor(level: SceneLevel, orientation: Orientation): string {
  return `${levelKey(level)}|${orientation}`
}

export interface ResolvedScenePositions {
  positions: Map<string, Point>
  /** True when at least one tile in this scene comes from the saved file. */
  custom: boolean
}

export function resolveScenePositions(
  scene: Scene,
  layoutFile: TopologyLayoutFile | null,
  orientation: Orientation,
  opts: { rowMax?: number } = {}
): ResolvedScenePositions {
  const key = sceneKeyFor(scene.level, orientation)
  const positions = layoutScene(scene.nodes, orientation, opts.rowMax)
  let custom = false
  if (layoutFile?.generator === TOPOLOGY_LAYOUT_GENERATOR) {
    for (const p of layoutFile.scene_positions) {
      if (p.scene !== key || !positions.has(p.node_id)) continue
      positions.set(p.node_id, { x: p.x, y: p.y })
      custom = true
    }
  }
  return { positions, custom }
}
