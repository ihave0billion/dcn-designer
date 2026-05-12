import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
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
import type { Switch } from '@/schemas/switches'
import { loadSwitchesFile, saveSwitches } from '@/lib/library-io'
import { SwitchEditDialog } from './SwitchEditDialog'

export function SwitchesPanel() {
  const { workspacePath } = useWorkspace()
  const [switches, setSwitches] = useState<Switch[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<Switch | null>(null)
  const [deleting, setDeleting] = useState<Switch | null>(null)
  const [query, setQuery] = useState('')

  const refresh = useCallback(async () => {
    if (!workspacePath) return
    setLoading(true)
    setErr(null)
    try {
      const file = await loadSwitchesFile(workspacePath)
      setSwitches(file.switches)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  useEffect(() => { refresh() }, [refresh])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return switches
    return switches.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.model_display.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
    )
  }, [switches, query])

  const existingIds = useMemo(() => new Set(switches.map((s) => s.id)), [switches])

  async function handleSave(updated: Switch) {
    if (!workspacePath) return
    const isEdit = editing !== null
    const next = isEdit
      ? switches.map((s) => (s.id === editing!.id ? updated : s))
      : [...switches, updated]
    await saveSwitches(workspacePath, next)
    setSwitches(next)
  }

  async function handleDelete() {
    if (!workspacePath || !deleting) return
    const next = switches.filter((s) => s.id !== deleting.id)
    try {
      await saveSwitches(workspacePath, next)
      setSwitches(next)
      setDeleting(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="Filter by id, name, or category…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex-1" />
        <Button onClick={() => { setEditing(null); setEditOpen(true) }}>
          <Plus />
          Add switch
        </Button>
      </div>

      {err && <div className="text-sm text-destructive">{err}</div>}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Primary</TableHead>
                <TableHead>Uplink</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No switches match.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.id}</TableCell>
                    <TableCell className="capitalize">{s.role}</TableCell>
                    <TableCell>{s.category}</TableCell>
                    <TableCell className="text-xs">
                      {s.primary.ports}× {s.primary.speed_g}G
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.uplink ? `${s.uplink.ports}× ${s.uplink.speed_g}G` : '—'}
                    </TableCell>
                    <TableCell>
                      <span className={
                        s.availability === 'available' ? 'text-foreground' :
                        s.availability === 'future' ? 'text-muted-foreground' : 'text-destructive'
                      }>
                        {s.availability}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => { setEditing(s); setEditOpen(true) }}
                          aria-label="Edit"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeleting(s)}
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
        {switches.length} total · {filtered.length} shown
      </div>

      <SwitchEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={editing}
        existingIds={existingIds}
        onSave={handleSave}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete switch?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <code className="font-mono">{deleting?.id}</code> from{' '}
              <code>library/switches.yaml</code>. This cannot be undone via the UI (you can edit
              the YAML directly to restore).
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
