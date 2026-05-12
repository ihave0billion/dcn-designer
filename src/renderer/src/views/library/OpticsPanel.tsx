import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
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
import { loadSwitchesFile } from '@/lib/library-io'
import type { DcnOpticsIndexEntry } from '../../../../preload/types'
import type { Switch } from '@/schemas/switches'
import { OpticsUploadDialog } from './OpticsUploadDialog'
import { OpticsDetailView } from './OpticsDetailView'

export function OpticsPanel() {
  const { workspacePath } = useWorkspace()
  const [entries, setEntries] = useState<DcnOpticsIndexEntry[]>([])
  const [switches, setSwitches] = useState<Switch[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [openSwitchId, setOpenSwitchId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<DcnOpticsIndexEntry | null>(null)
  const [query, setQuery] = useState('')

  const refresh = useCallback(async () => {
    if (!workspacePath) return
    setLoading(true)
    setErr(null)
    try {
      const [opticsEntries, swFile] = await Promise.all([
        window.dcn.listOptics(workspacePath),
        loadSwitchesFile(workspacePath)
      ])
      setEntries(opticsEntries)
      setSwitches(swFile.switches)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  useEffect(() => {
    refresh()
  }, [refresh])

  const switchById = useMemo(() => new Map(switches.map((s) => [s.id, s])), [switches])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) => {
      const sw = switchById.get(e.switch_id)
      return (
        e.switch_id.toLowerCase().includes(q) ||
        (sw?.model_display ?? '').toLowerCase().includes(q) ||
        (e.source_csv ?? '').toLowerCase().includes(q)
      )
    })
  }, [entries, switchById, query])

  async function handleDelete() {
    if (!workspacePath || !deleting) return
    try {
      await window.dcn.deleteOptics(workspacePath, deleting.switch_id)
      setDeleting(null)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  if (openSwitchId) {
    return (
      <OpticsDetailView
        switchId={openSwitchId}
        switches={switches}
        onBack={() => {
          setOpenSwitchId(null)
          refresh()
        }}
        onReuploadComplete={refresh}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <Input
          placeholder="Filter by switch id, model, or source file…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex-1" />
        <Button onClick={() => setUploadOpen(true)}>
          <Upload />
          Upload optics CSV
        </Button>
      </div>

      {err && <div className="text-sm text-destructive">{err}</div>}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : entries.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">No optics imported yet</CardTitle>
            <CardDescription>
              Each switch has its own optics file in{' '}
              <code className="font-mono text-xs">library/optics/&lt;switch-id&gt;.yaml</code>,
              populated by uploading a Cisco TMG optics CSV (export from the Cisco
              Transceiver Module Group compatibility matrix, per switch).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setUploadOpen(true)}>
              <Upload />
              Upload optics CSV
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Switch</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Optics</TableHead>
                <TableHead>Source CSV</TableHead>
                <TableHead>Imported</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No optics match.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((e) => {
                  const sw = switchById.get(e.switch_id)
                  return (
                    <TableRow
                      key={e.switch_id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setOpenSwitchId(e.switch_id)}
                    >
                      <TableCell className="font-mono text-xs">{e.switch_id}</TableCell>
                      <TableCell className="text-sm">
                        {sw?.model_display ?? <span className="text-muted-foreground italic">not in library</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{e.optic_count}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {e.source_csv ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {e.imported_at ? new Date(e.imported_at).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={(ev) => {
                              ev.stopPropagation()
                              setDeleting(e)
                            }}
                            aria-label="Delete"
                          >
                            <Trash2 />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={(ev) => {
                              ev.stopPropagation()
                              setOpenSwitchId(e.switch_id)
                            }}
                            aria-label="Open"
                          >
                            <ChevronRight />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        {entries.length} switch{entries.length === 1 ? '' : 'es'} with optics imported
      </div>

      <OpticsUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        switches={switches}
        existingEntries={entries}
        onDone={(switchId) => {
          setUploadOpen(false)
          refresh().then(() => setOpenSwitchId(switchId))
        }}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete optics file?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes{' '}
              <code className="font-mono">library/optics/{deleting?.switch_id}.yaml</code>{' '}
              ({deleting?.optic_count} optic{deleting?.optic_count === 1 ? '' : 's'}). The switch
              entry itself is not affected. You can re-upload a CSV at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
