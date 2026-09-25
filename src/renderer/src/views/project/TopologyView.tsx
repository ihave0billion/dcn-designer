import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useNodesState,
  useEdgesState,
  useNodesInitialized,
  useReactFlow,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeTypes,
  type EdgeTypes,
  type NodeProps,
  type EdgeProps,
  type OnNodeDrag
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Globe,
  Info,
  Loader2,
  Maximize2,
  Minus,
  Pencil,
  Plus,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
import { TOPOLOGY_LAYOUT_GENERATOR, type TopologyLayoutFile } from '@/schemas/topology-layout'
import type { DesignResult } from '@domain'
import {
  extractTopology,
  type TopologyGraph,
  type TopologyNode,
  type TopologyEdge
} from '@/lib/topology-extractor'
import {
  buildFabrics,
  buildScene,
  drillInto,
  layoutScene,
  matchesFilter,
  parentLevel,
  parseFilter,
  sameLevel,
  TILE_H,
  TILE_W,
  type HealthStatus,
  type Orientation,
  type Scene,
  type SceneEdge,
  type SceneLevel,
  type SceneNode
} from '@/lib/topology-hierarchy'
import { cn } from '@/lib/utils'

interface TopologyViewProps {
  projectPath: string
  fabricName: string
  onGoToDesign(): void
  onGoToRack(): void
  onGoToLinks(): void
}

interface TileData extends Record<string, unknown> {
  scene: SceneNode
  dimmed: boolean
}

interface FanEdgeData extends Record<string, unknown> {
  scene: SceneEdge
  index: number
  siblings: number
  showLabel: boolean
}

type TileNode = RFNode<TileData, 'tile'>
type FanEdge = RFEdge<FanEdgeData, 'fan'>

// ────────────────────────────────────────────────────────────────────
// Canvas (inside <ReactFlowProvider>)
// ────────────────────────────────────────────────────────────────────

