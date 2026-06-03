import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeTypes,
  type NodeProps,
  type OnNodeDrag,
  MarkerType
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Cable, GitFork, RotateCcw, Maximize2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { useWorkspace } from '@/state/WorkspaceContext'
import {
  loadCableLinks,
  loadTopologyLayout,
  saveTopologyLayout,
  deleteTopologyLayout,
  type CableLinksFile
} from '@/lib/library-io'
import type { TopologyLayoutFile } from '@/schemas/topology-layout'
import type { DesignResult } from '@domain'
import { extractTopology, type TopologyGraph, type TopologyNode } from '@/lib/topology-extractor'
import {
  autoLayout,
  nodeDimensions,
  type LaidOutPosition
} from '@/lib/topology-elk-layout'

interface TopologyViewProps {
  projectPath: string
  onGoToDesign(): void
  onGoToRack(): void
  onGoToLinks(): void
}

// React-flow node data shape — spread into RFNode<TopoNodeData>.
interface TopoNodeData extends Record<string, unknown> {
  topo: TopologyNode
}

interface TopoEdgeData extends Record<string, unknown> {
  speed_g: number
  optic_id: string | null
  patch_panel_id: string | null
  length_m: number | null
  sourcePort: string
  targetPort: string
  label: string
}

// ────────────────────────────────────────────────────────────────────
// Inner component (must be inside <ReactFlowProvider>)
// ────────────────────────────────────────────────────────────────────

