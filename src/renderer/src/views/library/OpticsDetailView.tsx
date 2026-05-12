import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ExternalLink, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { loadOpticsFile, saveOpticsFile } from '@/lib/library-io'
import type { Switch } from '@/schemas/switches'
import type { Optic, OpticsFile } from '@/schemas/optics'
import { OpticEditDialog } from './OpticEditDialog'
import { OpticsUploadDialog } from './OpticsUploadDialog'
import type { DcnOpticsIndexEntry } from '../../../../preload/types'

interface OpticsDetailViewProps {
  switchId: string
  switches: Switch[]
  onBack(): void
  onReuploadComplete(): void
}

export function OpticsDetailView({ switchId, switches, onBack, onReuploadComplete }: OpticsDetailViewProps) {
  const { workspacePath } = useWorkspace()
  const [file, setFile] = useState<OpticsFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Optic | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState<Optic | null>(null)
  const [reuploadOpen, setReuploadOpen] = useState(false)

  const sw = switches.find((s) => s.id === switchId)

  const refresh = useCallback(async () => {
    if (!workspacePath) return
    setLoading(true)
    setErr(null)
    try {
      const f = await loadOpticsFile(workspacePath, switchId)
      setFile(f)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [workspacePath, switchId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const existingIds = useMemo(
    () => new Set(file?.optics.map((o) => o.id) ?? []),
    [file]
  )

  const filtered = useMemo(() => {
    if (!file) return []
    const q = query.trim().toLowerCase()
    if (!q) return file.optics
    return file.optics.filter(
      (o) =>
        o.id.toLowerCase().includes(q) ||
        (o.family ?? '').toLowerCase().includes(q) ||
        (o.form_factor ?? '').toLowerCase().includes(q) ||
        (o.media ?? '').toLowerCase().includes(q) ||
        (o.standard ?? '').toLowerCase().includes(q) ||
        (o.reach ?? '').toLowerCase().includes(q)
    )
  }, [file, query])

  async function handleSave(updated: Optic) {
    if (!workspacePath || !file) return
    const isEdit = editing !== null
    const next: Optic[] = isEdit
      ? file.optics.map((o) => (o.id === editing!.id ? updated : o))
      : [...file.optics, updated]
    await saveOpticsFile(workspacePath, switchId, next, file.source_csv, file.imported_at)
    setFile({ ...file, optics: next })
  }

  async function handleDelete() {
    if (!workspacePath || !file || !deleting) return
    const next = file.optics.filter((o) => o.id !== deleting.id)
    try {
      await saveOpticsFile(workspacePath, switchId, next, file.source_csv, file.imported_at)
      setFile({ ...file, optics: next })
      setDeleting(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const existingEntry: DcnOpticsIndexEntry | null = file
    ? {
        switch_id: file.switch_id,
        source_csv: file.source_csv,
        imported_at: file.imported_at,
        optic_count: file.optics.length
      }
    : null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft />
          All optics
        </Button>
        <div className="flex-1" />
        <Button variant="outline" onClick={() => setReuploadOpen(true)}>
          <RefreshCw />
          Re-upload CSV
        </Button>
        <Button
          onClick={() => {
            setEditing(null)
            setEditOpen(true)
          }}
        >
          <Plus />
          Add optic
        </Button>
      </div>

      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          <span className="font-mono">{switchId}</span>
          {sw && <span className="ml-2 text-base text-muted-foreground">· {sw.model_display}</span>}
        </h2>
        {file && (
          <p className="text-xs text-muted-foreground mt-1">
            {file.optics.length} optic{file.optics.length === 1 ? '' : 's'}
            {file.source_csv && (
              <>
                {' '}· imported from <code className="font-mono">{file.source_csv}</code>
              </>
            )}
            {file.imported_at && (
              <> · {new Date(file.imported_at).toLocaleString()}</>
            )}
          </p>
        )}
      </div>

      {err && <div className="text-sm text-destructive">{err}</div>}

      <div className="flex gap-2">
        <Input
          placeholder="Filter by PID, family, media, reach, standard…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PID</TableHead>
                <TableHead>Family</TableHead>
                <TableHead>Form factor</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Reach</TableHead>
                <TableHead>Media</TableHead>
                <TableHead>Connector</TableHead>
                <TableHead>OS</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No optics match.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">
                      <span className="flex items-center gap-1">
                        {o.id}
                        {o.eos && (
                          <span className="text-destructive text-[10px] uppercase">EoS</span>
                        )}
                        {o.data_sheet_url && (
                          <a
                            href={o.data_sheet_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(e) => e.stopPropagation()}
                            aria-label="Data sheet"
                          >
                            <ExternalLink className="size-3" />
                          </a>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{o.family ?? '—'}</TableCell>
                    <TableCell className="text-xs">{o.form_factor ?? '—'}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      {o.data_rate_g ? `${o.data_rate_g}G` : o.data_rate_raw ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs">{o.reach ?? '—'}</TableCell>
                    <TableCell className="text-xs">{o.media ?? '—'}</TableCell>
                    <TableCell className="text-xs">{o.connector_type ?? '—'}</TableCell>
                    <TableCell className="text-xs">
                      {o.os_support.length === 0
                        ? '—'
                        : o.os_support.map((s) => s.os).join(' · ')}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setEditing(o)
                            setEditOpen(true)
                          }}
                          aria-label="Edit"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeleting(o)}
                          aria-label="Delete"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        {file?.optics.length ?? 0} total · {filtered.length} shown
      </div>

      <OpticEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={editing}
        existingIds={existingIds}
        onSave={handleSave}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete optic?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <code className="font-mono">{deleting?.id}</code> from{' '}
              <code className="font-mono">library/optics/{switchId}.yaml</code>. Re-uploading the
              source CSV will restore it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <OpticsUploadDialog
        open={reuploadOpen}
        onOpenChange={setReuploadOpen}
        switches={switches}
        existingEntries={existingEntry ? [existingEntry] : []}
        onDone={() => {
          setReuploadOpen(false)
          refresh()
          onReuploadComplete()
        }}
      />
    </div>
  )
}
