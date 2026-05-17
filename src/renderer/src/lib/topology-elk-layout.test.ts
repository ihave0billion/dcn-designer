import { describe, it, expect } from 'vitest'
import { autoLayout, nodeDimensions, NODE_BASE_WIDTH } from './topology-elk-layout'
import type { TopologyGraph, TopologyNode } from './topology-extractor'

function makeGraph(spines: number, leaves: number, edges = 0): TopologyGraph {
  const spineNodes: TopologyNode[] = Array.from({ length: spines }, (_, i) => ({
    id: `spine-${i + 1}`,
    role: 'spine',
    model_id: 'N9K-SPINE',
    rack: null,
    label: `Spine ${i + 1}`,
    ru: 2,
    power_w: null,
    usedPorts: ['Eth1/1', 'Eth1/2']
  }))
  const leafNodes: TopologyNode[] = Array.from({ length: leaves }, (_, i) => ({
    id: `leaf-${i + 1}`,
    role: 'leaf',
    model_id: 'N9K-LEAF',
    rack: null,
    label: `Leaf ${i + 1}`,
    ru: 1,
    power_w: null,
    usedPorts: ['Eth1/49', 'Eth1/50']
  }))
  const allEdges = Array.from({ length: edges }, (_, i) => ({
    id: `e-${i}`,
    source: spineNodes[i % Math.max(1, spines)].id,
    sourcePort: 'Eth1/1',
    target: leafNodes[i % Math.max(1, leaves)].id,
    targetPort: 'Eth1/49',
    speed_g: 100,
    optic_id: null,
    patch_panel_id: null,
    label: '',
    length_m: null
  }))
  return { nodes: [...spineNodes, ...leafNodes], edges: allEdges, orphanDeviceIds: [] }
}

describe('nodeDimensions', () => {
  it('returns the base width for a small node', () => {
    const node: TopologyNode = {
      id: 'spine-1',
      role: 'spine',
      model_id: 'X',
      rack: null,
      label: 'Spine 1',
      ru: null,
      power_w: null,
      usedPorts: ['Eth1/1', 'Eth1/2']
    }
    const { width, height } = nodeDimensions(node)
    expect(width).toBe(NODE_BASE_WIDTH)
    expect(height).toBeGreaterThan(0)
  })

  it('grows wider as more ports are used', () => {
    const small = nodeDimensions({
      id: 'a', role: 'spine', model_id: 'X', rack: null, label: '',
      ru: null, power_w: null, usedPorts: Array.from({ length: 4 }, (_, i) => `p${i}`)
    })
    const big = nodeDimensions({
      id: 'a', role: 'spine', model_id: 'X', rack: null, label: '',
      ru: null, power_w: null, usedPorts: Array.from({ length: 32 }, (_, i) => `p${i}`)
    })
    expect(big.width).toBeGreaterThan(small.width)
  })
})

describe('autoLayout', () => {
  it('returns empty positions for an empty graph', async () => {
    const result = await autoLayout({ nodes: [], edges: [], orphanDeviceIds: [] })
    expect(result.positions).toEqual([])
    expect(result.graphWidth).toBe(0)
    expect(result.graphHeight).toBe(0)
  })

  it('puts spines above leaves (lower y) when the direction is DOWN', async () => {
    const graph = makeGraph(2, 3, 6)
    const result = await autoLayout(graph)
    expect(result.positions).toHaveLength(5)
    const spineYs = result.positions
      .filter((p) => p.device_id.startsWith('spine'))
      .map((p) => p.y)
    const leafYs = result.positions
      .filter((p) => p.device_id.startsWith('leaf'))
      .map((p) => p.y)
    const maxSpineY = Math.max(...spineYs)
    const minLeafY = Math.min(...leafYs)
    // Strict: every spine sits above every leaf.
    expect(maxSpineY).toBeLessThan(minLeafY)
  })

  it('returns positive graph dimensions for a non-empty graph', async () => {
    const result = await autoLayout(makeGraph(1, 2, 2))
    expect(result.graphWidth).toBeGreaterThan(0)
    expect(result.graphHeight).toBeGreaterThan(0)
  })

  it('returns one position per node', async () => {
    const graph = makeGraph(3, 6, 12)
    const result = await autoLayout(graph)
    expect(result.positions).toHaveLength(graph.nodes.length)
    const ids = new Set(result.positions.map((p) => p.device_id))
    expect(ids.size).toBe(graph.nodes.length)
  })
})
