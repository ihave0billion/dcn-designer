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
  Cloud,
  Globe,
  Info,
  Loader2,
  Magnet,
  Maximize2,
  Minus,
  Plus,
  Server as ServerIcon,
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
  loadLeafPairs,
  loadServersFile,
  loadSwitchesFile,
  loadTopologyLayout,
  saveTopologyLayout,
  deleteTopologyLayout,
  type CableLinksFile
} from '@/lib/library-io'
import type { Server } from '@/schemas/servers'
import type { LeafPair } from '@/schemas/leaf-pairs'
import { serverInfoResolver } from '@/lib/server-symbols'
import { bundleGeometry, bundlePath, peerLinkEndpoints, type BundleGeometry } from '@/lib/port-channel-symbol'
import {
  TOPOLOGY_LAYOUT_GENERATOR,
  type TopologyLayoutFile,
  type TopologyScenePosition
} from '@/schemas/topology-layout'
import type { DesignResult } from '@domain'
import {
  extractTopology,
  type TopologyGraph,
  type TopologyNode,
  type TopologyEdge
} from '@/lib/topology-extractor'
import { applyNicknames } from '@/lib/device-nickname'
import {
  buildFabrics,
  buildScene,
  drillInto,
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
  type SceneNode,
  type ScenePair
} from '@/lib/topology-hierarchy'
import { cn } from '@/lib/utils'
import { resolveScenePositions, sceneKeyFor } from '@/lib/topology-scene-positions'

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

// Phase 14 — a vPC pair without a peer-link is joined by a bracket drawn
// as a non-interactive node behind its two tiles.
interface BracketData extends Record<string, unknown> {
  pair: ScenePair
  w: number
  h: number
}
type BracketNode = RFNode<BracketData, 'bracket'>
type CanvasNode = TileNode | BracketNode

/** Sideways distance between the member lines of a peer-link bundle. */
const PEER_LINK_GAP = 5

/** The skill's peer-link red, shared with the PDF and Visio exports. */
const PEER_LINK_COLOR = '#B85450'
// Phase 17 — Nexus Dashboard cluster bracket (teal, the ND data-link accent).
const ND_COLOR = '#2BB5C4'
const BRACKET_PAD = 5

