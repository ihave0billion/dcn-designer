import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Cable,
  Download,
  Eraser,
  GitFork,
  Link2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { RequirementsFile } from '@/schemas/project'
import type { Switch } from '@/schemas/switches'
import type { Optic } from '@/schemas/optics'
import type { PatchPanel } from '@/schemas/patch-panels'
import type { CableLink, CableLinksFile } from '@/schemas/cable-links'
import {
  cableLinksPath,
  deleteCableLinks,
  deleteLeafPairs,
  loadBreakoutPairs,
  loadCableLinks,
  loadLeafPairs,
  loadOpticsFile,
  loadPatchPanels,
  loadSwitchesFile,
  saveCableLinks,
  saveLeafPairs,
  type LeafPairsFile
} from '@/lib/library-io'
import { unpairedLeaves, validatePairs, type LeafPair } from '@/schemas/leaf-pairs'
import { FABRIC_MODE_LABEL } from '@/schemas/project'
import { seedCableLinks } from '@/lib/cable-links-seeder'
import { cableKindLabel } from '@/lib/cable-bom'
import type { BreakoutPair } from '@domain'
import { useWorkspace } from '@/state/WorkspaceContext'
import type { DesignResult } from '@domain'
import {
  parseCableLinksCsv,
  serializeCableLinksCsv
} from '@/lib/cable-links-csv'
import { NewLinkDialog, type FabricDevice } from './NewLinkDialog'

interface LinksViewProps {
  requirements: RequirementsFile
  projectPath: string
  onGoToDesign(): void
}