function TopologyCanvas({
  projectPath,
  onGoToDesign,
  onGoToRack,
  onGoToLinks
}: TopologyViewProps) {
  const { currentProjectPath } = useWorkspace()
  const [design, setDesign] = useState<DesignResult | null>(null)
  const [cableLinks, setCableLinks] = useState<CableLinksFile | null>(null)
  const [layoutFile, setLayoutFile] = useState<TopologyLayoutFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoLayoutBusy, setAutoLayoutBusy] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)

  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode<TopoNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge<TopoEdgeData>>([])

  const { fitView } = useReactFlow()

  // Built once per (design, cable_links) pair — extractor is pure.
  const graph: TopologyGraph = useMemo(() => {
    if (!design) return { nodes: [], edges: [], orphanDeviceIds: [] }
    return extractTopology(design, cableLinks?.links ?? [])
  }, [design, cableLinks])

  // ── Load on mount + every time the project path changes ──────────────
  useEffect(() => {
    if (!currentProjectPath) return
    let cancelled = false
    setLoading(true)
    setErr(null)
    ;(async () => {
      try {
        const [designRaw, links, layout] = await Promise.all([
          window.dcn
            .fileExists(`${projectPath}/design.yaml`)
            .then((exists) =>
              exists
                ? (window.dcn.readYaml(`${projectPath}/design.yaml`) as Promise<DesignResult>)
                : null
            ),
          loadCableLinks(projectPath),
          loadTopologyLayout(projectPath)
        ])
        if (cancelled) return
        setDesign(designRaw)
        setCableLinks(links)
        setLayoutFile(layout)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [currentProjectPath, projectPath])

  // ── Apply graph + positions to react-flow nodes/edges ───────────────
  // Whenever the extracted graph changes (or the layout file flips), we
  // rebuild the react-flow models. If there's no layout file, we run
  // elkjs and use those positions in-memory only (no auto-write — the
  // file is only created on first user drag, mirroring Phase 5/6).
  useEffect(() => {
    let cancelled = false
    if (graph.nodes.length === 0) {
      setNodes([])
      setEdges([])
      return () => {
        cancelled = true
      }
    }

    const positionsFromFile = new Map<string, { x: number; y: number }>()
    if (layoutFile) {
      for (const p of layoutFile.positions) {
        positionsFromFile.set(p.device_id, { x: p.x, y: p.y })
      }
    }

    const applyPositions = (positions: Map<string, { x: number; y: number }>) => {
      if (cancelled) return
      const deviceNodes: RFNode<TopoNodeData>[] = graph.nodes.map((n) => {
        const pos = positions.get(n.id) ?? { x: 0, y: 0 }
        return {
          id: n.id,
          type:
            n.role === 'spine' ? 'spineNode' : n.role === 'ipn' ? 'ipnNode' : 'leafNode',
          position: pos,
          data: { topo: n }
        }
      })
      // Pod boundary backdrops (multi-pod only) sit behind the device
      // nodes so each pod reads as a soft labeled region.
      const boundaryNodes = computePodBoundaries(graph.nodes, positions)
      const rfNodes = [...boundaryNodes, ...deviceNodes]
      const rfEdges: RFEdge<TopoEdgeData>[] = graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: `out:${e.sourcePort}`,
        target: e.target,
        targetHandle: `in:${e.targetPort}`,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        data: {
          speed_g: e.speed_g,
          optic_id: e.optic_id,
          patch_panel_id: e.patch_panel_id,
          length_m: e.length_m,
          sourcePort: e.sourcePort,
          targetPort: e.targetPort,
          label: e.label
        },
        label: `${e.speed_g}G`,
        labelStyle: { fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: 'var(--background)', fillOpacity: 0.85 },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
        animated: false,
        style: { strokeWidth: 1.5 }
      }))
      setNodes(rfNodes)
      setEdges(rfEdges)
      // Defer fit until after layout commit
      requestAnimationFrame(() => {
        if (!cancelled) fitView({ padding: 0.15, duration: 250 })
      })
    }

    if (positionsFromFile.size > 0) {
      applyPositions(positionsFromFile)
      return () => {
        cancelled = true
      }
    }

    // Fallback: run elkjs in the background
    autoLayout(graph)
      .then((laid) => {
        const m = new Map<string, { x: number; y: number }>()
        for (const p of laid.positions) m.set(p.device_id, { x: p.x, y: p.y })
        applyPositions(m)
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      })

    return () => {
      cancelled = true
    }
  }, [graph, layoutFile, fitView, setNodes, setEdges])

  // ── Persist on drag stop ─────────────────────────────────────────────
  const persistPositions = useCallback(
    async (currentNodes: RFNode<TopoNodeData>[]) => {
      try {
        const positions: LaidOutPosition[] = currentNodes
          .filter((n) => n.data?.topo) // drop pod-boundary backdrops
          .map((n) => {
            const dim = nodeDimensions(n.data.topo)
            return { device_id: n.id, x: n.position.x, y: n.position.y, ...dim }
          })
        const now = new Date().toISOString()
        const next: TopologyLayoutFile = {
          schema_version: 1,
          source: 'user',
          seeded_at: layoutFile?.seeded_at ?? now,
          forked_at: layoutFile?.forked_at ?? now,
          positions: positions.map(({ device_id, x, y }) => ({ device_id, x, y }))
        }
        await saveTopologyLayout(projectPath, next)
        setLayoutFile(next)
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    },
    [layoutFile, projectPath]
  )

  // Avoid persisting on every micro-move; flush when the drag ends.
  const onNodeDragStop: OnNodeDrag<RFNode<TopoNodeData>> = useCallback(
    (_event, _node, dragged) => {
      // dragged is the array of all nodes currently being dragged. We
      // persist the entire `nodes` snapshot so unrelated nodes keep their
      // positions too.
      void dragged
      // Use the most-recent node positions from react-flow's state.
      void persistPositions(nodesRef.current)
    },
    [persistPositions]
  )

  // Keep a ref of latest nodes so onNodeDragStop sees the post-move state.
  const nodesRef = useRef(nodes)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  // ── Reset to auto-layout ─────────────────────────────────────────────
  const handleReset = useCallback(async () => {
    setResetConfirmOpen(false)
    setAutoLayoutBusy(true)
    try {
      await deleteTopologyLayout(projectPath)
      setLayoutFile(null) // triggers the layout effect to re-run elkjs
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setAutoLayoutBusy(false)
    }
  }, [projectPath])

  // ── Re-run auto-layout (without resetting fork state) ────────────────
  // For users who have forked but want to re-run elk on the current graph
  // and keep iterating from there. Persists immediately as 'user'.
  const handleRunAutoLayout = useCallback(async () => {
    if (!design || graph.nodes.length === 0) return
    setAutoLayoutBusy(true)
    try {
      const laid = await autoLayout(graph)
      const positionMap = new Map<string, { x: number; y: number }>()
      for (const p of laid.positions) positionMap.set(p.device_id, { x: p.x, y: p.y })
      setNodes((prev) => {
        const devices = prev
          .filter((n) => n.data?.topo)
          .map((n) => ({ ...n, position: positionMap.get(n.id) ?? n.position }))
        const boundaries = computePodBoundaries(graph.nodes, positionMap)
        return [...boundaries, ...devices]
      })
      // Persist after a tick so nodesRef sees the new state.
      requestAnimationFrame(() => {
        void persistPositions(nodesRef.current)
        fitView({ padding: 0.15, duration: 300 })
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setAutoLayoutBusy(false)
    }
  }, [design, graph, setNodes, persistPositions, fitView])

  // ── Selection handlers ──────────────────────────────────────────────
  const onNodeClick = useCallback((_evt: React.MouseEvent, n: RFNode<TopoNodeData>) => {
    setSelectedNodeId(n.id)
    setSelectedEdgeId(null)
  }, [])
  const onEdgeClick = useCallback((_evt: React.MouseEvent, e: RFEdge<TopoEdgeData>) => {
    setSelectedEdgeId(e.id)
    setSelectedNodeId(null)
  }, [])
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
  }, [])

  const selectedNode = useMemo(
    () => (selectedNodeId ? graph.nodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [selectedNodeId, graph.nodes]
  )
  const selectedEdge = useMemo(
    () => (selectedEdgeId ? graph.edges.find((e) => e.id === selectedEdgeId) ?? null : null),
    [selectedEdgeId, graph.edges]
  )

  // ── Memoized node types so react-flow doesn't recreate them ─────────
  const nodeTypes: NodeTypes = useMemo(
    () => ({
      spineNode: SpineNodeRenderer,
      leafNode: LeafNodeRenderer,
      ipnNode: IpnNodeRenderer,
      podBoundary: PodBoundaryRenderer
    }),
    []
  )

  // ── Render ──────────────────────────────────────────────────────────
  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading topology…</div>
  }
  if (!design) {
    return <NoDesignState onGoToDesign={onGoToDesign} />
  }
  if (graph.nodes.length === 0) {
    return <EmptyTopologyState onGoToDesign={onGoToDesign} />
  }

  const isForked = layoutFile?.source === 'user'
  const linkCount = graph.edges.length

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Action bar */}
      <div className="border-b bg-muted/30 px-6 py-3 flex items-center gap-3 flex-wrap">
        <ForkStatusPill isForked={isForked} />
        <span className="text-xs text-muted-foreground">
          {graph.nodes.length} node{graph.nodes.length === 1 ? '' : 's'} · {linkCount} link
          {linkCount === 1 ? '' : 's'}
        </span>
        {graph.orphanDeviceIds.length > 0 && (
          <span className="text-xs text-amber-700 dark:text-amber-300">
            {graph.orphanDeviceIds.length} orphan
            {graph.orphanDeviceIds.length === 1 ? '' : 's'}
          </span>
        )}
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => fitView({ padding: 0.15, duration: 200 })}>
          <Maximize2 />
          Fit view
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRunAutoLayout}
          disabled={autoLayoutBusy}
        >
          {autoLayoutBusy ? <Loader2 className="animate-spin" /> : null}
          Auto-layout
        </Button>
        {isForked && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setResetConfirmOpen(true)}
            disabled={autoLayoutBusy}
          >
            <RotateCcw />
            Reset to auto-layout
          </Button>
        )}
      </div>

      {err && (
        <div className="border-b bg-destructive/10 text-destructive px-6 py-2 text-sm">
          {err}
        </div>
      )}

      {/* Body: 3-col grid — canvas + properties panel */}
      <div className="flex-1 grid min-h-0" style={{ gridTemplateColumns: '1fr 320px' }}>
        <div className="relative border-r min-h-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            fitView
            minZoom={0.2}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} />
            <Controls position="bottom-right" showInteractive={false} />
          </ReactFlow>
        </div>
        <div className="overflow-auto p-4">
          {selectedNode ? (
            <NodePropertiesPanel
              node={selectedNode}
              onGoToRack={onGoToRack}
              onGoToLinks={onGoToLinks}
            />
          ) : selectedEdge ? (
            <EdgePropertiesPanel edge={selectedEdge} graph={graph} onGoToLinks={onGoToLinks} />
          ) : (
            <EmptySelectionPanel />
          )}
        </div>
      </div>

      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to auto-layout?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes <code className="font-mono">topology_layout.yaml</code> and re-runs
              the auto-layout algorithm. Your manual node positions will be discarded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>Reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// Wrapper — react-flow's hooks need a Provider in scope.
