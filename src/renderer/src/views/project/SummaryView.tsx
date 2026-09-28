import { useEffect, useState } from 'react'
import { ArrowRight, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/state/WorkspaceContext'
import type { RequirementsFile } from '@/schemas/project'
import type { Switch } from '@/schemas/switches'
import type { CableLink } from '@/schemas/cable-links'
import type { DesignResult } from '@domain'
import { loadCableLinks, loadSwitchesFile } from '@/lib/library-io'
import { buildDeviceBom } from '@/lib/device-bom'
import { buildCableBom, cableKindLabel } from '@/lib/cable-bom'
import { findCandidate } from '@/lib/design-projection'
import { SeverityBadge, StatusPill } from '@/components/design-status'

// Phase 10 — the Summary tab. One screen that answers "what is this design
// and can I ship it": headline counts, validation verdict, and the same BOM
// totals the PDF prints — built from the same modules (device-bom /
// cable-bom), so the screen and the report can never disagree.

interface SummaryViewProps {
  requirements: RequirementsFile
  projectPath: string
  onGoToDesign(): void
  onGoToExport(): void
}

const CANDIDATE_LABELS: Record<string, string> = {
  single_no_breakout: 'Single pod',
  single_with_breakout: 'Single pod + breakout',
  multi_no_breakout: 'Multi-pod',
  multi_with_breakout: 'Multi-pod + breakout'
}

export function SummaryView({
  requirements,
  projectPath,
  onGoToDesign,
  onGoToExport
}: SummaryViewProps) {
  const { workspacePath } = useWorkspace()
  const [design, setDesign] = useState<DesignResult | null>(null)
  const [links, setLinks] = useState<CableLink[]>([])
  const [switches, setSwitches] = useState<Switch[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!workspacePath) return
    setLoaded(false)
    Promise.all([
      window.dcn
        .fileExists(`${projectPath}/design.yaml`)
        .then((exists) =>
          exists ? (window.dcn.readYaml(`${projectPath}/design.yaml`) as Promise<DesignResult>) : null
        )
        .catch(() => null),
      loadCableLinks(projectPath).catch(() => null),
      loadSwitchesFile(workspacePath)
        .then((f) => f.switches)
        .catch(() => [] as Switch[])
    ]).then(([d, linkFile, sw]) => {
      if (cancelled) return
      setDesign(d)
      setLinks(linkFile?.links ?? [])
      setSwitches(sw)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [workspacePath, projectPath])

  if (!loaded) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  }

  if (!design) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8 space-y-3 text-center">
            <h2 className="text-base font-semibold">No design yet</h2>
            <p className="text-sm text-muted-foreground">
              The summary reads <code className="font-mono">design.yaml</code>. Run{' '}
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

  const { summary, warnings } = design
  const errors = warnings.filter((w) => w.severity === 'error')
  const warns = warnings.filter((w) => w.severity === 'warn')
  const infos = warnings.filter((w) => w.severity === 'info')

  const committed = findCandidate(design, design.committed_candidate_id)
  const committedLabel =
    CANDIDATE_LABELS[design.committed_candidate_id] ?? design.committed_candidate_id
  const podCount = committed?.multipod?.pods_needed ?? 1
  const ipnCount = committed?.total_ipn_routers ?? 0

  const deviceBom = buildDeviceBom(design, switches)
  const cableBom = buildCableBom({ links, cable_tray_m: requirements.cable_tray_m })
  const rackCount = design.rack_layout.length

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Verdict */}
        <Card
          className={cn(
            summary.valid
              ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/60 dark:bg-emerald-950/20'
              : 'border-destructive/40 bg-destructive/5'
          )}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {requirements.project.name} — {committedLabel}
              </CardTitle>
              <StatusPill valid={summary.valid} />
            </div>
            <CardDescription>
              Committed candidate: <span className="font-mono text-xs">{design.committed_candidate_id}</span>
              {' · '}
              {errors.length} error{errors.length === 1 ? '' : 's'}, {warns.length} warning
              {warns.length === 1 ? '' : 's'}, {infos.length} info
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Stat k="Spines" v={String(summary.total_spines)} />
              <Stat k="Leaves" v={String(summary.total_leaves)} />
              <Stat k="Pods" v={String(podCount)} />
              <Stat k="IPN routers" v={ipnCount > 0 ? String(ipnCount) : '—'} />
              <Stat k="Racks" v={String(rackCount)} />
              <Stat k="Cable links" v={String(cableBom.total_links)} />
              <Stat k="Host bandwidth" v={`${summary.total_host_bw_g.toLocaleString()} G`} />
              <Stat k="Oversubscription" v={summary.computed_oversub_label} />
            </div>
          </CardContent>
        </Card>

        {/* Hardware BOM */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Hardware</CardTitle>
            <CardDescription>
              {deviceBom.total_devices} devices · {deviceBom.total_ru} RU ·{' '}
              {deviceBom.total_power_w.toLocaleString()} W
              {deviceBom.has_estimated_power ? ' †' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Role</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="w-20 text-right">Count</TableHead>
                    <TableHead className="w-20 text-right">RU</TableHead>
                    <TableHead className="w-28 text-right">Power (W)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deviceBom.rows.map((r) => (
                    <TableRow key={`${r.role}:${r.model_id}`}>
                      <TableCell className="capitalize">{r.role}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.model_id}
                        {r.unknown_model && (
                          <span className="ml-2 text-destructive font-sans">not in library</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell className="text-right">{r.ru_total}</TableCell>
                      <TableCell className="text-right">
                        {r.power_w_total.toLocaleString()}
                        {r.power_estimated ? ' †' : ''}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {deviceBom.has_estimated_power && (
              <p className="text-xs text-muted-foreground">
                † estimated — the library has no power figure for this model; totals assume the
                default per-switch draw. Fill in <span className="font-mono">power_w</span> in the
                Library for datasheet numbers.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Cables + optics */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Cables</CardTitle>
              <CardDescription>
                {cableBom.costed_links} of {cableBom.total_links} links costed ·{' '}
                {cableBom.total_ordered_m.toLocaleString()} m ordered
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {cableBom.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No cable links yet — seed them from the Links tab.
                </p>
              ) : (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">Length</TableHead>
                        <TableHead className="w-32">Kind</TableHead>
                        <TableHead className="w-20">Speed</TableHead>
                        <TableHead>Media</TableHead>
                        <TableHead className="w-20 text-right">Count</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cableBom.rows.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{r.ordered_length_m} m</TableCell>
                          <TableCell className="text-xs">{cableKindLabel(r.kind)}</TableCell>
                          <TableCell>{r.speed_g} G</TableCell>
                          <TableCell className="uppercase text-xs">{r.media}</TableCell>
                          <TableCell className="text-right">{r.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {cableBom.unresolved.length > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  {cableBom.unresolved.reduce((a, u) => a + u.count, 0)} link(s) could not be
                  costed — set a cable-tray distance in Requirements or a per-link length.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Optics</CardTitle>
              <CardDescription>{design.optics_bom.length} BOM rows</CardDescription>
            </CardHeader>
            <CardContent>
              {design.optics_bom.length === 0 ? (
                <p className="text-sm text-muted-foreground">No optics in this design.</p>
              ) : (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Optic</TableHead>
                        <TableHead className="w-16">End</TableHead>
                        <TableHead className="w-20 text-right">Qty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {design.optics_bom.map((o, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{o.optic_id}</TableCell>
                          <TableCell className="capitalize text-xs">{o.location}</TableCell>
                          <TableCell className="text-right">{o.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Validation detail */}
        {warnings.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Validation ({errors.length} error, {warns.length} warn, {infos.length} info)
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

        <div className="flex justify-end gap-2 pb-2">
          <Button variant="outline" onClick={onGoToDesign}>
            Review design
            <ArrowRight />
          </Button>
          <Button onClick={onGoToExport}>
            <FileText />
            Export PDF
          </Button>
        </div>
      </div>
    </div>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className="font-medium tabular-nums">{v}</div>
    </div>
  )
}
