import { useCallback, useEffect, useState } from 'react'
import { Download, FileText, Loader2, RefreshCw } from 'lucide-react'
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
import { useWorkspace } from '@/state/WorkspaceContext'
import type { RequirementsFile } from '@/schemas/project'
import type { Switch } from '@/schemas/switches'
import type { CableLink } from '@/schemas/cable-links'
import type { DcnExportEntry } from '../../../../preload/types'
import type { DesignResult } from '@domain'
import { loadCableLinks, loadSwitchesFile } from '@/lib/library-io'
import { extractTopology } from '@/lib/topology-extractor'
import { buildCableBom } from '@/lib/cable-bom'
import { buildDeviceBom } from '@/lib/device-bom'
import { exportFileName, renderDesignReportPdf } from '@/lib/pdf/render'

// Phase 9 — the Export tab.
//
// Exporting does two things: it archives the PDF into the project's exports/
// directory (so the workspace stays self-describing and portable between the
// desktop app and the self-hosted web build), and it optionally saves a copy
// wherever the user wants. In the browser that second step is a download,
// since there is no host path to write to — see the DOWNLOAD_PREFIX contract
// in lib/http-dcn.ts.

interface ExportViewProps {
  requirements: RequirementsFile
  projectPath: string
  onGoToDesign(): void
}

const SECTIONS = [
  'Cover — project, customer, site, date',
  'Requirements summary + port requirements',
  'Design summary, tiers, and the candidate matrix',
  'Bill of materials — switches, optics, cables',
  'Rack layout diagrams',
  'Topology diagram',
  'Optics scenario notes',
  'Warnings'
]

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

export function ExportView({ requirements, projectPath, onGoToDesign }: ExportViewProps) {
  const { workspacePath } = useWorkspace()
  const [design, setDesign] = useState<DesignResult | null>(null)
  const [links, setLinks] = useState<CableLink[]>([])
  const [switches, setSwitches] = useState<Switch[]>([])
  const [loaded, setLoaded] = useState(false)
  const [exports, setExports] = useState<DcnExportEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<string | null>(null)

  const refreshExports = useCallback(async () => {
    try {
      setExports(await window.dcn.listExports(projectPath))
    } catch {
      // A project that has never been exported has no exports/ dir — not an error.
      setExports([])
    }
  }, [projectPath])

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
    void refreshExports()
    return () => {
      cancelled = true
    }
  }, [workspacePath, projectPath, refreshExports])

  const build = useCallback(async (): Promise<{ bytes: Uint8Array; name: string }> => {
    if (!design) throw new Error('No design to export')
    const generatedAt = new Date().toISOString()
    const bytes = await renderDesignReportPdf({
      requirements,
      design,
      links,
      switches,
      topology: extractTopology(design, links),
      generatedAt
    })
    return { bytes, name: exportFileName(requirements.project.name, generatedAt) }
  }, [design, links, requirements, switches])

  const handleExport = useCallback(async () => {
    setBusy(true)
    setErr(null)
    setLastSaved(null)
    try {
      const { bytes, name } = await build()
      const dest = `${projectPath}/exports/${name}`
      await window.dcn.writeBinaryFile(dest, bytes)
      setLastSaved(dest)
      await refreshExports()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [build, projectPath, refreshExports])

  const handleSaveCopy = useCallback(async () => {
    setBusy(true)
    setErr(null)
    try {
      const { bytes, name } = await build()
      const target = await window.dcn.showSavePdfPicker('Export design PDF', name)
      if (!target) return
      await window.dcn.writeBinaryFile(target, bytes)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [build])

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
              The PDF is built from <code className="font-mono">design.yaml</code> +{' '}
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

  const deviceBom = buildDeviceBom(design, switches)
  const cableBom = buildCableBom({ links, cable_tray_m: requirements.cable_tray_m })

  return (
    <div className="p-6 space-y-4 overflow-auto h-full">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export design PDF</CardTitle>
          <CardDescription>
            A print-ready report of the committed design. Saved into this project&apos;s{' '}
            <code className="font-mono">exports/</code> folder so it travels with the workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleExport} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <FileText />}
              {busy ? 'Rendering…' : 'Export PDF'}
            </Button>
            <Button variant="outline" onClick={handleSaveCopy} disabled={busy}>
              <Download />
              Save a copy…
            </Button>
          </div>

          {err && <p className="text-sm text-destructive">{err}</p>}
          {lastSaved && (
            <p className="text-sm text-muted-foreground">
              Saved to <span className="font-mono">{lastSaved}</span>
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-medium mb-1">Sections</h3>
              <ul className="text-sm text-muted-foreground space-y-0.5">
                {SECTIONS.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-medium mb-1">What it will contain</h3>
              <ul className="text-sm text-muted-foreground space-y-0.5">
                <li>
                  {deviceBom.total_devices} devices · {deviceBom.total_ru} RU ·{' '}
                  {deviceBom.total_power_w.toLocaleString()} W
                  {deviceBom.has_estimated_power ? ' (est.)' : ''}
                </li>
                <li>{design.optics_bom.length} optics BOM rows</li>
                <li>
                  {cableBom.costed_links} of {cableBom.total_links} cables costed ·{' '}
                  {cableBom.total_ordered_m.toLocaleString()} m total
                </li>
                <li>{design.warnings.length} solver warnings</li>
              </ul>
              {cableBom.unresolved.length > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                  Some cables could not be costed — see the Cables section of the PDF.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Recent exports</CardTitle>
            <CardDescription>Files in this project&apos;s exports/ folder.</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void refreshExports()}>
            <RefreshCw />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {exports.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing exported yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exports.map((e) => (
                  <TableRow key={e.path}>
                    <TableCell className="font-mono text-xs">{e.name}</TableCell>
                    <TableCell className="text-sm">{formatWhen(e.created)}</TableCell>
                    <TableCell className="text-right text-sm">
                      {formatBytes(e.size_bytes)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