function TopologyCanvas({
  projectPath,
  fabricName,
  onGoToDesign,
  onGoToRack,
  onGoToLinks
}: TopologyViewProps) {
  const { currentProjectPath } = useWorkspace()
  const [design, setDesign] = useState<DesignResult | null>(null)
  const [cableLinks, setCableLinks] = useState<CableLinksFile | null>(null)
  const [layoutFile, setLayoutFile] = useState<TopologyLayoutFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // View state
  const [level, setLevel] = useState<SceneLevel>({ kind: 'fabrics' })
  const [aggregate, setAggregate] = useState(true)
  const [orientation, setOrientation] = useState<Orientation>('vertical')
  const [filterText, setFilterText] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)

  const [nodes, setNodes, onNodesChange] = useNodesState<TileNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<FanEdge>([])
  const { fitView, zoomIn, zoomOut } = useReactFlow()
  const nodesInitialized = useNodesInitialized()

  // ── Data ────────────────────────────────────────────────────────────
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

  const graph: TopologyGraph = useMemo(() => {
    if (!design) return { nodes: [], edges: [], orphanDeviceIds: [] }
    return extractTopology(design, cableLinks?.links ?? [])
  }, [design, cableLinks])

  const fabrics = useMemo(() => buildFabrics(graph, fabricName), [graph, fabricName])

  // If the level points at a fabric that no longer exists (design regen), pop up.
  useEffect(() => {
    if (level.kind !== 'fabrics' && !fabrics.some((f) => f.id === level.fabricId)) {
      setLevel({ kind: 'fabrics' })
    }
  }, [fabrics, level])

  const scene: Scene = useMemo(
    () => buildScene(graph, fabrics, level, { aggregate }),
    [graph, fabrics, level, aggregate]
  )

  const filterClauses = useMemo(() => parseFilter(filterText), [filterText])

  // Positions: tier layout, overridden by the saved layout at device level.
  const positions = useMemo(() => {
    const auto = layoutScene(scene.nodes, orientation)
    const usable = layoutFile?.generator === TOPOLOGY_LAYOUT_GENERATOR
    if (level.kind === 'devices' && layoutFile && usable && orientation === 'vertical') {
      for (const p of layoutFile.positions) {
        if (auto.has(p.device_id)) auto.set(p.device_id, { x: p.x, y: p.y })
      }
    }
    return auto
  }, [scene.nodes, orientation, level, layoutFile])

  // ── Scene → react-flow ──────────────────────────────────────────────
  useEffect(() => {
    const vertical = orientation === 'vertical'
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const isDimmed = (n: SceneNode): boolean => {
      if (filterClauses.length === 0) return false
      return !n.memberIds.some((id) => {
        const dev = byId.get(id)
        return dev ? matchesFilter(dev, filterClauses) : false
      })
    }
    const rfNodes: TileNode[] = scene.nodes.map((n) => ({
      id: n.id,
      type: 'tile',
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: { scene: n, dimmed: isDimmed(n) },
      draggable: editMode && level.kind === 'devices' && n.kind === 'device',
      sourcePosition: vertical ? Position.Bottom : Position.Right,
      targetPosition: vertical ? Position.Top : Position.Left,
      width: TILE_W,
      height: TILE_H
    }))

    // Parallel (non-aggregated) cables between the same pair fan out.
    const siblings = new Map<string, number>()
    for (const e of scene.edges) {
      const k = `${e.source}|${e.target}`
      siblings.set(k, (siblings.get(k) ?? 0) + 1)
    }
    const seen = new Map<string, number>()
    const rfEdges: FanEdge[] = scene.edges.map((e) => {
      const k = `${e.source}|${e.target}`
      const index = seen.get(k) ?? 0
      seen.set(k, index + 1)
      return {
        id: e.id,
        type: 'fan',
        source: e.source,
        target: e.target,
        data: { scene: e, index, siblings: siblings.get(k) ?? 1, showLabel: e.count > 1 }
      }
    })
    setNodes(rfNodes)
    setEdges(rfEdges)
  }, [scene, positions, orientation, editMode, level, filterClauses, graph.nodes, setNodes, setEdges])

  // Frame the graph whenever the level or orientation changes — once the
  // new tiles have been measured, otherwise fitView sees an empty bounds.
  const frameKey = `${level.kind}:${level.kind === 'fabrics' ? '' : level.fabricId}:${orientation}`
  useEffect(() => {
    if (!nodesInitialized) return
    const t = window.setTimeout(
      () => fitView({ padding: 0.12, duration: 300, maxZoom: 1.25 }),
      20
    )
    return () => window.clearTimeout(t)
  }, [frameKey, nodesInitialized, fitView])

  // ── Navigation ──────────────────────────────────────────────────────
  const goTo = useCallback((next: SceneLevel) => {
    setLevel((cur) => (sameLevel(cur, next) ? cur : next))
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
  }, [])

  const goUp = useCallback(() => {
    const p = parentLevel(level)
    if (p) goTo(p)
  }, [level, goTo])

  const onNodeDoubleClick = useCallback(
    (_e: React.MouseEvent, n: TileNode) => {
      const next = drillInto(n.data.scene, level)
      if (next) goTo(next)
    },
    [level, goTo]
  )

  // Double-clicking empty canvas folds one level back up.
  const onCanvasDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const el = e.target as HTMLElement
      if (el.classList.contains('react-flow__pane')) goUp()
    },
    [goUp]
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (legendOpen) setLegendOpen(false)
      else if (actionsOpen) setActionsOpen(false)
      else if (selectedNodeId || selectedEdgeId) {
        setSelectedNodeId(null)
        setSelectedEdgeId(null)
      } else goUp()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goUp, legendOpen, actionsOpen, selectedNodeId, selectedEdgeId])

  // ── Selection ───────────────────────────────────────────────────────
  const onNodeClick = useCallback((_e: React.MouseEvent, n: TileNode) => {
    setSelectedNodeId(n.id)
    setSelectedEdgeId(null)
  }, [])
  const onEdgeClick = useCallback((_e: React.MouseEvent, e: FanEdge) => {
    setSelectedEdgeId(e.id)
    setSelectedNodeId(null)
  }, [])
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setActionsOpen(false)
  }, [])

  const selectedNode = useMemo(
    () => (selectedNodeId ? scene.nodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [selectedNodeId, scene.nodes]
  )
  const selectedEdge = useMemo(
    () => (selectedEdgeId ? scene.edges.find((e) => e.id === selectedEdgeId) ?? null : null),
    [selectedEdgeId, scene.edges]
  )

  // ── Freeform layout persistence (device level only) ────────────────
  const nodesRef = useRef(nodes)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  const persistPositions = useCallback(async () => {
    try {
      const now = new Date().toISOString()
      const kept = new Map<string, { x: number; y: number }>()
      // Positions from the old (v1.0) layout engine are a different geometry — drop them.
      if (layoutFile?.generator === TOPOLOGY_LAYOUT_GENERATOR) {
        for (const p of layoutFile.positions) kept.set(p.device_id, { x: p.x, y: p.y })
      }
      for (const n of nodesRef.current) {
        if (n.data.scene.kind === 'device') kept.set(n.id, { x: n.position.x, y: n.position.y })
      }
      const next: TopologyLayoutFile = {
        schema_version: 1,
        source: 'user',
        seeded_at: layoutFile?.seeded_at ?? now,
        forked_at: layoutFile?.forked_at ?? now,
        positions: [...kept.entries()].map(([device_id, p]) => ({ device_id, x: p.x, y: p.y })),
        generator: TOPOLOGY_LAYOUT_GENERATOR
      }
      await saveTopologyLayout(projectPath, next)
      setLayoutFile(next)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [layoutFile, projectPath])

  const onNodeDragStop: OnNodeDrag<TileNode> = useCallback(() => {
    void persistPositions()
  }, [persistPositions])

  const handleResetLayout = useCallback(async () => {
    setResetConfirmOpen(false)
    try {
      await deleteTopologyLayout(projectPath)
      setLayoutFile(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [projectPath])

  const nodeTypes: NodeTypes = useMemo(() => ({ tile: TileRenderer }), [])
  const edgeTypes: EdgeTypes = useMemo(() => ({ fan: FanEdgeRenderer }), [])

  // ── Render ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" /> Loading topology…
      </div>
    )
  }
  if (!design) return <NoDesignState onGoToDesign={onGoToDesign} />
  if (graph.nodes.length === 0) return <EmptyTopologyState onGoToDesign={onGoToDesign} />

  const spineCount = graph.nodes.filter((n) => n.role === 'spine').length
  const leafCount = graph.nodes.filter((n) => n.role === 'leaf').length
  const isForked = layoutFile?.source === 'user'
  const legacyLayout = isForked && layoutFile?.generator !== TOPOLOGY_LAYOUT_GENERATOR
  const canGoUp = parentLevel(level) !== null
  const detailOpen = !!(selectedNode || selectedEdge)

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Breadcrumb row */}
      <div className="px-6 pt-3 pb-2 flex items-center gap-2 flex-wrap">
        <nav className="flex items-center gap-1 text-sm">
          {scene.breadcrumb.map((c, i) => {
            const last = i === scene.breadcrumb.length - 1
            return (
              <span key={c.label + i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground" />}
                {last ? (
                  <span className="font-semibold">{c.label}</span>
                ) : (
                  <button
                    className="text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={() => goTo(c.level)}
                  >
                    {c.label}
                  </button>
                )}
              </span>
            )
          })}
        </nav>
        <span className="text-xs text-muted-foreground ml-2">
          {spineCount} spine{spineCount === 1 ? '' : 's'} · {leafCount} lea
          {leafCount === 1 ? 'f' : 'ves'} · {graph.edges.length} link
          {graph.edges.length === 1 ? '' : 's'}
        </span>
        {graph.orphanDeviceIds.length > 0 && (
          <StatusChip status="minor">
            {graph.orphanDeviceIds.length} orphan{graph.orphanDeviceIds.length === 1 ? '' : 's'}
          </StatusChip>
        )}
        {isForked && !legacyLayout && <StatusChip status="unknown">Custom layout</StatusChip>}
        {legacyLayout && (
          <StatusChip status="unknown">Old layout file ignored — drag or reset to replace</StatusChip>
        )}
        <div className="flex-1" />
        <div className="inline-flex rounded-md border text-xs overflow-hidden">
          <span className="px-2.5 py-1 bg-accent text-accent-foreground font-medium border-r">
            Design status
          </span>
          <span className="px-2.5 py-1 text-muted-foreground">
            {aggregate ? 'Aggregated links' : 'Per-cable links'}
          </span>
        </div>
      </div>

      {/* Filter + Actions row */}
      <div className="px-6 pb-3 flex items-center gap-2 relative">
        <Input
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter by attributes — e.g. model=N9K-C93, rack contains R1, leaf 3"
          className="h-9"
        />
        <div className="relative">
          <Button
            size="sm"
            className="h-9"
            onClick={() => setActionsOpen((v) => !v)}
            aria-expanded={actionsOpen}
          >
            Actions
            <ChevronDown className={cn('transition-transform', actionsOpen && 'rotate-180')} />
          </Button>
          {actionsOpen && (
            <ActionsMenu
              onClose={() => setActionsOpen(false)}
              orientation={orientation}
              onOrientation={setOrientation}
              aggregate={aggregate}
              onAggregate={setAggregate}
              editMode={editMode}
              onEditMode={setEditMode}
              canReset={isForked}
              onReset={() => setResetConfirmOpen(true)}
              onExpandAll={() => {
                const f = level.kind === 'fabrics' ? fabrics[0] : fabrics.find((x) => x.id === level.fabricId)
                if (f) goTo({ kind: 'devices', fabricId: f.id })
              }}
              onCollapse={() => goTo({ kind: 'fabrics' })}
              onFit={() => fitView({ padding: 0.12, duration: 250 })}
              onLegend={() => setLegendOpen(true)}
            />
          )}
        </div>
      </div>

      {err && (
        <div className="border-y bg-destructive/10 text-destructive px-6 py-2 text-sm">{err}</div>
      )}

      {/* Canvas */}
      <div
        className="flex-1 relative min-h-0 border-t overflow-hidden"
        onDoubleClick={onCanvasDoubleClick}
      >
        <ReactFlow<TileNode, FanEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          onNodeDragStop={onNodeDragStop}
          nodesConnectable={false}
          zoomOnDoubleClick={false}
          minZoom={0.08}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--canvas-grid)" />
        </ReactFlow>

        {/* ND-style control stack */}
        <div className="absolute bottom-4 right-4 flex flex-col rounded-md border bg-card shadow-sm overflow-hidden">
          <CtrlButton title="Up one level (Esc)" onClick={goUp} disabled={!canGoUp}>
            <ChevronUp />
          </CtrlButton>
          <CtrlButton title="Zoom in" onClick={() => zoomIn({ duration: 150 })}>
            <Plus />
          </CtrlButton>
          <CtrlButton title="Zoom out" onClick={() => zoomOut({ duration: 150 })}>
            <Minus />
          </CtrlButton>
          <CtrlButton title="Fit view" onClick={() => fitView({ padding: 0.12, duration: 250 })}>
            <Maximize2 />
          </CtrlButton>
          <CtrlButton
            title={editMode ? 'Freeform layout on — click to lock' : 'Edit layout (drag switches)'}
            active={editMode}
            onClick={() => setEditMode((v) => !v)}
          >
            <Pencil />
          </CtrlButton>
          <CtrlButton title="Legend" active={legendOpen} onClick={() => setLegendOpen((v) => !v)}>
            <Info />
          </CtrlButton>
        </div>

        {editMode && level.kind !== 'devices' && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-md border bg-card px-3 py-1.5 text-xs shadow-sm">
            Freeform layout applies at the switch level — double-click a fabric, then Spines or
            Leaves.
          </div>
        )}

        {/* Slide-in detail pane */}
        <aside
          className={cn(
            'absolute top-0 right-0 h-full w-[340px] bg-card border-l shadow-xl transition-transform duration-200 overflow-auto',
            detailOpen ? 'translate-x-0' : 'translate-x-full'
          )}
        >
          {selectedNode && (
            <DetailPane
              title={selectedNode.label}
              subtitle={selectedNode.sublabel}
              status={selectedNode.status}
              onClose={() => setSelectedNodeId(null)}
            >
              <NodeDetails
                node={selectedNode}
                graph={graph}
                onDrill={() => {
                  const next = drillInto(selectedNode, level)
                  if (next) goTo(next)
                }}
                onSelectDevice={(id) => {
                  if (selectedNode.fabricId) {
                    goTo({ kind: 'devices', fabricId: selectedNode.fabricId })
                    setSelectedNodeId(id)
                  }
                }}
                onGoToRack={onGoToRack}
                onGoToLinks={onGoToLinks}
              />
            </DetailPane>
          )}
          {selectedEdge && (
            <DetailPane
              title={selectedEdge.count === 1 ? 'Cable link' : `${selectedEdge.count} cable links`}
              subtitle={selectedEdge.label}
              status="healthy"
              onClose={() => setSelectedEdgeId(null)}
            >
              <EdgeDetails edge={selectedEdge} graph={graph} onGoToLinks={onGoToLinks} />
            </DetailPane>
          )}
        </aside>

        {/* Legend drawer */}
        <aside
          className={cn(
            'absolute top-0 right-0 h-full w-[300px] bg-card border-l shadow-xl transition-transform duration-200 overflow-auto',
            legendOpen ? 'translate-x-0' : 'translate-x-full'
          )}
        >
          <LegendPane onClose={() => setLegendOpen(false)} />
        </aside>
      </div>

      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset saved layout?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes <code className="font-mono">topology_layout.yaml</code>. Switch positions
              go back to the automatic tiered layout.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetLayout}>Reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function TopologyView(props: TopologyViewProps) {
  return (
    <ReactFlowProvider>
      <TopologyCanvas {...props} />
    </ReactFlowProvider>
  )
}

// ────────────────────────────────────────────────────────────────────
// Tiles
// ────────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<HealthStatus, { icon: string; pill: string; badge: string | null; glyph: string }> = {
  healthy: { icon: 'text-ok', pill: 'bg-ok-soft', badge: null, glyph: '' },
  warning: { icon: 'text-warn', pill: 'bg-warn-soft', badge: 'bg-warn', glyph: '–' },
  minor: { icon: 'text-minor', pill: 'bg-minor-soft', badge: 'bg-minor', glyph: '!' },
  major: { icon: 'text-major', pill: 'bg-major-soft', badge: 'bg-major', glyph: '!' },
  critical: { icon: 'text-crit', pill: 'bg-crit-soft', badge: 'bg-crit', glyph: '×' },
  unknown: { icon: 'text-unknown', pill: 'bg-unknown-soft', badge: 'bg-unknown', glyph: '?' }
}

