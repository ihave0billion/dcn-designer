import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Play, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
  loadBreakoutPairs,
  loadCableLinks,
  loadPatchPanels,
  loadSwitchesFile,
  saveCableLinks
} from '@/lib/library-io'
import { runSolver } from '@/lib/solver-bridge'
import { seedCableLinks } from '@/lib/cable-links-seeder'
import { useWorkspace } from '@/state/WorkspaceContext'
import type {
  DesignResult,
  RackPlacement,
  SolverWarning,
  WarningCode
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
  const [result, setResult] = useState<DesignResult | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genErr, setGenErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Load library + any prior design.yaml on mount
  useEffect(() => {
    let cancelled = false
    if (!workspacePath) return
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
      })()
    ]).then(([sw, prior]) => {
      if (cancelled) return
      setSwitches(sw)
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

  // ── Generate Design ───────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!workspacePath) return
    setGenerating(true)
    setGenErr(null)
    try {
      const breakoutPairs = await loadBreakoutPairs(workspacePath)
      const design = runSolver({ requirements, switches, breakoutPairs })
      await window.dcn.writeYaml(`${projectPath}/design.yaml`, design)
      setResult(design)
      // Auto-seed cable_links.yaml when no user fork exists. Mirrors the
      // Phase 5 rack_mapping fork pattern — once the user edits links,
      // source flips to 'user' and Generate stops touching the file.
      try {
        const existing = await loadCableLinks(projectPath)
        if (existing == null || existing.source === 'solver') {
          const patchPanels = await loadPatchPanels(workspacePath)
          const seeded = seedCableLinks({
            design,
            switches,
            fabric: {
              uplinks_per_leaf: requirements.fabric.uplinks_per_leaf,
              uplinks_per_spine: requirements.fabric.uplinks_per_spine
            },
            breakoutPairs,
            patchPanels
          })
          await saveCableLinks(projectPath, {
            schema_version: 1,
            source: 'solver',
            seeded_at: new Date().toISOString(),
            forked_at: null,
            links: seeded.links
          })
        }
      } catch (seedErr) {
        // Don't block the design save on a seed failure — surface it.
        // eslint-disable-next-line no-console
        console.warn('[cable-links seed] failed:', seedErr)
      }
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }, [workspacePath, projectPath, requirements, switches])

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
  const { summary, tiers, spine, breakout, warnings, rack_layout, optics_bom } = result
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

function StatusPill({ valid }: { valid: boolean }) {
  return valid ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200 text-xs font-medium px-2.5 py-1">
      <CheckCircle2 className="size-3.5" />
      Design valid
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 text-destructive text-xs font-medium px-2.5 py-1">
      <XCircle className="size-3.5" />
      Design invalid
    </span>
  )
}

function SeverityBadge({ severity }: { severity: SolverWarning['severity'] }) {
  if (severity === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-destructive/10 text-destructive text-xs font-medium px-1.5 py-0.5">
        <XCircle className="size-3" />
        error
      </span>
    )
  }
  if (severity === 'warn') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 text-xs font-medium px-1.5 py-0.5">
        <AlertTriangle className="size-3" />
        warn
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-muted text-muted-foreground text-xs font-medium px-1.5 py-0.5">
      info
    </span>
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

// Re-export for tests / future consumers (keeps the file self-contained)
export type { WarningCode }
