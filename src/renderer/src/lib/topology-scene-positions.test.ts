import { describe, expect, it } from 'vitest'
import { resolveScenePositions, sceneKeyFor } from './topology-scene-positions'
import { layoutScene, type Scene, type SceneNode } from './topology-hierarchy'
import { TOPOLOGY_LAYOUT_GENERATOR, type TopologyLayoutFile } from '@/schemas/topology-layout'

function node(id: string, tier: number, role: 'spine' | 'leaf'): SceneNode {
  return {
    id,
    kind: 'device',
    label: id,
    sublabel: null,
    role,
    memberIds: [id],
    count: 1,
    status: 'healthy',
    fabricId: 'f',
    device: null,
    tier
  }
}

const scene: Scene = {
  level: { kind: 'devices', fabricId: 'f' },
  nodes: [node('spine-1', 1, 'spine'), node('leaf-1', 2, 'leaf'), node('leaf-2', 2, 'leaf')],
  edges: [],
  breadcrumb: []
}

function file(scenePositions: TopologyLayoutFile['scene_positions'], generator = TOPOLOGY_LAYOUT_GENERATOR): TopologyLayoutFile {
  return {
    schema_version: 1,
    source: 'user',
    seeded_at: null,
    forked_at: null,
    positions: [],
    scene_positions: scenePositions,
    generator
  }
}

describe('resolveScenePositions', () => {
  it('returns the automatic layout when there is no file', () => {
    const { positions, custom } = resolveScenePositions(scene, null, 'vertical')
    expect(custom).toBe(false)
    expect(positions).toEqual(layoutScene(scene.nodes, 'vertical'))
  })

  it('overrides only the nodes saved for this scene', () => {
    const key = sceneKeyFor(scene.level, 'vertical')
    const f = file([
      { scene: key, node_id: 'leaf-2', x: 900, y: 700 },
      { scene: `${key}-other`, node_id: 'leaf-1', x: 1, y: 1 },
      { scene: key, node_id: 'ghost', x: 5, y: 5 }
    ])
    const { positions, custom } = resolveScenePositions(scene, f, 'vertical')
    expect(custom).toBe(true)
    expect(positions.get('leaf-2')).toEqual({ x: 900, y: 700 })
    expect(positions.get('leaf-1')).toEqual(layoutScene(scene.nodes, 'vertical').get('leaf-1'))
    expect(positions.has('ghost')).toBe(false)
  })

  it('ignores files from another generator', () => {
    const key = sceneKeyFor(scene.level, 'vertical')
    const f = file([{ scene: key, node_id: 'leaf-2', x: 900, y: 700 }], 'nd-tiles-v1')
    const { custom, positions } = resolveScenePositions(scene, f, 'vertical')
    expect(custom).toBe(false)
    expect(positions.get('leaf-2')).not.toEqual({ x: 900, y: 700 })
  })

  it('keys scenes by level and orientation', () => {
    expect(sceneKeyFor({ kind: 'fabrics' }, 'horizontal')).toBe('fabrics|horizontal')
  })
})