function TileRenderer({ data, selected, sourcePosition, targetPosition }: NodeProps<TileNode>) {
  const n = data.scene
  const s = STATUS_STYLE[n.status]
  const stacked = n.kind === 'group'
  const drillable = n.kind === 'fabric' || n.kind === 'group'
  return (
    <div
      className={cn(
        'flex flex-col items-center select-none transition-opacity',
        data.dimmed && 'opacity-25'
      )}
      style={{ width: TILE_W, height: TILE_H }}
      title={drillable ? 'Double-click to open' : undefined}
    >
      <div className="relative">
        {stacked && (
          <>
            <div className="absolute -top-2 -right-2 size-14 rounded-lg border border-tile-border/70 bg-tile" />
            <div className="absolute -top-1 -right-1 size-14 rounded-lg border border-tile-border/85 bg-tile" />
          </>
        )}
        <div
          className={cn(
            'relative size-14 rounded-lg border bg-tile border-tile-border flex items-center justify-center shadow-sm',
            selected && 'ring-2 ring-primary ring-offset-2 ring-offset-canvas',
            n.kind === 'device' && n.device?.model_id === 'unknown' && 'border-dashed'
          )}
        >
          <Handle
            type="target"
            position={targetPosition ?? Position.Top}
            style={{ opacity: 0, width: 4, height: 4, minWidth: 0, minHeight: 0, border: 0 }}
            isConnectable={false}
          />
          <Handle
            type="source"
            position={sourcePosition ?? Position.Bottom}
            style={{ opacity: 0, width: 4, height: 4, minWidth: 0, minHeight: 0, border: 0 }}
            isConnectable={false}
          />
          <span className={cn('size-7', s.icon)}>
            <TileIcon kind={n.kind} role={n.role} />
          </span>
          {s.badge && (
            <span
              className={cn(
                'absolute -top-2 -right-2 size-4 rounded-full text-[10px] font-bold text-white flex items-center justify-center ring-2 ring-tile',
                s.badge
              )}
            >
              {s.glyph}
            </span>
          )}
          {stacked && (
            <span className="absolute -bottom-2 -right-2 min-w-5 h-5 px-1 rounded-full bg-card border text-[10px] font-semibold flex items-center justify-center">
              {n.count}
            </span>
          )}
        </div>
      </div>
      <div
        className={cn(
          'mt-2 max-w-full truncate rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight',
          s.pill
        )}
      >
        {n.label}
      </div>
    </div>
  )
}

