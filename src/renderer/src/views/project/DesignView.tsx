import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  GitFork,
  Loader2,
  Network,
  Play,
  XCircle
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SeverityBadge, StatusPill } from '@/components/design-status'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  RequirementsFileSchema,
  type RequirementsFile,
  type InputMode
} from '@/schemas/project'
import type { Switch } from '@/schemas/switches'
import {
  deleteLeafPairs,
  deleteRackMapping,
  deleteTopologyLayout,
  ipnRouterSpecFromFileEntry,
  loadBreakoutPairs,
  loadCableLinks,
  loadIpnRouters,
  loadLeafPairs,
  loadPatchPanels,
  loadRackMapping,
  loadSwitchesFile,
  loadTopologyLayout,
  saveCableLinks,
  saveLeafPairs
} from '@/lib/library-io'
import { FABRIC_MODE_LABEL } from '@/schemas/project'
import { runSolver } from '@/lib/solver-bridge'
import { seedCableLinks } from '@/lib/cable-links-seeder'
import { projectCommittedCandidate } from '@/lib/design-projection'
import { useWorkspace } from '@/state/WorkspaceContext'
import {
  IPN_RACK_NAME,
  IPN_RACK_SIZE_U,
  type CandidateId,
  type DesignCandidate,
  type DesignResult,
  type IpnRouterSpec,
  type RackPlacement,
  type WarningCode
} from '@domain'

interface DesignViewProps {
  requirements: RequirementsFile
  projectPath: string
  onRequirementsChanged(next: RequirementsFile): void
  onEditRequirements(): void
}

