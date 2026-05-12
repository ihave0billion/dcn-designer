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
import type { Server } from '@/schemas/servers'
import { loadServersFile, saveServers } from '@/lib/library-io'
import { ServerEditDialog } from './ServerEditDialog'

export function ServersPanel() {
  const { workspacePath } = useWorkspace()
  const [servers, setServers] = useState<Server[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<Server | null>(null)
  const [deleting, setDeleting] = useState<Server | null>(null)
  const [query, setQuery] = useState('')

  const refresh = useCallback(async () => {
    if (!workspacePath) return
    setLoading(true)
    setErr(null)
    try {
      const file = await loadServersFile(workspacePath)
      setServers(file.servers)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  useEffect(() => { refresh() }, [refresh])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return servers
    return servers.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.model_display.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
    )
  }, [servers, query])

  const existingIds = useMemo(() => new Set(servers.map((s) => s.id)), [servers])

  async function handleSave(updated: Server) {
    if (!workspacePath) return
    const isEdit = editing !== null
    const next = isEdit
      ? servers.map((s) => (s.id === editing!.id ? updated : s))
      : [...servers, updated]
    await saveServers(workspacePath, next)
    setServers(next)
  }

  async function handleDelete() {
    if (!workspacePath || !deleting) return
    const next = servers.filter((s) => s.id !== deleting.id)
    try {
      await saveServers(workspacePath, next)
      setServers(next)
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
          Add server
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
                <TableHead>Category</TableHead>
                <TableHead>RU</TableHead>
                <TableHead>NIC ports</TableHead>
                <TableHead>GPU</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No servers match.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.id}</TableCell>
                    <TableCell>{s.category}</TableCell>
                    <TableCell>{s.ru ?? '—'}</TableCell>
                    <TableCell className="text-xs">
                      {s.ports.map((p) => `${p.count}× ${p.speed_g}G`).join(' + ')}
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.gpu ? `${s.gpu.count}× ${s.gpu.model}` : '—'}
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
        {servers.length} total · {filtered.length} shown
      </div>

      <ServerEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={editing}
        existingIds={existingIds}
        onSave={handleSave}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete server?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <code className="font-mono">{deleting?.id}</code> from{' '}
              <code>library/servers.yaml</code>. This cannot be undone via the UI.
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