function TileIcon({ kind, role }: { kind: SceneNode['kind']; role: SceneNode['role'] }) {
  if (kind === 'fabric') return <Globe className="size-full" strokeWidth={1.6} />
  if (kind === 'ipn' || role === 'ipn') return <RouterGlyph />
  return <SwitchGlyph />
}

// ND's switch glyph: two horizontal arrows with crossing shafts.
function SwitchGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8h14" />
      <path d="M14 5l3 3-3 3" />
      <path d="M21 16H7" />
      <path d="M10 13l-3 3 3 3" />
      <path d="M9 8l6 8" />
      <path d="M15 8l-6 8" />
    </svg>
  )
}

// Cisco router glyph: circle with crossing arrows.
function RouterGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" />
      <path d="M7 9.5h8M12.5 7l2.5 2.5L12.5 12" />
      <path d="M17 14.5H9M11.5 12L9 14.5l2.5 2.5" />
    </svg>
  )
}

// ────────────────────────────────────────────────────────────────────
// Edges — bezier, fanned when several cables share a pair
// ────────────────────────────────────────────────────────────────────

function FanEdgeRenderer({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected
}: EdgeProps<FanEdge>) {
  const index = data?.index ?? 0
  const siblings = data?.siblings ?? 1
  const count = data?.scene.count ?? 1
  const horizontal = sourcePosition === Position.Right || sourcePosition === Position.Left
  const off = (index - (siblings - 1) / 2) * 12

  let path: string
  let lx: number
  let ly: number
  if (siblings <= 1) {
    ;[path, lx, ly] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  } else if (!horizontal) {
    const my = (sourceY + targetY) / 2
    path = `M ${sourceX} ${sourceY} C ${sourceX + off} ${my}, ${targetX + off} ${my}, ${targetX} ${targetY}`
    lx = (sourceX + targetX) / 2 + off * 0.75
    ly = my
  } else {
    const mx = (sourceX + targetX) / 2
    path = `M ${sourceX} ${sourceY} C ${mx} ${sourceY + off}, ${mx} ${targetY + off}, ${targetX} ${targetY}`
    lx = mx
    ly = (sourceY + targetY) / 2 + off * 0.75
  }
  const width = Math.min(1.5 + (count - 1) * 0.35, 6)
  const showLabel = selected || (data?.showLabel ?? false)
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={14}
        style={{
          strokeWidth: selected ? width + 1 : width,
          stroke: selected ? 'var(--primary)' : 'var(--link)',
          opacity: selected ? 1 : 0.9
        }}
      />
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            className="absolute pointer-events-none rounded border bg-card px-1.5 py-0.5 text-[10px] font-medium shadow-sm nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          >
            {data?.scene.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

// ────────────────────────────────────────────────────────────────────
// Chrome: controls, actions menu, status chip
// ────────────────────────────────────────────────────────────────────

function CtrlButton({
  children,
  title,
  onClick,
  active,
  disabled
}: {
  children: ReactNode
  title: string
  onClick(): void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'size-9 flex items-center justify-center border-b last:border-b-0 text-foreground/80 hover:bg-accent hover:text-foreground cursor-pointer disabled:opacity-35 disabled:cursor-default [&_svg]:size-4',
        active && 'bg-primary/15 text-primary'
      )}
    >
      {children}
    </button>
  )
}