const FIT = { padding: 0.12, duration: 300, maxZoom: 1.25 }

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
  const { currentProjectPath, workspacePath } = useWorkspace()
  const [design, setDesign] = useState<DesignResult | null>(null)
  const [cableLinks, setCableLinks] = useState<CableLinksFile | null>(null)
  const [layoutFile, setLayoutFile] = useState<TopologyLayoutFile | null>(null)
  const [smartModels, setSmartModels] = useState<Set<string>>(() => new Set())
  // Phase 14 — vPC pairs (fork file) + the server library for the symbols.
  const [leafPairs, setLeafPairs] = useState<LeafPair[] | null>(null)
  const [servers, setServers] = useState<Server[]>([])
  const [showServers, setShowServers] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // View state
  const [level, setLevel] = useState<SceneLevel>({ kind: 'fabrics' })
  const [aggregate, setAggregate] = useState(true)
  const [orientation, setOrientation] = useState<Orientation>('vertical')
  const [filterText, setFilterText] = useState('')
  const [legendOpen, setLegendOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([])
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
        const [designRaw, links, layout, switches, pairsFile, serversFile] = await Promise.all([
          window.dcn
            .fileExists(`${projectPath}/design.yaml`)
            .then((exists) =>
              exists
                ? (window.dcn.readYaml(`${projectPath}/design.yaml`) as Promise<DesignResult>)
                : null
            ),
          loadCableLinks(projectPath),
          loadTopologyLayout(projectPath),
          // The library tells us which models are smart switches (DPU badge +
          // "smart-sw" nickname). Missing library = fall back to the SE1U pattern.
          workspacePath ? loadSwitchesFile(workspacePath).catch(() => null) : Promise.resolve(null),
          loadLeafPairs(projectPath).catch(() => null),
          workspacePath ? loadServersFile(workspacePath).catch(() => null) : Promise.resolve(null)
        ])
        if (cancelled) return
        setDesign(designRaw)
        setCableLinks(links)
        setLayoutFile(layout)
        setLeafPairs(pairsFile?.pairs ?? null)
        setServers(serversFile?.servers ?? [])
        setShowServers(layout?.show_servers ?? false)
        setSmartModels(
          new Set(
            (switches?.switches ?? [])
              .filter((s) => s.capabilities.smart_switch || s.capabilities.dpu_integrated)
              .map((s) => s.id)
          )
        )
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [currentProjectPath, projectPath, workspacePath])

  const graph: TopologyGraph = useMemo(() => {
    if (!design) return { nodes: [], edges: [], orphanDeviceIds: [] }
    return applyNicknames(extractTopology(design, cableLinks?.links ?? [], leafPairs), smartModels)
  }, [design, cableLinks, smartModels, leafPairs])

  const serverInfo = useMemo(() => serverInfoResolver(design, servers), [design, servers])

  const fabrics = useMemo(() => buildFabrics(graph, fabricName), [graph, fabricName])

  // If the level points at a fabric that no longer exists (design regen), pop up.
  useEffect(() => {
    if (level.kind !== 'fabrics' && !fabrics.some((f) => f.id === level.fabricId)) {
      setLevel({ kind: 'fabrics' })
    }
  }, [fabrics, level])

  const scene: Scene = useMemo(
    () => buildScene(graph, fabrics, level, { aggregate, showServers, serverInfo }),
    [graph, fabrics, level, aggregate, showServers, serverInfo]
  )

  const filterClauses = useMemo(() => parseFilter(filterText), [filterText])

  // Every level is freely draggable; positions are stored per scene
  // (level × orientation) so the fabric globe, the stacks and the
  // switches are independent objects. Files from another generator are
  // parsed but not applied.
  const sceneKey = sceneKeyFor(level, orientation)
  const { positions, custom: sceneIsCustom } = useMemo(
    () => resolveScenePositions(scene, layoutFile, orientation),
    [scene, layoutFile, orientation]
  )

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
    const rfNodes: CanvasNode[] = scene.nodes.map((n) => ({
      id: n.id,
      type: 'tile' as const,
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: { scene: n, dimmed: isDimmed(n) },
      draggable: true,
      sourcePosition: vertical ? Position.Bottom : Position.Right,
      targetPosition: vertical ? Position.Top : Position.Left,
      width: TILE_W,
      height: TILE_H
    }))
    // Phase 14 — brackets around pairs that have no peer-link (ACI / off).
    for (const p of scene.pairs) {
      if (!p.bracket) continue
      const pts = p.memberIds.map((id) => positions.get(id)).filter((q): q is NonNullable<typeof q> => !!q)
      if (pts.length < 2) continue
      const x0 = Math.min(...pts.map((q) => q.x)) - BRACKET_PAD
      const y0 = Math.min(...pts.map((q) => q.y)) - BRACKET_PAD
      const w = Math.max(...pts.map((q) => q.x)) + TILE_W + BRACKET_PAD - x0
      const h = Math.max(...pts.map((q) => q.y)) + TILE_H + BRACKET_PAD - y0
      rfNodes.unshift({
        id: `bracket:${p.id}`,
        type: 'bracket' as const,
        position: { x: x0, y: y0 },
        data: { pair: p, w, h },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: -1,
        width: w,
        height: h
      })
    }

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
  }, [scene, positions, orientation, filterClauses, graph.nodes, setNodes, setEdges])

  // Frame the graph whenever the level or orientation changes — once the
  // new tiles have been measured, otherwise fitView sees an empty bounds.
  useEffect(() => {
    if (!nodesInitialized) return
    const t = window.setTimeout(() => fitView(FIT), 20)
    return () => window.clearTimeout(t)
  }, [sceneKey, nodesInitialized, fitView])

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
    (_e: React.MouseEvent, n: CanvasNode) => {
      if (n.type !== 'tile') return
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
  const onNodeClick = useCallback((_e: React.MouseEvent, n: CanvasNode) => {
    if (n.type !== 'tile') return
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

  // ── Layout persistence ──────────────────────────────────────────────
  const nodesRef = useRef(nodes)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  // Phase 14 — the file also carries the "Show servers" checkbox so the
  // exports draw what the screen shows; it is only deleted when nothing
  // (no positions, servers off) is left to remember.
  const writeLayout = useCallback(
    async (scenePositions: TopologyScenePosition[], serversOn: boolean = showServers) => {
      try {
        if (scenePositions.length === 0 && !serversOn) {
          await deleteTopologyLayout(projectPath)
          setLayoutFile(null)
          return
        }
        const now = new Date().toISOString()
        const next: TopologyLayoutFile = {
          schema_version: 1,
          source: scenePositions.length > 0 ? 'user' : 'auto',
          seeded_at: layoutFile?.seeded_at ?? now,
          forked_at: scenePositions.length > 0 ? (layoutFile?.forked_at ?? now) : null,
          positions: [],
          scene_positions: scenePositions,
          generator: TOPOLOGY_LAYOUT_GENERATOR,
          show_servers: serversOn
        }
        await saveTopologyLayout(projectPath, next)
        setLayoutFile(next)
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    },
    [layoutFile, projectPath, showServers]
  )

  const savedPositions = useCallback(
    (): TopologyScenePosition[] =>
      layoutFile?.generator === TOPOLOGY_LAYOUT_GENERATOR ? layoutFile.scene_positions : [],
    [layoutFile]
  )

  const toggleShowServers = useCallback(
    (on: boolean) => {
      setShowServers(on)
      void writeLayout(savedPositions(), on)
    },
    [writeLayout, savedPositions]
  )

  // Entries for other scenes survive; this scene is rewritten from the
  // live node positions.
  const persistScene = useCallback(() => {
    const others =
      layoutFile?.generator === TOPOLOGY_LAYOUT_GENERATOR
        ? layoutFile.scene_positions.filter((p) => p.scene !== sceneKey)
        : []
    const mine: TopologyScenePosition[] = nodesRef.current
      .filter((n) => n.type === 'tile')
      .map((n) => ({
        scene: sceneKey,
        node_id: n.id,
        x: n.position.x,
        y: n.position.y
      }))
    void writeLayout([...others, ...mine])
  }, [layoutFile, sceneKey, writeLayout])

  const onNodeDragStop: OnNodeDrag<CanvasNode> = useCallback(() => {
    persistScene()
  }, [persistScene])

  // Snap the current level back to the automatic tiered layout.
  const snapScene = useCallback(() => {
    const others =
      layoutFile?.generator === TOPOLOGY_LAYOUT_GENERATOR
        ? layoutFile.scene_positions.filter((p) => p.scene !== sceneKey)
        : []
    void writeLayout(others)
    window.setTimeout(() => fitView(FIT), 60)
  }, [layoutFile, sceneKey, writeLayout, fitView])

  const handleResetAll = useCallback(async () => {
    setResetConfirmOpen(false)
    await writeLayout([])
    window.setTimeout(() => fitView(FIT), 60)
  }, [writeLayout, fitView])

  const nodeTypes: NodeTypes = useMemo(() => ({ tile: TileRenderer, bracket: BracketRenderer }), [])
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
  const pairCount = graph.pairs?.length ?? 0
  const peerLinkCount = graph.edges.filter((e) => e.kind === 'vpc-peer-link').length
  const anyCustom =
    layoutFile?.generator === TOPOLOGY_LAYOUT_GENERATOR && layoutFile.scene_positions.length > 0
  const legacyLayout = !!layoutFile && layoutFile.generator !== TOPOLOGY_LAYOUT_GENERATOR
  const canGoUp = parentLevel(level) !== null
  const detailOpen = !!(selectedNode || selectedEdge)

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Breadcrumb row */}
      <div className="px-6 pt-3 pb-2 flex items-center gap-2 flex-wrap">
        <nav className="flex items-center gap-1 text-sm uppercase tracking-wider font-semibold">
          {scene.breadcrumb.map((c, i) => {
            const last = i === scene.breadcrumb.length - 1
            return (
              <span key={c.label + i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground" />}
                {last ? (
                  <span className="text-primary">{c.label}</span>
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
        <span className="text-xs text-muted-foreground ml-2 font-mono">
          {spineCount} spine{spineCount === 1 ? '' : 's'} · {leafCount} lea
          {leafCount === 1 ? 'f' : 'ves'} · {graph.edges.length} link
          {graph.edges.length === 1 ? '' : 's'}
          {pairCount > 0 && ` · ${pairCount} vPC pair${pairCount === 1 ? '' : 's'}`}
          {peerLinkCount > 0 && ` (${peerLinkCount} peer-link cable${peerLinkCount === 1 ? '' : 's'})`}
        </span>
        {graph.orphanDeviceIds.length > 0 && (
          <StatusChip status="minor">
            {graph.orphanDeviceIds.length} orphan{graph.orphanDeviceIds.length === 1 ? '' : 's'}
          </StatusChip>
        )}
        {sceneIsCustom && (
          <StatusChip status="unknown">
            Custom layout · this level
            <button
              className="ml-2 underline underline-offset-2 hover:text-foreground cursor-pointer"
              onClick={snapScene}
            >
              snap back
            </button>
          </StatusChip>
        )}
        {legacyLayout && <StatusChip status="unknown">Old layout file ignored</StatusChip>}
        <div className="flex-1" />
        <div className="inline-flex border text-[11px] uppercase tracking-wider font-semibold overflow-hidden chamfer-xs">
          <span className="px-2.5 py-1 bg-primary text-primary-foreground">Design status</span>
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
          placeholder="Filter by attributes — e.g. model=N9K-C93, rack contains R1, smart-sw"
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
              showServers={showServers}
              onShowServers={toggleShowServers}
              sceneIsCustom={sceneIsCustom}
              onSnapScene={snapScene}
              anyCustom={anyCustom || legacyLayout}
              onResetAll={() => setResetConfirmOpen(true)}
              onExpandAll={() => {
                const f = level.kind === 'fabrics' ? fabrics[0] : fabrics.find((x) => x.id === level.fabricId)
                if (f) goTo({ kind: 'devices', fabricId: f.id })
              }}
              onCollapse={() => goTo({ kind: 'fabrics' })}
              onFit={() => fitView(FIT)}
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
        <ReactFlow<CanvasNode, FanEdge>
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

        {/* Control stack */}
        <div className="absolute bottom-4 right-4 flex flex-col border bg-card chamfer-xs overflow-hidden">
          <CtrlButton title="Up one level (Esc)" onClick={goUp} disabled={!canGoUp}>
            <ChevronUp />
          </CtrlButton>
          <CtrlButton title="Zoom in" onClick={() => zoomIn({ duration: 150 })}>
            <Plus />
          </CtrlButton>
          <CtrlButton title="Zoom out" onClick={() => zoomOut({ duration: 150 })}>
            <Minus />
          </CtrlButton>
          <CtrlButton title="Fit view" onClick={() => fitView(FIT)}>
            <Maximize2 />
          </CtrlButton>
          <CtrlButton
            title={sceneIsCustom ? 'Snap this level back to the default layout' : 'Layout is at default — drag any tile to customise'}
            active={sceneIsCustom}
            disabled={!sceneIsCustom}
            onClick={snapScene}
          >
            <Magnet />
          </CtrlButton>
          <CtrlButton title="Legend" active={legendOpen} onClick={() => setLegendOpen((v) => !v)}>
            <Info />
          </CtrlButton>
        </div>

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
            <AlertDialogTitle>Reset every level to default?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes <code className="font-mono">topology_layout.yaml</code>. Tiles on all
              levels and both orientations go back to the automatic tiered layout.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetAll}>Reset all</AlertDialogAction>
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

const STATUS_STYLE: Record<
  HealthStatus,
  { pill: string; badge: string | null; glyph: string; dot: string }
> = {
  healthy: { pill: 'bg-ok-soft text-ok', badge: null, glyph: '', dot: 'bg-ok' },
  warning: { pill: 'bg-warn-soft text-warn', badge: 'bg-warn', glyph: '–', dot: 'bg-warn' },
  minor: { pill: 'bg-minor-soft text-minor', badge: 'bg-minor', glyph: '!', dot: 'bg-minor' },
  major: { pill: 'bg-major-soft text-major', badge: 'bg-major', glyph: '!', dot: 'bg-major' },
  critical: { pill: 'bg-crit-soft text-crit', badge: 'bg-crit', glyph: '×', dot: 'bg-crit' },
  unknown: { pill: 'bg-unknown-soft text-unknown', badge: 'bg-unknown', glyph: '?', dot: 'bg-unknown' }
}

function TileRenderer({ data, selected, sourcePosition, targetPosition }: NodeProps<TileNode>) {
  const n = data.scene
  const s = STATUS_STYLE[n.status]
  const stacked = n.kind === 'group'
  const drillable = n.kind === 'fabric' || n.kind === 'group'
  const smart = !!n.device?.smart
  const server = n.kind === 'server'
  const cloud = n.kind === 'cloud'
  // In the vertical layout spines/IPNs fan their links downward, straight
  // through a label placed under the tile — so their label sits on top.
  const vertical = sourcePosition === Position.Bottom || sourcePosition === undefined
  const labelAbove = vertical && (n.role === 'spine' || n.role === 'ipn')
  const label = (
    <div
      className={cn(
        'max-w-full truncate px-1.5 py-0.5 text-[11px] font-semibold leading-tight font-mono tracking-tight',
        labelAbove ? 'mb-2' : 'mt-2',
        s.pill
      )}
    >
      {n.label}
      {(server || cloud) && n.sublabel && (
        <span className="block text-[9px] font-normal opacity-80 tracking-normal">{n.sublabel}</span>
      )}
    </div>
  )
  return (
    <div
      className={cn(
        'flex flex-col items-center select-none transition-opacity',
        labelAbove ? 'justify-end' : 'justify-start',
        data.dimmed && 'opacity-25'
      )}
      style={{ width: TILE_W, height: TILE_H }}
      title={drillable ? 'Double-click to open · drag to move' : server ? 'Server symbol (per leaf or per vPC pair) · drag to move' : cloud ? 'OOB management network outside this design · drag to move' : 'Drag to move'}
    >
      {labelAbove && label}
      <div className="relative">
        {stacked && (
          <>
            <div className="absolute -top-2 -right-2 size-14 chamfer-xs border border-tile-border/60 bg-tile" />
            <div className="absolute -top-1 -right-1 size-14 chamfer-xs border border-tile-border/80 bg-tile" />
          </>
        )}
        <div
          className={cn(
            'relative size-14 chamfer-xs border bg-tile border-tile-border flex items-center justify-center',
            selected && 'border-hot shadow-[0_0_0_2px_var(--color-hot)]',
            n.kind === 'device' && n.device?.model_id === 'unknown' && 'border-dashed',
            server && 'border-tile-border/60 bg-tile/60',
            cloud && 'border-dashed border-tile-border/70 bg-tile/40 rounded-full'
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
          <span className={cn('size-8 text-tile-icon', smart && 'opacity-55')}>
            <TileIcon kind={n.kind} role={n.role} />
          </span>
          {smart && (
            <span className="absolute inset-x-1.5 top-1/2 -translate-y-1/2 h-4 bg-primary text-primary-foreground text-[9px] font-bold tracking-[0.18em] flex items-center justify-center chamfer-xs">
              DPU
            </span>
          )}
        </div>
        {/* Badges live outside the clipped tile so the chamfer doesn't cut them. */}
        {s.badge && (
          <span
            className={cn(
              'absolute -top-2 -right-2 size-4 text-[10px] font-bold text-black flex items-center justify-center ring-2 ring-tile z-10',
              s.badge
            )}
          >
            {s.glyph}
          </span>
        )}
        {stacked && (
          <span className="absolute -bottom-2 -right-2 min-w-5 h-5 px-1 bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center chamfer-xs z-10">
            {n.count}
          </span>
        )}
      </div>
      {!labelAbove && label}
    </div>
  )
}

function TileIcon({ kind, role }: { kind: SceneNode['kind']; role: SceneNode['role'] }) {
  if (kind === 'fabric') return <Globe className="size-full" strokeWidth={1.6} />
  if (kind === 'server') return <ServerIcon className="size-full" strokeWidth={1.6} />
  if (kind === 'cloud' || role === 'oob') return <Cloud className="size-full" strokeWidth={1.6} />
  if (role === 'nd') return <NdGlyph />
  if (kind === 'ipn' || role === 'ipn') return <RouterGlyph />
  if (role === 'spine') return <SpineGlyph />
  return <LeafGlyph />
}

// Phase 14 — dashed bracket behind a vPC pair that has no peer-link.
function BracketRenderer({ data }: NodeProps<BracketNode>) {
  // Phase 17 — the Nexus Dashboard cluster bracket is teal and labelled with the cluster PID.
  const color = data.pair.kind === 'nd' ? ND_COLOR : PEER_LINK_COLOR
  return (
    <div
      className="relative pointer-events-none"
      style={{ width: data.w, height: data.h, border: `1.5px dashed ${color}`, opacity: 0.8 }}
      aria-hidden="true"
    >
      <span
        className="absolute -top-2.5 left-2 px-1 text-[9px] font-bold uppercase tracking-[0.18em] bg-background"
        style={{ color }}
      >
        {data.pair.label}
      </span>
    </div>
  )
}

// Phase 17 — Nexus Dashboard node: a dashboard of four tiles with a gauge needle.
function NdGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7.5" height="7.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" />
      <path d="M15.5 19l3-3" strokeWidth="1.5" />
    </svg>
  )
}

// Spine: a backbone bar fanning three links down to the leaf tier.
function SpineGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="6" />
      <path d="M12 10v10" />
      <path d="M12 10L5 20" />
      <path d="M12 10l7 10" />
      <path d="M7 7h2M11 7h2M15 7h2" strokeWidth="1.5" />
    </svg>
  )
}

// Leaf: ND's switch glyph — two horizontal arrows with crossing shafts.
function LeafGlyph() {
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
// Edges — bezier, fanned when several cables share a pair; peer-links are
// straight port-channel bundles (Phase 15); server NIC lines are straight.
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
  const kind = data?.scene.kind ?? 'fabric'
  const horizontal = sourcePosition === Position.Right || sourcePosition === Position.Left
  const off = (index - (siblings - 1) / 2) * 12

  let path: string
  let lx: number
  let ly: number
  // Phase 15 — the peer-link is the port-channel symbol and nothing else: the
  // member cables as straight parallel lines between the facing sides of the
  // two leaf tiles and the Cisco oval across their middle. No text box — the
  // oval implies the peer-link (the inspector has the count and ports).
  // Aggregated, one edge carries `count` cables; per-cable, each sibling edge
  // draws one line and the first also draws the oval sized for all of them.
  let ring: BundleGeometry | null = null
  if (kind === 'vpc-peer-link') {
    const [a, b] = peerLinkEndpoints({ sourceX, sourceY, targetX, targetY }, horizontal, 56)
    const g = bundleGeometry(a, b, count, {
      gap: PEER_LINK_GAP,
      offset: (index - (siblings - 1) / 2) * PEER_LINK_GAP,
      ringLines: count * siblings,
      ringRx: 6,
      ringPad: 9
    })
    path = bundlePath(g)
    if (index === 0) ring = g
    lx = g.mid.x
    ly = g.mid.y
  } else if (kind === 'server' || kind === 'nd-data' || kind === 'nd-mgmt') {
    // Phase 15 — one straight line per NIC, landing on its own spot along the
    // server tile's edge so a dual-attached symbol reads as a clear V (both
    // curves used to land on the same handle and looked like one line at
    // fit-view zoom). Dual: the leaf on the left lands left, the leaf on the
    // right lands right; single-attached NICs fan across the edge.
    const spread = siblings > 1 ? (index - (siblings - 1) / 2) * 8 : Math.max(-14, Math.min(14, horizontal ? sourceY - targetY : sourceX - targetX))
    const tx = horizontal ? targetX : targetX + spread
    const ty = horizontal ? targetY + spread : targetY
    path = `M ${sourceX} ${sourceY} L ${tx} ${ty}`
    lx = (sourceX + tx) / 2
    ly = (sourceY + ty) / 2
  } else if (siblings <= 1) {
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
  const width = kind === 'server' || kind === 'nd-mgmt' ? 1 : kind === 'nd-data' ? 1.5 : kind === 'vpc-peer-link' ? 2 : Math.min(1.5 + (count - 1) * 0.35, 6)
  // Peer-links never carry a label box (decision: the oval says it all).
  const showLabel = kind !== 'vpc-peer-link' && (selected || (data?.showLabel ?? false))
  // Phase 17 — ND data links share the fabric-link colour; management links are dashed and muted.
  const stroke = selected
    ? 'var(--hot)'
    : kind === 'vpc-peer-link'
      ? PEER_LINK_COLOR
      : kind === 'server' || kind === 'nd-mgmt'
        ? 'var(--muted-foreground)'
        : 'var(--link)'
  const labelTransform = `translate(-50%, -50%) translate(${lx}px, ${ly}px)`
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={14}
        style={{
          strokeWidth: selected ? width + 1 : width,
          stroke,
          strokeDasharray: kind === 'nd-mgmt' ? '5 4' : undefined,
          opacity: selected ? 1 : kind === 'server' || kind === 'nd-mgmt' ? 0.6 : 0.85
        }}
      />
      {ring && (
        <ellipse
          cx={ring.mid.x}
          cy={ring.mid.y}
          rx={ring.rx}
          ry={ring.ry}
          transform={`rotate(${ring.angleDeg} ${ring.mid.x} ${ring.mid.y})`}
          fill="none"
          stroke={stroke}
          strokeWidth={selected ? 2.5 : 1.75}
          style={{ opacity: selected ? 1 : 0.9 }}
          pointerEvents="none"
        />
      )}
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            className={cn(
              'absolute pointer-events-none border border-link/50 bg-card px-1.5 py-0.5 text-[10px] font-mono font-semibold text-link chamfer-xs nodrag nopan'
            )}
            style={{ transform: labelTransform }}
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
    <span
      className={cn(
        'px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider chamfer-xs',
        STATUS_STYLE[status].pill
      )}
    >
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
  showServers,
  onShowServers,
  sceneIsCustom,
  onSnapScene,
  anyCustom,
  onResetAll,
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
  showServers: boolean
  onShowServers(v: boolean): void
  sceneIsCustom: boolean
  onSnapScene(): void
  anyCustom: boolean
  onResetAll(): void
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

  const row =
    'w-full flex items-center justify-between gap-4 px-3 py-2 text-sm text-left hover:bg-accent cursor-pointer disabled:opacity-40 disabled:cursor-default'
  const heading = 'px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.18em] text-primary font-bold'
  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 w-64 border bg-popover text-popover-foreground shadow-lg z-20 py-1 chamfer"
    >
      <div className={heading}>Layout</div>
      <button className={row} onClick={() => onOrientation('vertical')}>
        <span>Vertical (default)</span>
        <Radio on={orientation === 'vertical'} />
      </button>
      <button className={row} onClick={() => onOrientation('horizontal')}>
        <span>Horizontal</span>
        <Radio on={orientation === 'horizontal'} />
      </button>
      <button className={row} onClick={() => onAggregate(!aggregate)}>
        <span>Aggregate links</span>
        <Switch on={aggregate} />
      </button>
      <button className={row} onClick={() => onShowServers(!showServers)} title="One symbol per leaf or per vPC pair, at the switch level; saved for the PDF and Visio exports">
        <span>Show servers</span>
        <Switch on={showServers} />
      </button>
      <div className="my-1 border-t" />
      <div className={heading}>Positions</div>
      <button className={row} disabled={!sceneIsCustom} onClick={() => { onSnapScene(); onClose() }}>
        Snap this level to default
      </button>
      <button className={cn(row, 'text-destructive')} disabled={!anyCustom} onClick={() => { onResetAll(); onClose() }}>
        Reset all levels…
      </button>
      <div className="my-1 border-t" />
      <div className={heading}>View</div>
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
    <span className={cn('relative inline-block h-4 w-7 transition-colors chamfer-xs', on ? 'bg-primary' : 'bg-muted-foreground/40')}>
      <span className={cn('absolute top-0.5 size-3 bg-background transition-transform', on ? 'translate-x-3.5' : 'translate-x-0.5')} />
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
          <div className="text-base font-bold uppercase tracking-wider truncate">{title}</div>
          {subtitle && <div className="text-xs font-mono text-muted-foreground truncate">{subtitle}</div>}
        </div>
        <StatusChip status={status}>{statusLabel(status)}</StatusChip>
        <button
          onClick={onClose}
          aria-label="Close"
          className="size-7 -mr-1 -mt-1 hover:bg-accent flex items-center justify-center cursor-pointer"
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
          <div className="border border-minor bg-minor-soft px-3 py-2 text-xs">
            Referenced by a cable link but missing from the rack layout. Re-generate or re-import
            to re-anchor it.
          </div>
        )}
        {dev.usedPorts.length === 0 && !orphan && node.status === 'warning' && (
          <div className="border border-warn bg-warn-soft px-3 py-2 text-xs">
            No cable links attached while other {dev.role === 'spine' ? 'spines' : 'leaves'} are
            wired.
          </div>
        )}
        <KV
          label="Hostname"
          value={
            <span>
              <span className="font-mono">{dev.label}</span>{' '}
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {dev.hostname_source === 'user' ? 'set in Rack View' : 'auto nickname'}
              </span>
            </span>
          }
        />
        <KV label="Role" value={dev.role === 'nd' ? 'NEXUS DASHBOARD NODE' : dev.role.toUpperCase()} />
        <KV label="Model" value={<span className="font-mono">{dev.model_id}</span>} />
        {dev.role === 'nd' && graph.nexusDashboard && (
          <KV
            label="Cluster"
            value={
              <span>
                <span className="font-mono">{graph.nexusDashboard.cluster_model_id}</span>{' '}
                <span className="text-xs text-muted-foreground">
                  {graph.nexusDashboard.node_count} node{graph.nexusDashboard.node_count === 1 ? '' : 's'} · data {graph.nexusDashboard.data_speed_g}G · mgmt {graph.nexusDashboard.mgmt_speed_g}G
                  {graph.nexusDashboard.mgmt_leaf_ids ? ' → OOB tier' : ' → OOB cloud'}
                </span>
              </span>
            }
          />
        )}
        {dev.smart && <KV label="Smart switch" value="Yes — integrated DPU" />}
        {dev.role === 'leaf' && (
          <KV
            label="vPC pair"
            value={
              dev.pair_id ? (
                <span>
                  <span className="font-mono">{dev.pair_id}</span>{' '}
                  <span className="text-xs text-muted-foreground">
                    with <span className="font-mono">{dev.pair_peer ? (byId.get(dev.pair_peer)?.label ?? dev.pair_peer) : '?'}</span>
                  </span>
                </span>
              ) : (
                <span className="text-warn">unpaired</span>
              )
            }
          />
        )}
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
                <span key={p} className="bg-muted text-muted-foreground text-[10px] font-mono px-1.5 py-0.5">
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

  // Phase 17 — the OOB-management cloud: outside the design.
  if (node.kind === 'cloud') {
    const mgmtLinks = graph.edges.filter((e) => e.kind === 'nd-mgmt' && (e.source === node.id || e.target === node.id))
    return (
      <div className="space-y-3 text-sm">
        <div className="border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          The Nexus Dashboard management ports (mgmt0 / mgmt1) go to an out-of-band network that is
          not part of this design. Tick <strong>OOB mgmt</strong> on a tier in Requirements to land
          them on that tier's switches instead.
        </div>
        <KV label="Management cables" value={mgmtLinks.length} />
        <KV label="Speed" value={mgmtLinks[0] ? `${mgmtLinks[0].speed_g}G` : <Dash />} />
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={onGoToLinks}>Links</Button>
        </div>
      </div>
    )
  }

  // Phase 14 — server symbol: which leaves it hangs from and what it stands for.
  if (node.kind === 'server' && node.server) {
    const leaves = node.server.leafIds.map((id) => byId.get(id)?.label ?? id)
    return (
      <div className="space-y-3 text-sm">
        <div className="border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          One symbol stands for every host behind {node.server.dual ? 'this vPC pair' : 'this leaf'} — never one tile per server.
        </div>
        <KV label="Attachment" value={node.server.dual ? 'Dual-attached (vPC)' : 'Single-attached'} />
        <KV label="Server model" value={node.server.modelId ? <span className="font-mono">{node.server.modelId}</span> : 'Generic (set it on the tier in Requirements)'} />
        <KV label="NIC" value={node.sublabel ?? <Dash />} />
        <KV label="Leaves" value={leaves.map((l) => <span key={l} className="font-mono block">{l}</span>)} />
        <div className="flex flex-wrap gap-2 pt-1">
          {node.server.leafIds.map((id) => (
            <Button key={id} size="sm" variant="outline" onClick={() => onSelectDevice(id)}>
              {byId.get(id)?.label ?? id}
            </Button>
          ))}
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
          <div className="max-h-64 overflow-auto border divide-y">
            {members.map((m) => (
              <button
                key={m.id}
                onClick={() => onSelectDevice(m.id)}
                className="w-full flex items-center justify-between px-2 py-1.5 text-xs hover:bg-accent text-left cursor-pointer"
              >
                <span className="truncate font-mono">{m.label}</span>
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
        <div className="max-h-72 overflow-auto border divide-y">
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
      <span className="font-mono">{label}</span>{' '}
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
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
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
  const glyph = 'size-5 text-tile-icon'
  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-base font-bold uppercase tracking-wider">Topology legend</div>
        <button onClick={onClose} aria-label="Close" className="size-7 hover:bg-accent flex items-center justify-center cursor-pointer">
          <X className="size-4" />
        </button>
      </div>
      <section className="space-y-2">
        <div className="text-sm font-semibold uppercase tracking-wider text-primary">Node health</div>
        <p className="text-xs text-muted-foreground">A badge is only shown on nodes that need attention.</p>
        <ul className="space-y-1.5 text-sm">
          {statuses.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <span className={cn('size-3.5', STATUS_STYLE[s].dot)} />
              <span className="w-16">{statusLabel(s)}</span>
              <span className="text-xs text-muted-foreground">{meaning[s]}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <div className="text-sm font-semibold uppercase tracking-wider text-primary">Node type</div>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2"><span className={glyph}><Globe className="size-full" strokeWidth={1.6} /></span> Fabric — double-click to open</li>
          <li className="flex items-center gap-2"><span className={glyph}><SpineGlyph /></span> Spine switch</li>
          <li className="flex items-center gap-2"><span className={glyph}><LeafGlyph /></span> Leaf switch</li>
          <li className="flex items-center gap-2">
            <span className="relative size-5 text-tile-icon">
              <span className="absolute inset-0 opacity-55"><LeafGlyph /></span>
              <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 bg-primary text-primary-foreground text-[5px] font-bold flex items-center justify-center">DPU</span>
            </span>
            Smart switch (integrated DPU)
          </li>
          <li className="flex items-center gap-2">
            <span className="relative size-5 text-tile-icon">
              <span className="absolute -top-0.5 -right-0.5 size-5 border border-tile-border bg-tile" />
              <span className="absolute inset-0 border border-tile-border bg-tile flex items-center justify-center"><LeafGlyph /></span>
            </span>
            Stacked group (Spines / Leaves) — double-click to expand
          </li>
          <li className="flex items-center gap-2"><span className={glyph}><RouterGlyph /></span> IPN router (Multi-Pod)</li>
          <li className="flex items-center gap-2"><span className={glyph}><ServerIcon className="size-full" strokeWidth={1.6} /></span> Servers — one symbol per leaf or per vPC pair (Actions → Show servers)</li>
          <li className="flex items-center gap-2"><span className={glyph}><NdGlyph /></span> Nexus Dashboard node (Requirements → Nexus Dashboard); teal bracket = the cluster PID</li>
          <li className="flex items-center gap-2"><span className={glyph}><Cloud className="size-full" strokeWidth={1.6} /></span> OOB management network outside the design (no tier ticked "OOB mgmt")</li>
          <li className="flex items-center gap-2">
            <span className="w-5 h-3.5 shrink-0" style={{ border: `1.5px dashed ${PEER_LINK_COLOR}` }} />
            vPC pair without a peer-link (ACI, or peer-link off)
          </li>
        </ul>
      </section>
      <section className="space-y-2">
        <div className="text-sm font-semibold uppercase tracking-wider text-primary">Links</div>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2"><span className="w-8 border-t-2 border-link" /> One cable</li>
          <li className="flex items-center gap-2"><span className="w-8 border-t-4 border-link" /> Aggregated cables (label shows count × speed)</li>
          <li className="flex items-center gap-2">
            <svg width="32" height="14" viewBox="0 0 32 14" aria-hidden="true">
              <path d="M 0 4.5 L 32 4.5 M 0 9.5 L 32 9.5" stroke={PEER_LINK_COLOR} strokeWidth="1.75" fill="none" />
              <ellipse cx="16" cy="7" rx="3.5" ry="6.5" stroke={PEER_LINK_COLOR} strokeWidth="1.25" fill="none" />
            </svg>
            vPC peer-link — port-channel oval across the member cables (leaf ↔ leaf), no label
          </li>
          <li className="flex items-center gap-2"><span className="w-8 border-t border-muted-foreground" /> Server NIC (one line per NIC)</li>
          <li className="flex items-center gap-2"><span className="w-8 border-t-2 border-link" /> Nexus Dashboard data (fabric0 / fabric1, active-standby, one to each leaf of the pair)</li>
          <li className="flex items-center gap-2"><span className="w-8 border-t border-dashed border-muted-foreground" /> Nexus Dashboard management (mgmt0 / mgmt1) to the OOB tier or the cloud</li>
          <li className="flex items-center gap-2"><span className="w-8 border-t-2 border-hot" /> Selected</li>
        </ul>
      </section>
      <section className="space-y-2">
        <div className="text-sm font-semibold uppercase tracking-wider text-primary">Hostnames</div>
        <p className="text-xs text-muted-foreground">
          A device label set in Rack View is shown as-is. Otherwise the tile shows a nickname of
          the model: <code className="font-mono">smart-sw-leaf12</code>,{' '}
          <code className="font-mono">gx2a-spine1</code>, <code className="font-mono">fx3-leaf30</code>.
        </p>
      </section>
      <section className="space-y-1 text-xs text-muted-foreground">
        <div>Drag any tile at any level; positions are saved per level. <Magnet className="inline size-3" /> snaps the current level back.</div>
        <div><kbd className="border bg-muted px-1 font-mono">Esc</kbd> closes panes, then folds up one level. Double-click empty canvas to fold up.</div>
        <div>Filter grammar: <code className="font-mono">model=…</code>, <code className="font-mono">rack contains …</code>, <code className="font-mono">role!=spine</code>, or free text (hostname).</div>
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