export function TopologyView(props: TopologyViewProps) {
  return (
    <ReactFlowProvider>
      <TopologyCanvas {...props} />
    </ReactFlowProvider>
  )
}

// ────────────────────────────────────────────────────────────────────
// Custom node renderers
// ────────────────────────────────────────────────────────────────────

const ROLE_COLORS = {
  spine: { bg: 'bg-violet-50 dark:bg-violet-950/40', border: 'border-violet-300 dark:border-violet-800', text: 'text-violet-900 dark:text-violet-100', tag: 'bg-violet-200 dark:bg-violet-900 text-violet-900 dark:text-violet-100' },
  leaf: { bg: 'bg-sky-50 dark:bg-sky-950/40', border: 'border-sky-300 dark:border-sky-800', text: 'text-sky-900 dark:text-sky-100', tag: 'bg-sky-200 dark:bg-sky-900 text-sky-900 dark:text-sky-100' },
  ipn: { bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-300 dark:border-amber-800', text: 'text-amber-900 dark:text-amber-100', tag: 'bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-100' }
} as const

function SpineNodeRenderer({ data, selected }: NodeProps<RFNode<TopoNodeData>>) {
  return <PortNodeRenderer data={data} selected={selected ?? false} portSide="bottom" />
}

function LeafNodeRenderer({ data, selected }: NodeProps<RFNode<TopoNodeData>>) {
  return <PortNodeRenderer data={data} selected={selected ?? false} portSide="top" />
}

// IPN routers sit in the top tier; their ports face down toward the
// spines below them.
function IpnNodeRenderer({ data, selected }: NodeProps<RFNode<TopoNodeData>>) {
  return <PortNodeRenderer data={data} selected={selected ?? false} portSide="bottom" />
}

function PortNodeRenderer({
  data,
  selected,
  portSide
}: {
  data: TopoNodeData
  selected: boolean
  portSide: 'top' | 'bottom'
}) {
  const node = data.topo
  const colors = ROLE_COLORS[node.role]
  const dim = nodeDimensions(node)
  const orphan = node.model_id === 'unknown'

  // Distribute handles evenly across the port-side edge.
  const ports = node.usedPorts
  const handles = ports.map((p, i) => {
    const ratio = ports.length === 1 ? 0.5 : (i + 0.5) / ports.length
    return { port: p, leftPct: ratio * 100 }
  })

  return (
    <div
      className={`rounded-lg border-2 shadow-sm relative ${colors.bg} ${colors.border} ${
        selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''
      } ${orphan ? 'border-dashed' : ''}`}
      style={{ width: dim.width, height: dim.height }}
    >
      {/* Source handles (one per used port) */}
      {handles.map((h) => (
        <Handle
          key={`out-${h.port}`}
          id={`out:${h.port}`}
          type="source"
          position={portSide === 'bottom' ? Position.Bottom : Position.Top}
          style={{
            left: `${h.leftPct}%`,
            transform: 'translate(-50%, 0)',
            width: 8,
            height: 8,
            background: 'hsl(var(--primary))',
            border: '1px solid hsl(var(--primary-foreground))'
          }}
        />
      ))}
      {/* Target handles (matching ids so edges can attach in either direction) */}
      {handles.map((h) => (
        <Handle
          key={`in-${h.port}`}
          id={`in:${h.port}`}
          type="target"
          position={portSide === 'bottom' ? Position.Bottom : Position.Top}
          style={{
            left: `${h.leftPct}%`,
            transform: 'translate(-50%, 0)',
            width: 8,
            height: 8,
            opacity: 0
          }}
        />
      ))}

      <div className={`px-3 py-2 ${colors.text}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold text-sm truncate">{node.label}</div>
          <span
            className={`text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 ${colors.tag}`}
          >
            {node.role}
          </span>
        </div>
        <div className="text-[11px] opacity-70 font-mono truncate">{node.model_id}</div>
        {node.pod_index != null && (
          <div className="text-[10px] mt-1">
            <span className="rounded bg-foreground/10 px-1.5 py-0.5 font-medium">
              Pod {node.pod_index + 1}
            </span>
          </div>
        )}
        {node.rack && (
          <div className="text-[10px] opacity-60 mt-1">
            Rack: <span className="font-mono">{node.rack}</span>
          </div>
        )}
        <div className="text-[10px] opacity-60 mt-0.5">
          {ports.length} port{ports.length === 1 ? '' : 's'} in use
        </div>
      </div>

      {/* Port labels along the handle edge */}
      {ports.length > 0 && ports.length <= 16 && (
        <div
          className={`absolute left-0 right-0 ${
            portSide === 'bottom' ? 'bottom-0 translate-y-full pt-1' : 'top-0 -translate-y-full pb-1'
          } text-[8px] font-mono text-muted-foreground pointer-events-none`}
          style={{ height: 14 }}
        >
          {handles.map((h) => (
            <span
              key={h.port}
              className="absolute"
              style={{
                left: `${h.leftPct}%`,
                transform: 'translate(-50%, 0)'
              }}
            >
              {shortPortName(h.port)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function shortPortName(p: string): string {
  // "Eth1/49" → "49"; "Eth1/49/2" → "49/2"
  const m = /^Eth\d+\/(.+)$/.exec(p)
  return m ? m[1] : p
}

// ────────────────────────────────────────────────────────────────────
// Pod boundaries (Multi-Pod ACI) — soft labeled backdrop per pod
// ────────────────────────────────────────────────────────────────────

const POD_PAD = 28
const POD_LABEL_H = 24

// Build non-interactive backdrop nodes, one per ACI pod, sized to the
// bounding box of that pod's spines + leaves. Returns [] for single-pod
// designs (no node carries a pod_index).
function computePodBoundaries(
  nodes: TopologyNode[],
  positions: Map<string, { x: number; y: number }>
): RFNode<TopoNodeData>[] {
  const pods = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>()
  for (const n of nodes) {
    if (n.pod_index == null) continue
    const pos = positions.get(n.id)
    if (!pos) continue
    const dim = nodeDimensions(n)
    const b = pods.get(n.pod_index) ?? {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity
    }
    b.minX = Math.min(b.minX, pos.x)
    b.minY = Math.min(b.minY, pos.y)
    b.maxX = Math.max(b.maxX, pos.x + dim.width)
    b.maxY = Math.max(b.maxY, pos.y + dim.height)
    pods.set(n.pod_index, b)
  }
  const out: RFNode<TopoNodeData>[] = []
  for (const [pod, b] of [...pods.entries()].sort((a, c) => a[0] - c[0])) {
    if (!Number.isFinite(b.minX)) continue
    out.push({
      id: `pod-boundary-${pod}`,
      type: 'podBoundary',
      position: { x: b.minX - POD_PAD, y: b.minY - POD_PAD - POD_LABEL_H },
      data: { podLabel: `Pod ${pod + 1}` } as unknown as TopoNodeData,
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
      style: {
        width: b.maxX - b.minX + POD_PAD * 2,
        height: b.maxY - b.minY + POD_PAD * 2 + POD_LABEL_H
      }
    })
  }
  return out
}

function PodBoundaryRenderer({ data }: NodeProps<RFNode<TopoNodeData>>) {
  const label = (data as unknown as { podLabel?: string }).podLabel ?? 'Pod'
  return (
    <div className="w-full h-full rounded-xl border-2 border-dashed border-amber-400/50 bg-amber-100/10 dark:bg-amber-400/[0.04] pointer-events-none">
      <div className="text-xs font-semibold text-amber-700 dark:text-amber-300 px-2 pt-1">
        {label}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Properties panels
// ────────────────────────────────────────────────────────────────────

function NodePropertiesPanel({
  node,
  onGoToRack,
  onGoToLinks
}: {
  node: TopologyNode
  onGoToRack(): void
  onGoToLinks(): void
}) {
  const orphan = node.model_id === 'unknown'
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{node.label}</CardTitle>
          <span className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-muted text-muted-foreground">
            {node.role}
          </span>
        </div>
        <CardDescription className="font-mono text-xs">{node.id}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {orphan && (
          <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-xs">
            This device is referenced by a cable link but isn't in the current rack layout.
            Re-generate or re-import to re-anchor it.
          </div>
        )}
        <KV label="Model" value={<span className="font-mono">{node.model_id}</span>} />
        <KV label="Role" value={node.role} />
        {node.pod_index != null && <KV label="Pod" value={`Pod ${node.pod_index + 1}`} />}
        <KV label="Rack" value={node.rack ?? <span className="text-muted-foreground">—</span>} />
        <KV label="RU" value={node.ru ?? <span className="text-muted-foreground">—</span>} />
        <div>
          <div className="text-xs text-muted-foreground mb-1">
            Used ports ({node.usedPorts.length})
          </div>
          {node.usedPorts.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">No cable links attached.</div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {node.usedPorts.map((p) => (
                <span
                  key={p}
                  className="rounded bg-muted text-muted-foreground text-[10px] font-mono px-1.5 py-0.5"
                >
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={onGoToRack}>
            Rack View
          </Button>
          <Button size="sm" variant="outline" onClick={onGoToLinks}>
            Links
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function EdgePropertiesPanel({
  edge,
  graph,
  onGoToLinks
}: {
  edge: ReturnType<typeof extractTopology> extends infer R
    ? R extends { edges: (infer E)[] } ? E : never
    : never
  graph: TopologyGraph
  onGoToLinks(): void
}) {
  const sourceNode = graph.nodes.find((n) => n.id === edge.source)
  const targetNode = graph.nodes.find((n) => n.id === edge.target)
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Cable link</CardTitle>
        <CardDescription className="font-mono text-xs">{edge.id}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <KV
          label="From"
          value={
            <span>
              <span className="font-medium">{sourceNode?.label ?? edge.source}</span>{' '}
              <span className="font-mono text-xs text-muted-foreground">: {edge.sourcePort}</span>
            </span>
          }
        />
        <KV
          label="To"
          value={
            <span>
              <span className="font-medium">{targetNode?.label ?? edge.target}</span>{' '}
              <span className="font-mono text-xs text-muted-foreground">: {edge.targetPort}</span>
            </span>
          }
        />
        <KV label="Speed" value={`${edge.speed_g}G`} />
        <KV
          label="Optic"
          value={
            edge.optic_id ? (
              <span className="font-mono">{edge.optic_id}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )
          }
        />
        <KV
          label="Patch panel"
          value={
            edge.patch_panel_id ? (
              <span className="font-mono">{edge.patch_panel_id}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )
          }
        />
        <KV
          label="Length"
          value={
            edge.length_m != null ? (
              `${edge.length_m} m`
            ) : (
              <span className="text-muted-foreground">—</span>
            )
          }
        />
        {edge.label && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Label</div>
            <div className="text-xs">{edge.label}</div>
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={onGoToLinks}>
            Edit in Links
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function EmptySelectionPanel() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Topology</CardTitle>
        <CardDescription className="text-xs">Click a node or cable to inspect.</CardDescription>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-2">
        <p>
          Auto-layout is generated by elkjs. Drag any node to fork into{' '}
          <code className="font-mono">topology_layout.yaml</code>.
        </p>
        <p>Use the action bar above to fit the view, re-run auto-layout, or reset.</p>
      </CardContent>
    </Card>
  )
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Status pill (mirrors LinksView / RackView)
// ────────────────────────────────────────────────────────────────────

function ForkStatusPill({ isForked }: { isForked: boolean }) {
  if (isForked) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 text-xs font-medium px-2.5 py-1">
        <GitFork className="size-3.5" />
        Forked — your layout
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted text-muted-foreground text-xs font-medium px-2.5 py-1">
      <Cable className="size-3.5" />
      Auto-layout (elkjs)
    </span>
  )
}

// ────────────────────────────────────────────────────────────────────
// Empty states
// ────────────────────────────────────────────────────────────────────

function NoDesignState({ onGoToDesign }: { onGoToDesign(): void }) {
  return (
    <div className="p-8 max-w-xl mx-auto">
      <Card>
        <CardContent className="py-8 space-y-3 text-center">
          <h2 className="text-base font-semibold">No design yet</h2>
          <p className="text-sm text-muted-foreground">
            Topology is rendered from <code className="font-mono">design.yaml</code> +{' '}
            <code className="font-mono">cable_links.yaml</code>. Run{' '}
            <strong>Generate design</strong> on the Design tab first.
          </p>
          <div className="flex justify-center pt-2">
            <Button onClick={onGoToDesign}>Go to Design</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function EmptyTopologyState({ onGoToDesign }: { onGoToDesign(): void }) {
  return (
    <div className="p-8 max-w-xl mx-auto">
      <Card>
        <CardContent className="py-8 space-y-3 text-center">
          <h2 className="text-base font-semibold">Nothing to render</h2>
          <p className="text-sm text-muted-foreground">
            The current design has no spines or leaves yet. Generate a design with at least one
            tier and a spine model.
          </p>
          <div className="flex justify-center pt-2">
            <Button onClick={onGoToDesign}>Go to Design</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