function StatusChip({ status, children }: { status: HealthStatus; children: ReactNode }) {
  return (
    <span className={cn('rounded px-2 py-0.5 text-[11px] font-medium', STATUS_STYLE[status].pill)}>
      {children}
    </span>
  )
}

function ActionsMenu({
  onClose,
  orientation,
  onOrientation,
  aggregate,
  onAggregate,
  editMode,
  onEditMode,
  canReset,
  onReset,
  onExpandAll,
  onCollapse,
  onFit,
  onLegend
}: {
  onClose(): void
  orientation: Orientation
  onOrientation(o: Orientation): void
  aggregate: boolean
  onAggregate(v: boolean): void
  editMode: boolean
  onEditMode(v: boolean): void
  canReset: boolean
  onReset(): void
  onExpandAll(): void
  onCollapse(): void
  onFit(): void
  onLegend(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const t = window.setTimeout(() => window.addEventListener('mousedown', onDown), 0)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const row = 'w-full flex items-center justify-between gap-4 px-3 py-2 text-sm text-left hover:bg-accent cursor-pointer'
  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 w-64 rounded-md border bg-popover text-popover-foreground shadow-lg z-20 py-1"
    >
      <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        Layout
      </div>
      <button className={row} onClick={() => onOrientation('vertical')}>
        <span>Vertical (default)</span>
        <Radio on={orientation === 'vertical'} />
      </button>
      <button className={row} onClick={() => onOrientation('horizontal')}>
        <span>Horizontal</span>
        <Radio on={orientation === 'horizontal'} />
      </button>
      <div className="my-1 border-t" />
      <button className={row} onClick={() => onAggregate(!aggregate)}>
        <span>Aggregate links</span>
        <Switch on={aggregate} />
      </button>
      <button className={row} onClick={() => onEditMode(!editMode)}>
        <span>Freeform layout</span>
        <Switch on={editMode} />
      </button>
      <div className="my-1 border-t" />
      <button className={row} onClick={() => { onExpandAll(); onClose() }}>
        Expand to switches
      </button>
      <button className={row} onClick={() => { onCollapse(); onClose() }}>
        Collapse to fabrics
      </button>
      <button className={row} onClick={() => { onFit(); onClose() }}>
        Fit view
      </button>
      <button className={row} onClick={() => { onLegend(); onClose() }}>
        Legend
      </button>
      {canReset && (
        <>
          <div className="my-1 border-t" />
          <button className={cn(row, 'text-destructive')} onClick={() => { onReset(); onClose() }}>
            Reset saved layout…
          </button>
        </>
      )}
    </div>
  )
}

function Radio({ on }: { on: boolean }) {
  return (
    <span className={cn('size-3.5 rounded-full border-2 flex items-center justify-center', on ? 'border-primary' : 'border-muted-foreground/50')}>
      {on && <span className="size-1.5 rounded-full bg-primary" />}
    </span>
  )
}

function Switch({ on }: { on: boolean }) {
  return (
    <span className={cn('relative inline-block h-4 w-7 rounded-full transition-colors', on ? 'bg-primary' : 'bg-muted-foreground/40')}>
      <span className={cn('absolute top-0.5 size-3 rounded-full bg-white transition-transform', on ? 'translate-x-3.5' : 'translate-x-0.5')} />
    </span>
  )
}

// ────────────────────────────────────────────────────────────────────
// Detail + legend panes
// ────────────────────────────────────────────────────────────────────

function DetailPane({
  title,
  subtitle,
  status,
  onClose,
  children
}: {
  title: string
  subtitle: string | null
  status: HealthStatus
  onClose(): void
  children: ReactNode
}) {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold truncate">{title}</div>
          {subtitle && <div className="text-xs font-mono text-muted-foreground truncate">{subtitle}</div>}
        </div>
        <StatusChip status={status}>{statusLabel(status)}</StatusChip>
        <button
          onClick={onClose}
          aria-label="Close"
          className="size-7 -mr-1 -mt-1 rounded hover:bg-accent flex items-center justify-center cursor-pointer"
        >
          <X className="size-4" />
        </button>
      </div>
      {children}
    </div>
  )
}