export function DesignView({
  requirements,
  projectPath,
  onRequirementsChanged,
  onEditRequirements
}: DesignViewProps) {
  const { workspacePath } = useWorkspace()
  const [switches, setSwitches] = useState<Switch[]>([])
  const [ipnRouters, setIpnRouters] = useState<IpnRouterSpec[]>([])
  const [result, setResult] = useState<DesignResult | null>(null)
  const [generating, setGenerating] = useState(false)
  const [committing, setCommitting] = useState<CandidateId | null>(null)
  const [genErr, setGenErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  // When committing a candidate would clobber hand-edited fork files we
  // pause and ask (decision 2026-06-01: warn → Regenerate fresh vs Keep).
  const [pendingCommit, setPendingCommit] = useState<{
    candidateId: CandidateId
    projected: DesignResult
    forks: string[]
  } | null>(null)

  // Load library + any prior design.yaml on mount
  useEffect(() => {
    let cancelled = false
    if (!workspacePath) return
    Promise.all([
      loadSwitchesFile(workspacePath).then((f) => f.switches).catch(() => [] as Switch[]),
      loadIpnRouters(workspacePath)
        .then((rs) => rs.map(ipnRouterSpecFromFileEntry))
        .catch(() => [] as IpnRouterSpec[]),
      (async () => {
        const designPath = `${projectPath}/design.yaml`
        const exists = await window.dcn.fileExists(designPath)
        if (!exists) return null
        try {
          return (await window.dcn.readYaml(designPath)) as DesignResult
        } catch {
          return null
        }
      })()
    ]).then(([sw, ipn, prior]) => {
      if (cancelled) return
      setSwitches(sw)
      setIpnRouters(ipn)
      setResult(prior)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [workspacePath, projectPath])

  const switchById = useMemo(() => {
    const m = new Map<string, Switch>()
    for (const s of switches) m.set(s.id, s)
    return m
  }, [switches])

  // ── Input-mode toggle saves back to requirements.yaml ─────────────
  const handleInputModeChange = useCallback(
    async (mode: InputMode) => {
      if (mode === requirements.input_mode) return
      const next: RequirementsFile = {
        ...requirements,
        input_mode: mode,
        project: { ...requirements.project, last_edited: new Date().toISOString() }
      }
      const parsed = RequirementsFileSchema.safeParse(next)
      if (!parsed.success) {
        setGenErr(`Cannot update input mode: ${parsed.error.message}`)
        return
      }
      await window.dcn.writeYaml(`${projectPath}/requirements.yaml`, parsed.data)
      onRequirementsChanged(parsed.data)
    },
    [requirements, projectPath, onRequirementsChanged]
  )

  // Phase 14 — seed leaf_pairs.yaml from the solver's pairing (same fork
  // pattern as cable_links: absent or solver-sourced → rewrite; a user fork
  // is kept unless `force`). Returns the pairs now in effect.
  const reseedLeafPairs = useCallback(
    async (design: DesignResult, force: boolean) => {
      const solverPairs = design.vpc?.pairs ?? []
      try {
        const existing = await loadLeafPairs(projectPath)
        if (!force && existing != null && existing.source === 'user') return existing.pairs
        await saveLeafPairs(projectPath, {
          schema_version: 1,
          source: 'solver',
          seeded_at: new Date().toISOString(),
          forked_at: null,
          pairs: solverPairs
        })
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[leaf-pairs seed] failed:', e)
      }
      return solverPairs
    },
    [projectPath]
  )

  // Re-seed cable_links.yaml from a (projected) design. `force` ignores
  // an existing user fork; otherwise only seeds when the file is absent
  // or still solver-sourced. Mirrors the Phase 5/6 fork pattern.
  const reseedCableLinks = useCallback(
    async (design: DesignResult, force: boolean) => {
      if (!workspacePath) return
      try {
        const pairs = await reseedLeafPairs(design, force)
        const existing = await loadCableLinks(projectPath)
        if (!force && existing != null && existing.source !== 'solver') return
        const breakoutPairs = await loadBreakoutPairs(workspacePath)
        const patchPanels = await loadPatchPanels(workspacePath)
        const seeded = seedCableLinks({
          design,
          switches,
          fabric: {
            // Phase 14 — the solver may have reduced this for the peer-link.
            uplinks_per_leaf: design.vpc?.effective_uplinks_per_leaf ?? requirements.fabric.uplinks_per_leaf,
            uplinks_per_spine: requirements.fabric.uplinks_per_spine
          },
          breakoutPairs,
          patchPanels,
          pairs
        })
        await saveCableLinks(projectPath, {
          schema_version: 1,
          source: 'solver',
          seeded_at: new Date().toISOString(),
          forked_at: null,
          links: seeded.links
        })
      } catch (seedErr) {
        // eslint-disable-next-line no-console
        console.warn('[cable-links seed] failed:', seedErr)
      }
    },
    [workspacePath, projectPath, requirements, switches, reseedLeafPairs]
  )

  // ── Generate Design ───────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!workspacePath) return
    setGenerating(true)
    setGenErr(null)
    try {
      const breakoutPairs = await loadBreakoutPairs(workspacePath)
      const raw = runSolver({ requirements, switches, breakoutPairs, ipnRouters })
      // Top-level fields mirror the committed (= primary) candidate so the
      // Rack / Links / Topology views render the active design.
      const design = projectCommittedCandidate(raw)
      await window.dcn.writeYaml(`${projectPath}/design.yaml`, design)
      setResult(design)
      await reseedCableLinks(design, false)
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }, [workspacePath, projectPath, requirements, switches, ipnRouters, reseedCableLinks])

  // Ensure requirements.racks has the solver-suggested IPN rack so Rack
  // View (driven by requirements.racks) renders the IPN routers.
  const ensureIpnRack = useCallback(async () => {
    if (requirements.racks.some((r) => r.name === IPN_RACK_NAME)) return
    const next: RequirementsFile = {
      ...requirements,
      racks: [
        ...requirements.racks,
        { name: IPN_RACK_NAME, size_u: IPN_RACK_SIZE_U, pdu_kw_budget: null, location: '', tags: [] }
      ],
      project: { ...requirements.project, last_edited: new Date().toISOString() }
    }
    const parsed = RequirementsFileSchema.safeParse(next)
    if (!parsed.success) return
    await window.dcn.writeYaml(`${projectPath}/requirements.yaml`, parsed.data)
    onRequirementsChanged(parsed.data)
  }, [requirements, projectPath, onRequirementsChanged])

  // Apply a committed candidate: write projected design.yaml, add the IPN
  // rack when multi-pod, and re-seed cable_links. `regenerateForks` also
  // discards rack_mapping + topology_layout forks so they re-derive.
  const applyCommit = useCallback(
    async (projected: DesignResult, regenerateForks: boolean) => {
      await window.dcn.writeYaml(`${projectPath}/design.yaml`, projected)
      setResult(projected)
      const cand = projected.candidates.find((c) => c.id === projected.committed_candidate_id)
      if (cand?.multipod) await ensureIpnRack()
      if (regenerateForks) {
        await deleteRackMapping(projectPath)
        await deleteTopologyLayout(projectPath)
        await deleteLeafPairs(projectPath)
      }
      await reseedCableLinks(projected, regenerateForks)
    },
    [projectPath, ensureIpnRack, reseedCableLinks]
  )

  // ── Commit a candidate (the "use this design" toggle) ─────────────
  const handleCommit = useCallback(
    async (candidateId: CandidateId) => {
      if (!result || candidateId === result.committed_candidate_id) return
      setCommitting(candidateId)
      setGenErr(null)
      try {
        const projected = projectCommittedCandidate(result, candidateId)
        // Detect hand-edited fork files that this commit would affect.
        const [links, mapping, topo] = await Promise.all([
          loadCableLinks(projectPath).catch(() => null),
          loadRackMapping(projectPath).catch(() => null),
          loadTopologyLayout(projectPath).catch(() => null)
        ])
        const pairsFile = await loadLeafPairs(projectPath).catch(() => null)
        const forks: string[] = []
        if (links && links.source === 'user') forks.push('cable_links.yaml')
        if (pairsFile && pairsFile.source === 'user') forks.push('leaf_pairs.yaml')
        if (mapping) forks.push('rack_mapping.yaml')
        if (topo && topo.source === 'user') forks.push('topology_layout.yaml')
        if (forks.length > 0) {
          setPendingCommit({ candidateId, projected, forks })
          return
        }
        await applyCommit(projected, false)
      } catch (e) {
        setGenErr(e instanceof Error ? e.message : String(e))
      } finally {
        setCommitting(null)
      }
    },
    [result, projectPath, applyCommit]
  )

  const resolvePendingCommit = useCallback(
    async (regenerate: boolean) => {
      if (!pendingCommit) return
      setCommitting(pendingCommit.candidateId)
      try {
        await applyCommit(pendingCommit.projected, regenerate)
      } catch (e) {
        setGenErr(e instanceof Error ? e.message : String(e))
      } finally {
        setPendingCommit(null)
        setCommitting(null)
      }
    },
    [pendingCommit, applyCommit]
  )

  // ── Generate-readiness checks ─────────────────────────────────────
  const perLeafSelected = requirements.input_mode === 'per_leaf'
  const tiersWithModel = requirements.tiers.filter((t) => t.leaf_model_id)
  const hasMinimumInputs =
    tiersWithModel.length > 0 && Boolean(requirements.fabric.spine_model_id)
  const canGenerate = !generating && !perLeafSelected && hasMinimumInputs

  // ── Inputs summary derived from requirements ──────────────────────
  const inputsSummary = useMemo(() => {
    const tiers = requirements.tiers.map((t) => {
      const sw = t.leaf_model_id ? switchById.get(t.leaf_model_id) : null
      const driverLabel =
        t.endpoint_count != null
          ? `${t.endpoint_count} endpoints`
          : t.switch_count != null
            ? `${t.switch_count} switches`
            : 'unset'
      return {
        label: t.speed_tier_label || '(unlabeled)',
        leafModelId: t.leaf_model_id,
        leafModelDisplay: sw?.model_display ?? null,
        driverLabel,
        uplinkOverride: t.override_uplink_speed_g
      }
    })
    const spine = requirements.fabric.spine_model_id
      ? switchById.get(requirements.fabric.spine_model_id) ?? null
      : null
    return {
      tiers,
      spine,
      uplinks_per_leaf: requirements.fabric.uplinks_per_leaf,
      uplinks_per_spine: requirements.fabric.uplinks_per_spine,
      use_case: requirements.use_case,
      input_mode: requirements.input_mode,
      racks: requirements.racks
    }
  }, [requirements, switchById])

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Action bar */}
      <div className="border-b bg-muted/30 px-6 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Input mode</span>
          <Select
            value={requirements.input_mode}
            onValueChange={(v) => handleInputModeChange(v as InputMode)}
          >
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="aggregate">Aggregate</SelectItem>
              <SelectItem value="per_leaf">Per-leaf (Phase 4b)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="ghost" size="sm" onClick={onEditRequirements}>
          Edit requirements
          <ArrowRight />
        </Button>
        <div className="flex-1" />
        {result && (
          <span className="text-xs text-muted-foreground">
            Last design saved · {result.summary.total_leaves} leaves ·{' '}
            {result.summary.total_spines} spines
          </span>
        )}
        <Button onClick={handleGenerate} disabled={!canGenerate}>
          {generating ? <Loader2 className="animate-spin" /> : <Play />}
          {generating ? 'Generating…' : result ? 'Regenerate design' : 'Generate design'}
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6 space-y-6 min-h-0">
        {perLeafSelected && (
          <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/30">
            <CardContent className="py-4 text-sm">
              <div className="font-medium mb-1">Per-leaf overrides editor coming in Phase 4b</div>
              <p className="text-muted-foreground">
                The aggregate path is the only working solver mode today. Switch input mode back
                to <strong>Aggregate</strong> to generate a design, or keep this set as a
                placeholder for the per-leaf rollout.
              </p>
            </CardContent>
          </Card>
        )}

        {!hasMinimumInputs && !perLeafSelected && (
          <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/30">
            <CardContent className="py-4 text-sm space-y-1">
              <div className="font-medium">Requirements incomplete</div>
              <ul className="text-muted-foreground list-disc pl-5">
                {tiersWithModel.length === 0 && (
                  <li>Add at least one tier with a leaf model selected.</li>
                )}
                {!requirements.fabric.spine_model_id && <li>Select a spine model.</li>}
              </ul>
            </CardContent>
          </Card>
        )}

        {genErr && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="py-3 text-sm text-destructive">{genErr}</CardContent>
          </Card>
        )}

        {/* Inputs from requirements */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inputs from requirements</CardTitle>
            <CardDescription>
              Read-only mirror of <code className="font-mono text-xs">requirements.yaml</code>.
              Use Edit requirements to make changes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Kv k="Use case" v={inputsSummary.use_case.toUpperCase()} />
              <Kv k="Input mode" v={inputsSummary.input_mode} />
              <Kv
                k="Uplinks / leaf"
                v={String(inputsSummary.uplinks_per_leaf)}
              />
              <Kv
                k="Uplinks / spine"
                v={String(inputsSummary.uplinks_per_spine)}
              />
              <Kv
                k="Spine model"
                v={
                  inputsSummary.spine
                    ? `${inputsSummary.spine.id} · ${inputsSummary.spine.primary.ports}× ${inputsSummary.spine.primary.speed_g}G`
                    : '— not selected —'
                }
                wide
              />
              <Kv k="Racks defined" v={String(inputsSummary.racks.length)} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Tiers
              </div>
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead>
                      <TableHead>Leaf model</TableHead>
                      <TableHead>Driver</TableHead>
                      <TableHead className="w-32">Uplink override</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inputsSummary.tiers.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="text-center text-muted-foreground py-4"
                        >
                          No tiers defined.
                        </TableCell>
                      </TableRow>
                    ) : (
                      inputsSummary.tiers.map((t, i) => (
                        <TableRow key={i}>
                          <TableCell>{t.label}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {t.leafModelId ?? '—'}
                          </TableCell>
                          <TableCell>{t.driverLabel}</TableCell>
                          <TableCell>
                            {t.uplinkOverride != null ? `${t.uplinkOverride} G` : '—'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Candidate matrix — Multi-Pod ACI comparison (Phase 9b) */}
        {loaded && result && result.candidates.length > 0 && (
          <CandidateMatrix
            result={result}
            switchById={switchById}
            committing={committing}
            onCommit={handleCommit}
          />
        )}

        {/* Results panel — only after generate */}
        {loaded && result ? (
          <ResultsPanel result={result} switchById={switchById} />
        ) : (
          loaded && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No design generated yet. Fill out requirements and click{' '}
                <strong>Generate design</strong> to run the solver.
              </CardContent>
            </Card>
          )
        )}
      </div>

      {/* Commit-switch fork reconciliation dialog */}
      <AlertDialog
        open={pendingCommit != null}
        onOpenChange={(o) => {
          if (!o) setPendingCommit(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Committing changes the device set</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This candidate has a different set of devices than the one you committed before.
                  You have hand-edited file{pendingCommit && pendingCommit.forks.length === 1 ? '' : 's'}{' '}
                  that reference the old layout:
                </p>
                <ul className="list-disc pl-5 font-mono text-xs">
                  {pendingCommit?.forks.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <p>
                  <strong>Regenerate fresh</strong> discards those edits and re-derives the layout
                  from the new candidate. <strong>Keep my edits</strong> leaves your files as-is
                  (some devices may be missing or orphaned until you reconcile them).
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="outline" onClick={() => void resolvePendingCommit(false)}>
              Keep my edits
            </Button>
            <AlertDialogAction onClick={() => void resolvePendingCommit(true)}>
              Regenerate fresh
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Results panel
// ────────────────────────────────────────────────────────────────────

function ResultsPanel({
  result,
  switchById
}: {
  result: DesignResult
  switchById: Map<string, Switch>
}) {
  const { summary, tiers, spine, breakout, warnings, rack_layout, optics_bom, vpc } = result
  const errors = warnings.filter((w) => w.severity === 'error')
  const warns = warnings.filter((w) => w.severity === 'warn')
  const infos = warnings.filter((w) => w.severity === 'info')

  return (
    <div className="space-y-6">
      {/* Summary */}
      <Card
        className={cn(
          summary.valid
            ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/60 dark:bg-emerald-950/20'
            : 'border-destructive/40 bg-destructive/5'
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Design summary</CardTitle>
            <StatusPill valid={summary.valid} />
          </div>
          {summary.breakout_required_to_be_valid && (
            <CardDescription className="text-emerald-700 dark:text-emerald-300">
              Valid with breakout: the base design is over-uplinked, but a verified breakout pair
              reduces the spine count and makes it fit.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Kv k="Total leaves" v={String(summary.total_leaves)} />
            <Kv k="Total spines" v={String(summary.total_spines)} />
            <Kv k="Spines (no breakout)" v={String(summary.spines_no_breakout)} />
            <Kv
              k="Spines (with breakout)"
              v={
                summary.spines_with_breakout != null
                  ? String(summary.spines_with_breakout)
                  : '—'
              }
            />
            <Kv k="Host BW" v={`${summary.total_host_bw_g} G`} />
            <Kv k="Uplink BW" v={`${summary.total_uplink_bw_g} G`} />
            <Kv k="Oversub" v={summary.computed_oversub_label} />
            {vpc && (
              <>
                <Kv k="Fabric mode" v={FABRIC_MODE_LABEL[vpc.mode] ?? vpc.mode} />
                <Kv
                  k="vPC pairs"
                  v={`${vpc.pairs.length}${vpc.unpaired.length ? ` (+${vpc.unpaired.length} unpaired)` : ''}`}
                />
                <Kv
                  k="Peer-link"
                  v={vpc.peer_link ? `${vpc.members} × per pair${vpc.port_channel ? ', Po' : ''}` : 'none'}
                />
                <Kv
                  k="Uplinks/leaf used"
                  v={
                    vpc.effective_uplinks_per_leaf === vpc.configured_uplinks_per_leaf
                      ? String(vpc.effective_uplinks_per_leaf)
                      : `${vpc.effective_uplinks_per_leaf} (of ${vpc.configured_uplinks_per_leaf})`
                  }
                />
              </>
            )}
            <Kv
              k="Servers"
              v={String(summary.total_servers)}
              note="Phase 4 has no server inputs yet"
            />
          </div>
        </CardContent>
      </Card>

      {/* Warnings */}
      {warnings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Warnings ({errors.length} error, {warns.length} warn, {infos.length} info)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Severity</TableHead>
                    <TableHead className="w-64">Code</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {warnings.map((w, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <SeverityBadge severity={w.severity} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{w.code}</TableCell>
                      <TableCell>{w.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-tier results */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Per-tier results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Leaf model</TableHead>
                  <TableHead className="w-24">Leaves</TableHead>
                  <TableHead className="w-32">Endpoints supported</TableHead>
                  <TableHead className="w-32">Host BW (G)</TableHead>
                  <TableHead className="w-32">Uplink BW (G)</TableHead>
                  <TableHead className="w-32">Uplink choice</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tiers.map((t, i) => {
                  const sw = switchById.get(t.leaf_model_id)
                  return (
                    <TableRow key={i}>
                      <TableCell>{t.speed_tier_label || '(unlabeled)'}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {sw?.id ?? t.leaf_model_id}
                      </TableCell>
                      <TableCell>{t.leaves_required}</TableCell>
                      <TableCell>{t.endpoints_supported}</TableCell>
                      <TableCell>{t.host_bw_g}</TableCell>
                      <TableCell>
                        {t.uplink_bw_g}
                        {t.override_uplink_speed_applied_g != null && (
                          <span className="text-muted-foreground text-xs ml-1">
                            (override {t.override_uplink_speed_applied_g}G)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {t.effective_uplink_choice} · {t.effective_uplink_ports}×{' '}
                        {t.effective_uplink_speed_g}G
                      </TableCell>
                      <TableCell>
                        <TierStatusBadge status={t.xor_status} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Spine breakdown */}
      {spine && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Spine sizing</CardTitle>
            <CardDescription>
              <code className="font-mono text-xs">
                spines_needed = MAX(2, capacity, touching, port_count)
              </code>{' '}
              per v8 rule 7.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Kv
                k="Spine model"
                v={`${spine.spine_model_id} · ${spine.spine_ports}× ${spine.spine_speed_g}G`}
                wide
              />
              <Kv k="Total leaves" v={String(spine.total_leaves)} />
              <Kv k="Total leaf uplinks" v={String(spine.total_leaf_uplinks)} />
              <Kv k="Capacity term" v={String(spine.spines_capacity)} />
              <Kv
                k="Touching term"
                v={
                  spine.spines_touching != null
                    ? String(spine.spines_touching)
                    : 'not divisible'
                }
                note={
                  spine.spine_touching_divisible
                    ? undefined
                    : 'uplinks_per_leaf / uplinks_per_spine ≠ integer'
                }
              />
              <Kv k="Port-count term" v={String(spine.spines_port_count)} />
              <Kv k="Spines needed" v={String(spine.spines_needed)} highlight />
              <Kv
                k="Required uplinks/leaf"
                v={String(spine.required_uplinks_per_leaf)}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Breakout analysis */}
      {breakout?.applicable && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Breakout analysis (S3)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Kv
                k="Verified pair"
                v={
                  breakout.recommended_pair
                    ? `${breakout.recommended_pair.spine_pid} → ${breakout.recommended_pair.leaf_pid}`
                    : 'no pair available'
                }
                wide
              />
              <Kv k="Fanout" v={`1× → ${breakout.fanout}×`} />
              <Kv
                k="Spines with breakout"
                v={String(breakout.spines_with_breakout)}
              />
              <Kv
                k="Reduces spine count"
                v={breakout.reduces_spine_count ? 'yes' : 'no'}
              />
              <Kv k="Flips to valid" v={breakout.flips_to_valid ? 'yes' : 'no'} />
              <Kv
                k="Patch panel needed"
                v={breakout.patch_panel_needed ? 'yes — connector mismatch' : 'no'}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Optics BOM hint */}
      {optics_bom.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Optics BOM hint</CardTitle>
            <CardDescription>
              Solver's preliminary BOM. Cable Links UI (Phase 6) will refine these against the
              per-switch optics files.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Scenario</TableHead>
                    <TableHead>Optic</TableHead>
                    <TableHead className="w-24">Count</TableHead>
                    <TableHead className="w-24">Location</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {optics_bom.map((b, i) => (
                    <TableRow key={i}>
                      <TableCell>{b.scenario}</TableCell>
                      <TableCell className="font-mono text-xs">{b.optic_id}</TableCell>
                      <TableCell>{b.count}</TableCell>
                      <TableCell>{b.location}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {b.notes ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rack layout */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Rack layout</CardTitle>
          <CardDescription>
            Heuristic placement. Detailed visual coming in Phase 5 (Rack View).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rack_layout.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No racks defined and no devices placed. Add racks under Requirements to enable
              placement.
            </p>
          ) : (
            <div className="space-y-3">
              {rack_layout.map((r, i) => (
                <RackBlock key={i} rack={r} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Small presentational helpers
// ────────────────────────────────────────────────────────────────────

function Kv({
  k,
  v,
  wide,
  note,
  highlight
}: {
  k: string
  v: string
  wide?: boolean
  note?: string
  highlight?: boolean
}) {
  return (
    <div className={cn('space-y-0.5', wide && 'md:col-span-2')}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
      <div
        className={cn(
          'font-medium',
          highlight && 'text-emerald-700 dark:text-emerald-300 text-base'
        )}
      >
        {v}
      </div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  )
}

function TierStatusBadge({ status }: { status: 'ok' | 'empty' | 'both-set' | 'no-model' | 'unknown-model' }) {
  if (status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200 text-xs font-medium px-1.5 py-0.5">
        ok
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-destructive/10 text-destructive text-xs font-medium px-1.5 py-0.5">
      {status}
    </span>
  )
}

function RackBlock({ rack }: { rack: RackPlacement }) {
  const used = rack.devices.reduce((acc, d) => acc + d.ru, 0)
  return (
    <div
      className={cn(
        'border rounded-md p-3',
        rack.over_budget && 'border-destructive/60 bg-destructive/5'
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="font-medium text-sm">{rack.rack_name}</div>
          <div className="text-xs text-muted-foreground">
            {used}/{rack.size_u} U · {rack.devices.length} devices ·{' '}
            {Math.round(rack.estimated_power_w / 100) / 10} kW
            {rack.pdu_kw_budget != null && ` / ${rack.pdu_kw_budget} kW budget`}
          </div>
        </div>
        {rack.over_budget && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
            <AlertTriangle className="size-3.5" />
            Over budget
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {rack.devices.map((d, i) => (
          <span
            key={i}
            className={cn(
              'inline-flex items-center gap-1 rounded text-xs font-mono px-1.5 py-0.5',
              d.role === 'spine'
                ? 'bg-violet-100 text-violet-900 dark:bg-violet-950/60 dark:text-violet-200'
                : d.role === 'leaf'
                  ? 'bg-sky-100 text-sky-900 dark:bg-sky-950/60 dark:text-sky-200'
                  : 'bg-muted text-muted-foreground'
            )}
            title={`U${d.start_u}–U${d.start_u + d.ru - 1} · ${d.model_id}`}
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Candidate matrix — Multi-Pod ACI comparison cards (Phase 9b)
// ────────────────────────────────────────────────────────────────────

const CANDIDATE_ORDER: CandidateId[] = [
  'single_no_breakout',
  'single_with_breakout',
  'multi_no_breakout',
  'multi_with_breakout'
]

const CANDIDATE_LABELS: Record<CandidateId, { pod: string; breakout: string }> = {
  single_no_breakout: { pod: 'Single-pod', breakout: 'No breakout' },
  single_with_breakout: { pod: 'Single-pod', breakout: 'With breakout' },
  multi_no_breakout: { pod: 'Multi-Pod', breakout: 'No breakout' },
  multi_with_breakout: { pod: 'Multi-Pod', breakout: 'With breakout' }
}

function CandidateMatrix({
  result,
  switchById,
  committing,
  onCommit
}: {
  result: DesignResult
  switchById: Map<string, Switch>
  committing: CandidateId | null
  onCommit(id: CandidateId): void
}) {
  const byId = new Map(result.candidates.map((c) => [c.id, c]))
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Design candidates</CardTitle>
        <CardDescription>
          The solver computes all four strategies in parallel. The{' '}
          <span className="font-medium">primary</span> is the simplest valid one; commit a different
          candidate to drive the Rack, Links, and Topology views.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {CANDIDATE_ORDER.map((id) => {
            const c = byId.get(id)
            if (!c) return null
            return (
              <CandidateCard
                key={id}
                candidate={c}
                isPrimary={id === result.primary_candidate_id}
                isCommitted={id === result.committed_candidate_id}
                committing={committing === id}
                committeeBusy={committing != null}
                onCommit={() => onCommit(id)}
                switchById={switchById}
              />
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function CandidateCard({
  candidate: c,
  isPrimary,
  isCommitted,
  committing,
  committeeBusy,
  onCommit,
  switchById
}: {
  candidate: DesignCandidate
  isPrimary: boolean
  isCommitted: boolean
  committing: boolean
  committeeBusy: boolean
  onCommit(): void
  switchById: Map<string, Switch>
}) {
  const labels = CANDIDATE_LABELS[c.id]
  const pods = c.multipod?.pods_needed ?? 1
  const blocker = c.warnings.find((w) => w.severity === 'error') ?? null
  const spineModel = c.spine ? switchById.get(c.spine.spine_model_id) : null
  return (
    <div
      className={cn(
        'rounded-lg border p-3 space-y-2.5 transition-colors',
        isCommitted
          ? 'border-primary ring-1 ring-primary bg-primary/5'
          : c.valid
            ? 'border-emerald-200 dark:border-emerald-900/60'
            : 'border-border bg-muted/20'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-sm flex items-center gap-1.5">
            {c.pod_variant === 'multi' && <Network className="size-3.5 text-muted-foreground" />}
            {labels.pod}
          </div>
          <div className="text-xs text-muted-foreground">{labels.breakout}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {c.valid ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200 text-[10px] font-medium px-2 py-0.5">
              <CheckCircle2 className="size-3" />
              Valid
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive text-[10px] font-medium px-2 py-0.5">
              <XCircle className="size-3" />
              Invalid
            </span>
          )}
          {isPrimary && (
            <span className="rounded-full bg-violet-100 text-violet-900 dark:bg-violet-950/60 dark:text-violet-200 text-[10px] font-medium px-2 py-0.5">
              Primary
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <CandKv k="Pods" v={String(pods)} />
        <CandKv k="Spines" v={`${c.total_spines}${pods > 1 ? ` (${c.multipod?.spines_per_pod}/pod)` : ''}`} />
        <CandKv k="IPN routers" v={String(c.total_ipn_routers)} />
        <CandKv k="Oversub" v={c.computed_oversub_label} />
        {c.multipod && (
          <>
            <CandKv k="Leaf split" v={c.multipod.leaves_per_pod.join(' / ')} />
            <CandKv k="Spine↔IPN" v={`${c.multipod.spine_to_ipn_links} cables`} />
          </>
        )}
        <CandKv k="Host BW" v={`${c.total_host_bw_g} G`} />
        <CandKv k="Uplink BW" v={`${c.total_uplink_bw_g} G`} />
      </div>

      {spineModel && (
        <div className="text-[11px] text-muted-foreground font-mono truncate">
          spine {c.spine?.spine_model_id}
          {c.multipod?.ipn_router_model_id && ` · ipn ${c.multipod.ipn_router_model_id}`}
        </div>
      )}

      {!c.valid && blocker && (
        <div className="text-[11px] text-destructive flex items-start gap-1">
          <AlertTriangle className="size-3 mt-0.5 shrink-0" />
          <span>{blocker.message}</span>
        </div>
      )}

      <div className="pt-1">
        {isCommitted ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
            <GitFork className="size-3.5" />
            Committed — active design
          </span>
        ) : (
          <Button
            size="sm"
            variant={c.valid ? 'default' : 'outline'}
            className="h-7 text-xs"
            disabled={committeeBusy}
            onClick={onCommit}
          >
            {committing ? <Loader2 className="animate-spin" /> : null}
            Commit this candidate
          </Button>
        )}
      </div>
    </div>
  )
}

function CandKv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium text-right">{v}</span>
    </div>
  )
}

// Re-export for tests / future consumers (keeps the file self-contained)
export type { WarningCode }
