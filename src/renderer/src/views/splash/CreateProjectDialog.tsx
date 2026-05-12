import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  workspacePath: string
  onCreated(projectPath: string): void
}

export function CreateProjectDialog({ open, onOpenChange, workspacePath, onCreated }: CreateProjectDialogProps) {
  const [name, setName] = useState('')
  const [customer, setCustomer] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const path = await window.dcn.createProject(workspacePath, name.trim(), customer.trim())
      onCreated(path)
      setName('')
      setCustomer('')
      onOpenChange(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create new project</DialogTitle>
          <DialogDescription>
            A folder will be created in your workspace under <code>projects/&lt;name&gt;</code>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="proj-name">Project name</Label>
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="acme-pod-1"
              autoFocus
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proj-customer">Customer (optional)</Label>
            <Input
              id="proj-customer"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="ACME Corp."
            />
          </div>
          {err && <div className="text-sm text-destructive">{err}</div>}
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
