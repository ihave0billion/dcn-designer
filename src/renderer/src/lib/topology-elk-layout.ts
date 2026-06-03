import ELK, { type ElkNode, type ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js'
import type { TopologyGraph, TopologyNode, TopologyEdge } from './topology-extractor'

// elkjs layered auto-layout for the Topology canvas (Phase 7).
//
// Layout: spines on top, leaves on bottom (DOWN direction), layered
// algorithm. Node sizes are computed from `usedPorts` count so wider
// nodes (more handles) don't overlap their neighbors.
//
// Nodes returned in react-flow's coordinate shape: top-left x/y in
// pixels. Persisted into `topology_layout.yaml` after the user drags or
// when seeding the auto-layout.

export interface LaidOutPosition {
  device_id: string
  x: number
  y: number
  width: number
  height: number
}

export interface LaidOutTopology {
  positions: LaidOutPosition[]
  // Flat width/height the canvas should be sized to so fitView frames
  // the whole graph nicely.
  graphWidth: number
  graphHeight: number
}

// Sizing constants — kept here so node-renderer + layout share them.
export const NODE_BASE_WIDTH = 200
export const NODE_PORT_WIDTH = 14 // each used port adds this much width
export const NODE_HEIGHT_SPINE = 110
export const NODE_HEIGHT_LEAF = 96
export const LAYOUT_LAYER_GAP = 220 // vertical between spine/leaf row
export const LAYOUT_NODE_GAP = 40 // horizontal between siblings

export function nodeDimensions(node: TopologyNode): { width: number; height: number } {
  const portCount = Math.max(1, node.usedPorts.length)
  const width = Math.max(
    NODE_BASE_WIDTH,
    NODE_BASE_WIDTH + (portCount - 4) * NODE_PORT_WIDTH
  )
  // IPN routers sit in their own top tier; size them like spines.
  const height =
    node.role === 'spine' || node.role === 'ipn' ? NODE_HEIGHT_SPINE : NODE_HEIGHT_LEAF
  return { width, height }
}

const elk = new ELK()

export async function autoLayout(graph: TopologyGraph): Promise<LaidOutTopology> {
  if (graph.nodes.length === 0) {
    return { positions: [], graphWidth: 0, graphHeight: 0 }
  }

  const elkNodes: ElkNode[] = graph.nodes.map((n) => {
    const { width, height } = nodeDimensions(n)
    // Pin IPNs to the top layer and leaves to the bottom; spines fall in
    // the middle (no constraint — elk places them between the two based
    // on edges). Without these hints elk sometimes interleaves tiers when
    // the edge graph is sparse (e.g. very small designs).
    const layoutOptions: Record<string, string> = {}
    if (n.role === 'ipn') layoutOptions['elk.layered.layering.layerConstraint'] = 'FIRST'
    else if (n.role === 'leaf') layoutOptions['elk.layered.layering.layerConstraint'] = 'LAST'
    return { id: n.id, width, height, layoutOptions }
  })

  const elkEdges: ElkExtendedEdge[] = graph.edges.map((e: TopologyEdge) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target]
  }))

  const layoutGraph: ElkNode = {
    id: 'topology-root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYOUT_LAYER_GAP),
      'elk.spacing.nodeNode': String(LAYOUT_NODE_GAP),
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.crossingMinimization.semiInteractive': 'false'
    },
    children: elkNodes,
    edges: elkEdges
  }

  const result = await elk.layout(layoutGraph)
  const positions: LaidOutPosition[] = []
  let maxX = 0
  let maxY = 0
  for (const child of result.children ?? []) {
    const x = child.x ?? 0
    const y = child.y ?? 0
    const width = child.width ?? NODE_BASE_WIDTH
    const height = child.height ?? NODE_HEIGHT_LEAF
    positions.push({ device_id: child.id!, x, y, width, height })
    if (x + width > maxX) maxX = x + width
    if (y + height > maxY) maxY = y + height
  }
  return {
    positions,
    graphWidth: maxX,
    graphHeight: maxY
  }
}