export function LinksView({ requirements, projectPath, onGoToDesign }: LinksViewProps) {
  const { workspacePath } = useWorkspace()
  const [switches, setSwitches] = useState<Switch[]>([])
  const [design, setDesign] = useState<DesignResult | null>(null)
  const [file, setFile] = useState<CableLinksFile | null>(null)
  const [patchPanels, setPatchPanels] = useState<PatchPanel[]>([])
  // Phase 14 — vPC pairs (leaf_pairs.yaml fork) + what a re-seed needs.
  const [pairsFile, setPairsFile] = useState<LeafPairsFile | null>(null)
  const [breakoutPairs, setBreakoutPairs] = useState<BreakoutPair[]>([])
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<CableLink | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [deleteLinkId, setDeleteLinkId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [opticsCache, setOpticsCache] = useState<Map<string, Optic[]>>(new Map())

  // ── Load on mount ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    if (!workspacePath) return
    setLoaded(false)
    Promise.all([
      loadSwitchesFile(workspacePath).then((f) => f.switches).catch(() => [] as Switch[]),
      (async () => {
        const designPath = `${projectPath}/design.yaml`
        const exists = await window.dcn.fileExists(designPath)
        if (!exists) return null
        try {
          return (await window.dcn.readYaml(designPath)) as DesignResult
        } catch {
          return null
        }
      })(),
      loadCableLinks(projectPath).catch(() => null),
      loadPatchPanels(workspacePath).catch(() => [] as PatchPanel[]),
      loadLeafPairs(projectPath).catch(() => null),
      loadBreakoutPairs(workspacePath).catch(() => [] as BreakoutPair[])
    ]).then(([sw, d, links, panels, pairs, bp]) => {
      if (cancelled) return
      setSwitches(sw)
      setDesign(d)
      setFile(links)
      setPatchPanels(panels)
      setPairsFile(pairs)
      setBreakoutPairs(bp)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [workspacePath, projectPath])

  // Lazy optics loader by switch_id, cached.
  const loadOpticsFor = useCallback(
    async (switchId: string): Promise<Optic[]> => {
      const cached = opticsCache.get(switchId)
      if (cached) return cached
      if (!workspacePath) return []
      try {
        const f = await loadOpticsFile(workspacePath, switchId)
        const arr = f.optics
        setOpticsCache((prev) => {
          const next = new Map(prev)
          next.set(switchId, arr)
          return next
        })
        return arr
      } catch {
        setOpticsCache((prev) => {
          const next = new Map(prev)
          next.set(switchId, [])
          return next
        })
        return []
      }
    },
    [workspacePath, opticsCache]
  )

  // ── Derive fabric devices (spines + leaves) from design.yaml ─────────
  const { spines, leaves } = useMemo(() => {
    if (!design) return { spines: [] as FabricDevice[], leaves: [] as FabricDevice[] }
    const sp: FabricDevice[] = []
    const lf: FabricDevice[] = []
    for (const r of design.rack_layout) {
      for (const d of r.devices) {
        if (d.role === 'spine') {
          sp.push({
            device_id: d.device_id,
            model_id: d.model_id,
            role: 'spine',
            rack: r.rack_name,
            label: d.label
          })
        } else if (d.role === 'leaf') {
          lf.push({
            device_id: d.device_id,
            model_id: d.model_id,
            role: 'leaf',
            rack: r.rack_name,
            label: d.label
          })
        }
      }
    }
    // Fallback: synthesise from spine.spines_needed / tier counts when no racks.
    if (sp.length === 0 && design.spine) {
      for (let i = 0; i < design.spine.spines_needed; i++) {
        sp.push({
          device_id: `spine-${i + 1}`,
          model_id: design.spine.spine_model_id,
          role: 'spine',
          rack: null,
          label: `Spine ${i + 1}`
        })
      }
    }
    if (lf.length === 0) {
      let serial = 0
      for (const t of design.tiers) {
        if (t.xor_status !== 'ok') continue
        for (let i = 0; i < t.leaves_required; i++) {
          serial += 1
          lf.push({
            device_id: `leaf-${serial}`,
            model_id: t.leaf_model_id,
            role: 'leaf',
            rack: null,
            label: `Leaf ${serial}`
          })
        }
      }
    }
    return { spines: sp, leaves: lf }
  }, [design])

  // Used for unknown-device warnings + CSV import filter.
  const validDeviceIds = useMemo(() => {
    const out = { spineIds: new Set<string>(), leafIds: new Set<string>() }
    for (const s of spines) out.spineIds.add(s.device_id)
    for (const l of leaves) out.leafIds.add(l.device_id)
    return out
  }, [spines, leaves])

  // ── Fork helpers ─────────────────────────────────────────────────────
  const isForked = file?.source === 'user'
  const hasFile = file != null

  async function persistFile(next: CableLinksFile): Promise<void> {
    try {
      await saveCableLinks(projectPath, next)
      setFile(next)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  // Any user mutation flips source to 'user' and stamps forked_at.
  function forkedFile(links: CableLink[]): CableLinksFile {
    const now = new Date().toISOString()
    return {
      schema_version: 1,
      source: 'user',
      seeded_at: file?.seeded_at ?? null,
      forked_at: file?.forked_at ?? now,
      links
    }
  }

  const handleSaveLink = useCallback(
    async (link: CableLink) => {
      const existing = file?.links ?? []
      const idx = existing.findIndex((l) => l.id === link.id)
      const next = idx >= 0 ? existing.map((l) => (l.id === link.id ? link : l)) : [...existing, link]
      await persistFile(forkedFile(next))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [file]
  )

  const handleDeleteLink = useCallback(
    async (id: string) => {
      const existing = file?.links ?? []
      await persistFile(forkedFile(existing.filter((l) => l.id !== id)))
      setDeleteLinkId(null)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [file]
  )

  const handleReset = useCallback(async () => {
    try {
      await deleteCableLinks(projectPath)
      setFile(null)
      setResetConfirmOpen(false)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [projectPath])

  // ── vPC pairs (Phase 14) ─────────────────────────────────────────────
  // The pairs in effect: the fork file, else the solver's pairing.
  const effectivePairs: LeafPair[] = pairsFile?.pairs ?? design?.vpc?.pairs ?? []

  // Re-seed cable_links.yaml with the given pairs when it is still
  // solver-sourced. A user fork is left alone (the caller says so).
  const reseedLinksForPairs = useCallback(
    async (pairs: LeafPair[]): Promise<boolean> => {
      if (!design || !workspacePath) return false
      if (file && file.source === 'user') return false
      const seeded = seedCableLinks({
        design,
        switches,
        fabric: {
          uplinks_per_leaf: design.vpc?.effective_uplinks_per_leaf ?? requirements.fabric.uplinks_per_leaf,
          uplinks_per_spine: requirements.fabric.uplinks_per_spine
        },
        breakoutPairs,
        patchPanels,
        pairs
      })
      const next: CableLinksFile = {
        schema_version: 1,
        source: 'solver',
        seeded_at: new Date().toISOString(),
        forked_at: null,
        links: seeded.links
      }
      await saveCableLinks(projectPath, next)
      setFile(next)
      return true
    },
    [design, workspacePath, file, switches, requirements.fabric, breakoutPairs, patchPanels, projectPath]
  )

  const handleSavePairs = useCallback(
    async (pairs: LeafPair[]) => {
      try {
        const now = new Date().toISOString()
        const next: LeafPairsFile = {
          schema_version: 1,
          source: 'user',
          seeded_at: pairsFile?.seeded_at ?? null,
          forked_at: pairsFile?.forked_at ?? now,
          pairs
        }
        await saveLeafPairs(projectPath, next)
        setPairsFile(next)
        const reseeded = await reseedLinksForPairs(pairs)
        setErr(
          reseeded
            ? null
            : 'Pairs saved. cable_links.yaml is hand-edited, so its peer-links were not re-seeded — use "Reset to solver layout" then Generate design to re-seed.'
        )
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    },
    [pairsFile, projectPath, reseedLinksForPairs]
  )

  const handleResetPairs = useCallback(async () => {
    try {
      await deleteLeafPairs(projectPath)
      setPairsFile(null)
      await reseedLinksForPairs(design?.vpc?.pairs ?? [])
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [projectPath, reseedLinksForPairs, design])

  // ── CSV export ───────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!file) return
    const csv = serializeCableLinksCsv(file.links)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const name = `cable_links-${stamp}.csv`
    const dst = await window.dcn.showSaveCsvPicker('Export cable_links.csv', name)
    if (!dst) return
    try {
      await window.dcn.writeTextFile(dst, csv)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [file])

  // ── Render ───────────────────────────────────────────────────────────
  if (!loaded) {
    return <div className="p-6 text-sm text-muted-foreground">Loading cable links…</div>
  }
  if (!design) {
    return <NoDesignState onGoToDesign={onGoToDesign} />
  }

  const filtered = (file?.links ?? []).filter((l) => {
    if (!filter.trim()) return true
    const q = filter.toLowerCase()
    return (
      l.id.toLowerCase().includes(q) ||
      l.label.toLowerCase().includes(q) ||
      l.device_a.device_id.toLowerCase().includes(q) ||
      l.device_a.port.toLowerCase().includes(q) ||
      l.device_b.device_id.toLowerCase().includes(q) ||
      l.device_b.port.toLowerCase().includes(q) ||
      (l.optic_id ?? '').toLowerCase().includes(q) ||
      (l.patch_panel_id ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Action bar */}
      <div className="border-b bg-muted/30 px-6 py-3 flex items-center gap-3 flex-wrap">
        <ForkStatusPill isForked={isForked} hasFile={hasFile} linkCount={file?.links.length ?? 0} />
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={!file || file.links.length === 0}
        >
          <Download />
          Export CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
          <Upload />
          Import CSV
        </Button>
        {isForked && (
          <Button variant="outline" size="sm" onClick={() => setResetConfirmOpen(true)}>
            <RotateCcw />
            Reset to solver layout
          </Button>
        )}
        <Button
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          size="sm"
          disabled={spines.length === 0 || leaves.length === 0}
        >
          <Plus />
          New link
        </Button>
      </div>

      {err && (
        <div className="border-b bg-destructive/10 text-destructive px-6 py-2 text-sm flex items-center justify-between">
          <span>{err}</span>
          <button onClick={() => setErr(null)} className="opacity-60 hover:opacity-100">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto px-6 py-6 space-y-4 min-h-0">
        {/* Phase 14 — vPC pairs */}
        {design.vpc && (
          <VpcPairsCard
            vpc={design.vpc}
            leaves={leaves}
            pairs={effectivePairs}
            forked={pairsFile?.source === 'user'}
            onSave={handleSavePairs}
            onReset={handleResetPairs}
          />
        )}

        {/* Empty (no file at all yet — design existed but no seed ran) */}
        {!hasFile && (
          <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/30">
            <CardContent className="py-6 space-y-3 text-sm">
              <div className="font-medium">No cable_links.yaml yet</div>
              <p className="text-muted-foreground">
                Run <strong>Generate design</strong> on the Design tab — it auto-seeds fabric
                uplinks (spine ↔ leaf). Once seeded, you can edit links here.
              </p>
              <div>
                <Button size="sm" variant="outline" onClick={onGoToDesign}>
                  Go to Design
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {hasFile && (
          <>
            {/* Summary */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Links</CardTitle>
                  <div className="flex items-center gap-2">
                    <Input
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="Filter by id, device, port, optic…"
                      className="h-8 w-72"
                    />
                  </div>
                </div>
                <CardDescription>
                  {file.links.length} total · {filtered.length} matching ·{' '}
                  {(file.seeded_at && !isForked) && `seeded ${formatTime(file.seeded_at)}`}
                  {file.forked_at && isForked && `forked ${formatTime(file.forked_at)}`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {filtered.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    {file.links.length === 0
                      ? 'No links — click New link or Generate design to seed.'
                      : 'No links match the current filter.'}
                  </p>
                ) : (
                  <div className="border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-28">ID</TableHead>
                          <TableHead className="w-28">Kind</TableHead>
                          <TableHead>Spine / leaf A</TableHead>
                          <TableHead>Leaf / leaf B</TableHead>
                          <TableHead className="w-16">Speed</TableHead>
                          <TableHead className="w-40">Optic</TableHead>
                          <TableHead className="w-44">Patch panel</TableHead>
                          <TableHead className="w-16 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((l) => (
                          <TableRow key={l.id} className="text-xs">
                            <TableCell className="font-mono">{l.id}</TableCell>
                            <TableCell>
                              <span
                                className={cn(
                                  'px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider chamfer-xs',
                                  l.kind === 'vpc-peer-link' ? 'bg-[#B85450]/15 text-[#B85450]' : 'bg-muted text-muted-foreground'
                                )}
                              >
                                {cableKindLabel(l.kind)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{l.device_a.device_id}</div>
                              <div className="text-muted-foreground font-mono">
                                {l.device_a.port}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{l.device_b.device_id}</div>
                              <div className="text-muted-foreground font-mono">
                                {l.device_b.port}
                              </div>
                            </TableCell>
                            <TableCell>{l.speed_g}G</TableCell>
                            <TableCell className="font-mono">{l.optic_id ?? '—'}</TableCell>
                            <TableCell className="font-mono">
                              {l.patch_panel_id ?? '—'}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  className="opacity-70 hover:opacity-100 disabled:opacity-25 disabled:cursor-default"
                                  disabled={l.kind === 'vpc-peer-link'}
                                  onClick={() => {
                                    setEditing(l)
                                    setDialogOpen(true)
                                  }}
                                  title={
                                    l.kind === 'vpc-peer-link'
                                      ? 'Peer-link ports come from the switch library and the vPC pairs card'
                                      : 'Edit'
                                  }
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                                <button
                                  className="opacity-70 hover:opacity-100 text-destructive"
                                  onClick={() => setDeleteLinkId(l.id)}
                                  title="Delete"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Dialogs */}
      <NewLinkDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        spines={spines}
        leaves={leaves}
        switches={switches}
        existingLinks={file?.links ?? []}
        spineOptics={[]}
        leafOptics={[]}
        patchPanels={patchPanels}
        onLoadOptics={loadOpticsFor}
        initialDraft={editing ?? undefined}
        editingLinkId={editing?.id ?? null}
        onSubmit={handleSaveLink}
      />

      <ImportCsvDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        cableLinksFilePath={cableLinksPath(projectPath)}
        existingLinks={file?.links ?? []}
        validDevices={validDeviceIds}
        onImport={async (links, mode) => {
          const merged = mode === 'replace' ? links : [...(file?.links ?? []), ...links]
          await persistFile(forkedFile(merged))
        }}
      />

      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset cable links?</AlertDialogTitle>
            <AlertDialogDescription>
              Discards your link edits and deletes{' '}
              <code className="font-mono text-xs">cable_links.yaml</code>. The next time you
              click <strong>Generate design</strong>, a fresh fabric wiring will be seeded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>
              <Eraser />
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteLinkId != null}
        onOpenChange={(open) => !open && setDeleteLinkId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete link?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the link from <code className="font-mono text-xs">cable_links.yaml</code>{' '}
              and frees the spine + leaf ports it used. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteLinkId && handleDeleteLink(deleteLinkId)}>
              <Trash2 />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// vPC pairs card (Phase 14) — re-pick the members of any pair; an odd
// leaf out is flagged. Saving forks leaf_pairs.yaml and re-seeds the
// peer-links when cable_links.yaml is still solver-sourced.
// ────────────────────────────────────────────────────────────────────

function VpcPairsCard({
  vpc,
  leaves,
  pairs,
  forked,
  onSave,
  onReset
}: {
  vpc: NonNullable<DesignResult['vpc']>
  leaves: FabricDevice[]
  pairs: LeafPair[]
  forked: boolean
  onSave(pairs: LeafPair[]): Promise<void>
  onReset(): Promise<void>
}) {
  const [draft, setDraft] = useState<LeafPair[]>(pairs)
  const [busy, setBusy] = useState(false)
  useEffect(() => setDraft(pairs), [pairs])
  const leafIds = leaves.map((l) => l.device_id)
  const dirty = JSON.stringify(draft) !== JSON.stringify(pairs)
  const problems = validatePairs(draft, leafIds)
  const excluded = new Set(vpc.excluded ?? [])
  const unpairedAll = unpairedLeaves(leafIds, draft)
  const unpaired = unpairedAll.filter((id) => !excluded.has(id))
  const notVpcd = unpairedAll.filter((id) => excluded.has(id))
  const labelOf = (id: string): string => leaves.find((l) => l.device_id === id)?.label || id

  function setMember(pairIdx: number, slot: 0 | 1, id: string): void {
    setDraft((prev) =>
      prev.map((p, i) => {
        if (i !== pairIdx) return p
        const members: [string, string] = [p.members[0], p.members[1]]
        members[slot] = id
        return { ...p, members }
      })
    )
  }
  function addPair(): void {
    if (unpaired.length < 2) return
    setDraft((prev) => [...prev, { id: `pair-${prev.length + 1}`, members: [unpaired[0], unpaired[1]] }])
  }
  function removePair(idx: number): void {
    setDraft((prev) => prev.filter((_, i) => i !== idx).map((p, i) => ({ ...p, id: `pair-${i + 1}` })))
  }
  async function run(fn: () => Promise<void>): Promise<void> {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const peerLinkText = vpc.peer_link
    ? `${vpc.members} × peer-link per pair${vpc.port_channel ? ' in a port-channel' : ''}`
    : 'no peer-link (pairs are logical)'

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="size-4" />
            vPC leaf pairs
          </CardTitle>
          <div className="flex items-center gap-2">
            {forked && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 text-xs font-medium px-2.5 py-1">
                <GitFork className="size-3.5" />
                Forked — your pairs
              </span>
            )}
            {forked && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(onReset)}>
                <RotateCcw />
                Reset to solver pairs
              </Button>
            )}
            <Button variant="outline" size="sm" disabled={busy || unpaired.length < 2} onClick={addPair}>
              <Plus />
              Add pair
            </Button>
            <Button size="sm" disabled={busy || !dirty || problems.length > 0} onClick={() => void run(() => onSave(draft))}>
              {busy ? 'Saving…' : 'Save pairs'}
            </Button>
          </div>
        </div>
        <CardDescription>
          {FABRIC_MODE_LABEL[vpc.mode] ?? vpc.mode} · {peerLinkText} · {draft.length} pair{draft.length === 1 ? '' : 's'}
          {vpc.effective_uplinks_per_leaf !== vpc.configured_uplinks_per_leaf &&
            ` · uplinks/leaf reduced to ${vpc.effective_uplinks_per_leaf} (of ${vpc.configured_uplinks_per_leaf}) for the peer-link`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {draft.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pairs — the design has fewer than two leaves of a model.</p>
        ) : (
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Pair</TableHead>
                  <TableHead>Leaf A</TableHead>
                  <TableHead>Leaf B</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.map((p, i) => (
                  <TableRow key={p.id} className="text-xs">
                    <TableCell className="font-mono">{p.id}</TableCell>
                    {([0, 1] as const).map((slot) => (
                      <TableCell key={slot}>
                        <select
                          className="h-8 w-full border bg-background px-2 text-xs font-mono chamfer-xs"
                          value={p.members[slot]}
                          onChange={(e) => setMember(i, slot, e.target.value)}
                        >
                          {leaves.map((l) => (
                            <option key={l.device_id} value={l.device_id}>
                              {labelOf(l.device_id)} · {l.model_id}
                            </option>
                          ))}
                        </select>
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      <button className="opacity-70 hover:opacity-100 text-destructive" title="Remove pair" onClick={() => removePair(i)}>
                        <Trash2 className="size-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {unpaired.length > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Unpaired (odd leaf out, single-attached hosts only): {unpaired.map(labelOf).join(', ')}
          </p>
        )}
        {notVpcd.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Not vPC'd (tier setting in Requirements): {notVpcd.map(labelOf).join(', ')}
          </p>
        )}
        {problems.length > 0 && (
          <ul className="text-xs text-destructive list-disc pl-5">
            {problems.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ────────────────────────────────────────────────────────────────────
// Status pill (mirrors RackView pattern)
// ────────────────────────────────────────────────────────────────────

function ForkStatusPill({
  isForked,
  hasFile,
  linkCount
}: {
  isForked: boolean
  hasFile: boolean
  linkCount: number
}) {
  if (isForked) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 text-xs font-medium px-2.5 py-1">
        <GitFork className="size-3.5" />
        Forked — your edits ({linkCount} link{linkCount === 1 ? '' : 's'})
      </span>
    )
  }
  if (hasFile) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted text-muted-foreground text-xs font-medium px-2.5 py-1">
        <Cable className="size-3.5" />
        Solver-seeded ({linkCount} link{linkCount === 1 ? '' : 's'})
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted text-muted-foreground text-xs font-medium px-2.5 py-1">
      <Cable className="size-3.5" />
      No links yet
    </span>
  )
}

// ────────────────────────────────────────────────────────────────────
// Empty state — no design.yaml yet
// ────────────────────────────────────────────────────────────────────

function NoDesignState({ onGoToDesign }: { onGoToDesign(): void }) {
  return (
    <div className="p-8 max-w-xl mx-auto">
      <Card>
        <CardContent className="py-8 space-y-3 text-center">
          <h2 className="text-base font-semibold">No design yet</h2>
          <p className="text-sm text-muted-foreground">
            Cable links are seeded from the solver's design. Run{' '}
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

// ────────────────────────────────────────────────────────────────────
// CSV import dialog
// ────────────────────────────────────────────────────────────────────

interface ImportCsvDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  cableLinksFilePath: string
  existingLinks: CableLink[]
  validDevices: { spineIds: Set<string>; leafIds: Set<string> }
  onImport(links: CableLink[], mode: 'replace' | 'append'): Promise<void>
}

function ImportCsvDialog({
  open,
  onOpenChange,
  existingLinks,
  validDevices,
  onImport
}: ImportCsvDialogProps) {
  const [picked, setPicked] = useState<{ path: string; basename: string } | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseResult, setParseResult] = useState<ReturnType<typeof parseCableLinksCsv> | null>(null)
  const [mode, setMode] = useState<'replace' | 'append'>('replace')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setPicked(null)
      setParseResult(null)
      setError(null)
      setMode(existingLinks.length === 0 ? 'replace' : 'replace')
    }
  }, [open, existingLinks.length])

  async function handlePickFile() {
    setError(null)
    const picked = await window.dcn.showCsvPicker('Import cable_links CSV')
    if (!picked) return
    setPicked(picked)
    setParsing(true)
    try {
      const text = await window.dcn.readTextFile(picked.path)
      const startSerial = existingLinks.length + 1
      const result = parseCableLinksCsv(text, validDevices, startSerial)
      setParseResult(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!parseResult) return
    try {
      await onImport(parseResult.links, mode)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Import cable links from CSV</AlertDialogTitle>
          <AlertDialogDescription>
            Expected columns:{' '}
            <code className="font-mono text-xs">
              spine_device_id, spine_port, leaf_device_id, leaf_port, speed_g
            </code>{' '}
            (required) plus{' '}
            <code className="font-mono text-xs">
              id, spine_rack, leaf_rack, optic_id, patch_panel_id, label, length_m, notes
            </code>{' '}
            (optional). Rows referencing unknown devices are skipped.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={handlePickFile} disabled={parsing}>
              <Upload />
              {picked ? 'Pick another file…' : 'Choose CSV file…'}
            </Button>
            {picked && <span className="font-mono text-xs">{picked.basename}</span>}
          </div>

          {parseResult && (
            <Card className="border-muted">
              <CardContent className="py-4 space-y-2 text-sm">
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  <Stat k="Parsed" v={parseResult.links.length} />
                  <Stat k="Total rows" v={parseResult.total_rows} />
                  <Stat k="Malformed" v={parseResult.rows_skipped_malformed} alert={parseResult.rows_skipped_malformed > 0} />
                  <Stat
                    k="Unknown device"
                    v={parseResult.rows_skipped_unknown_device}
                    alert={parseResult.rows_skipped_unknown_device > 0}
                  />
                </div>
                {parseResult.warnings.length > 0 && (
                  <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5 max-h-32 overflow-auto">
                    {parseResult.warnings.slice(0, 20).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                    {parseResult.warnings.length > 20 && (
                      <li>… and {parseResult.warnings.length - 20} more.</li>
                    )}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {parseResult && existingLinks.length > 0 && (
            <div className="border-t pt-3 text-sm">
              <div className="font-medium mb-2">Existing links: {existingLinks.length}</div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="import-mode"
                    checked={mode === 'replace'}
                    onChange={() => setMode('replace')}
                  />
                  <span>Replace all existing links</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="import-mode"
                    checked={mode === 'append'}
                    onChange={() => setMode('append')}
                  />
                  <span>Append to existing</span>
                </label>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleImport}
            disabled={!parseResult || parseResult.links.length === 0}
          >
            <Upload />
            Import {parseResult ? `${parseResult.links.length} link${parseResult.links.length === 1 ? '' : 's'}` : ''}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Stat({ k, v, alert }: { k: string; v: number; alert?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className={cn('font-mono font-medium', alert && 'text-destructive')}>{v}</span>
    </div>
  )
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}