function statusLabel(s: HealthStatus): string {
  return { healthy: 'Healthy', warning: 'Warning', minor: 'Minor', major: 'Major', critical: 'Critical', unknown: 'Unknown' }[s]
}

function NodeDetails({
  node,
  graph,
  onDrill,
  onSelectDevice,
  onGoToRack,
  onGoToLinks
}: {
  node: SceneNode
  graph: TopologyGraph
  onDrill(): void
  onSelectDevice(id: string): void
  onGoToRack(): void
  onGoToLinks(): void
}) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const dev = node.device

  if (dev) {
    const orphan = dev.model_id === 'unknown'
    const links = graph.edges.filter((e) => e.source === dev.id || e.target === dev.id)
    return (
      <div className="space-y-3 text-sm">
        {orphan && (
          <div className="rounded border border-minor bg-minor-soft px-3 py-2 text-xs">
            Referenced by a cable link but missing from the rack layout. Re-generate or re-import
            to re-anchor it.
          </div>
        )}
        {dev.usedPorts.length === 0 && !orphan && node.status === 'warning' && (
          <div className="rounded border border-warn bg-warn-soft px-3 py-2 text-xs">
            No cable links attached while other {dev.role === 'spine' ? 'spines' : 'leaves'} are
            wired.
          </div>
        )}
        <KV label="Role" value={dev.role.toUpperCase()} />
        <KV label="Model" value={<span className="font-mono">{dev.model_id}</span>} />
        {dev.pod_index != null && dev.role !== 'leaf' && <KV label="Pod" value={`Pod ${dev.pod_index + 1}`} />}
        <KV label="Rack" value={dev.rack ?? <Dash />} />
        <KV label="RU" value={dev.ru ?? <Dash />} />
        <KV label="Links" value={links.length} />
        <div>
          <div className="text-xs text-muted-foreground mb-1">Used ports ({dev.usedPorts.length})</div>
          {dev.usedPorts.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">No cable links attached.</div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {dev.usedPorts.map((p) => (
                <span key={p} className="rounded bg-muted text-muted-foreground text-[10px] font-mono px-1.5 py-0.5">
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={onGoToRack}>Rack View</Button>
          <Button size="sm" variant="outline" onClick={onGoToLinks}>Links</Button>
        </div>
      </div>
    )
  }

  // Fabric or group tile: summarise members.
  const members = node.memberIds.map((id) => byId.get(id)).filter((n): n is TopologyNode => !!n)
  const models = new Map<string, number>()
  for (const m of members) models.set(m.model_id, (models.get(m.model_id) ?? 0) + 1)
  const memberIds = new Set(node.memberIds)
  const linkCount = graph.edges.filter((e) => memberIds.has(e.source) || memberIds.has(e.target)).length
  return (
    <div className="space-y-3 text-sm">
      {node.kind === 'fabric' && (
        <>
          <KV label="Spines" value={members.filter((m) => m.role === 'spine').length} />
          <KV label="Leaves" value={members.filter((m) => m.role === 'leaf').length} />
        </>
      )}
      {node.kind === 'group' && <KV label={node.label} value={node.count} />}
      <KV label="Cable links" value={linkCount} />
      <div>
        <div className="text-xs text-muted-foreground mb-1">Models</div>
        <div className="space-y-1">
          {[...models.entries()].map(([model, n]) => (
            <div key={model} className="flex justify-between text-xs">
              <span className="font-mono">{model}</span>
              <span className="text-muted-foreground">× {n}</span>
            </div>
          ))}
        </div>
      </div>
      <Button size="sm" onClick={onDrill}>
        {node.kind === 'fabric' ? 'Open fabric' : `Expand ${node.label.toLowerCase()}`}
      </Button>
      {node.kind === 'group' && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">Members</div>
          <div className="max-h-64 overflow-auto rounded border divide-y">
            {members.map((m) => (
              <button
                key={m.id}
                onClick={() => onSelectDevice(m.id)}
                className="w-full flex items-center justify-between px-2 py-1.5 text-xs hover:bg-accent text-left cursor-pointer"
              >
                <span className="truncate">{m.label}</span>
                <span className="text-muted-foreground font-mono">{m.usedPorts.length} ports</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EdgeDetails({
  edge,
  graph,
  onGoToLinks
}: {
  edge: SceneEdge
  graph: TopologyGraph
  onGoToLinks(): void
}) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const linkById = new Map(graph.edges.map((e) => [e.id, e]))
  const links = edge.linkIds.map((id) => linkById.get(id)).filter((l): l is TopologyEdge => !!l)
  const name = (id: string) => byId.get(id)?.label ?? id
  if (links.length === 1) {
    const l = links[0]
    return (
      <div className="space-y-3 text-sm">
        <KV label="From" value={<Endpoint label={name(l.source)} port={l.sourcePort} />} />
        <KV label="To" value={<Endpoint label={name(l.target)} port={l.targetPort} />} />
        <KV label="Speed" value={`${l.speed_g}G`} />
        <KV label="Optic" value={l.optic_id ? <span className="font-mono">{l.optic_id}</span> : <Dash />} />
        <KV label="Patch panel" value={l.patch_panel_id ? <span className="font-mono">{l.patch_panel_id}</span> : <Dash />} />
        <KV label="Length" value={l.length_m != null ? `${l.length_m} m` : <Dash />} />
        {l.label && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Label</div>
            <div className="text-xs">{l.label}</div>
          </div>
        )}
        <Button size="sm" variant="outline" onClick={onGoToLinks}>Edit in Links</Button>
      </div>
    )
  }
  const shown = links.slice(0, 40)
  return (
    <div className="space-y-3 text-sm">
      <KV label="Cables" value={edge.count} />
      <KV label="Speeds" value={edge.speeds.map((s) => `${s}G`).join(', ')} />
      <KV label="Total bandwidth" value={`${edge.totalG}G`} />
      <div>
        <div className="text-xs text-muted-foreground mb-1">Connections</div>
        <div className="max-h-72 overflow-auto rounded border divide-y">
          {shown.map((l) => (
            <div key={l.id} className="px-2 py-1.5 text-[11px] font-mono flex items-center justify-between gap-2">
              <span className="truncate">{name(l.source)}:{l.sourcePort}</span>
              <span className="text-muted-foreground">↔</span>
              <span className="truncate">{name(l.target)}:{l.targetPort}</span>
            </div>
          ))}
          {links.length > shown.length && (
            <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
              + {links.length - shown.length} more — see the Links tab
            </div>
          )}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={onGoToLinks}>Open Links</Button>
    </div>
  )
}

function Endpoint({ label, port }: { label: string; port: string }) {
  return (
    <span>
      <span className="font-medium">{label}</span>{' '}
      <span className="font-mono text-xs text-muted-foreground">: {port}</span>
    </span>
  )
}

function Dash() {
  return <span className="text-muted-foreground">—</span>
}

function KV({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

function LegendPane({ onClose }: { onClose(): void }) {
  const statuses: HealthStatus[] = ['healthy', 'warning', 'minor', 'major', 'critical', 'unknown']
  const meaning: Record<HealthStatus, string> = {
    healthy: 'Wired as designed',
    warning: 'No cable links while peers are wired',
    minor: 'Orphan — link references a missing device',
    major: 'Reserved',
    critical: 'Reserved',
    unknown: 'Insufficient information'
  }
  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-base font-semibold">Topology legend</div>
        <button onClick={onClose} aria-label="Close" className="size-7 rounded hover:bg-accent flex items-center justify-center cursor-pointer">
          <X className="size-4" />
        </button>
      </div>
      <section className="space-y-2">
        <div className="text-sm font-medium">Node health</div>
        <p className="text-xs text-muted-foreground">
          A badge is only shown on nodes that need attention.
        </p>
        <ul className="space-y-1.5 text-sm">
          {statuses.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <span className={cn('size-3.5 rounded-full', STATUS_STYLE[s].badge ?? 'bg-ok')} />
              <span className="w-16">{statusLabel(s)}</span>
              <span className="text-xs text-muted-foreground">{meaning[s]}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <div className="text-sm font-medium">Node type</div>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2"><span className="size-5 text-ok"><Globe className="size-full" strokeWidth={1.6} /></span> Fabric — double-click to open</li>
          <li className="flex items-center gap-2"><span className="size-5 text-ok"><SwitchGlyph /></span> Switch (spine or leaf)</li>
          <li className="flex items-center gap-2">
            <span className="relative size-5 text-ok">
              <span className="absolute -top-0.5 -right-0.5 size-5 rounded border border-tile-border bg-tile" />
              <span className="absolute inset-0 rounded border border-tile-border bg-tile flex items-center justify-center"><SwitchGlyph /></span>
            </span>
            Stacked group (Spines / Leaves) — double-click to expand
          </li>
          <li className="flex items-center gap-2"><span className="size-5 text-ok"><RouterGlyph /></span> IPN router (Multi-Pod)</li>
        </ul>
      </section>
      <section className="space-y-2">
        <div className="text-sm font-medium">Links</div>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2"><span className="w-8 border-t-2 border-link" /> One cable</li>
          <li className="flex items-center gap-2"><span className="w-8 border-t-4 border-link" /> Aggregated cables (label shows count × speed)</li>
        </ul>
      </section>
      <section className="space-y-1 text-xs text-muted-foreground">
        <div><kbd className="rounded border bg-muted px-1 font-mono">Esc</kbd> closes panes, then folds up one level.</div>
        <div>Double-click empty canvas to fold up one level.</div>
        <div>Filter grammar: <code className="font-mono">model=…</code>, <code className="font-mono">rack contains …</code>, <code className="font-mono">role!=spine</code>, or free text (name).</div>
      </section>
    </div>
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
