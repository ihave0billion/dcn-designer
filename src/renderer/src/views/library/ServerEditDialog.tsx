import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ServerSchema, type Server, type ServerPortGroup } from '@/schemas/servers'

interface ServerEditDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  initial: Server | null
  existingIds: Set<string>
  onSave(s: Server): Promise<void>
}

function defaultServer(): Server {
  return {
    id: '',
    model_display: '',
    vendor: 'Cisco',
    role: 'server',
    category: 'Compute',
    ru: 1,
    power_w: null,
    ports: [{ count: 2, speed_g: 25, naming_template: 'MLOM/{1..2}' }],
    gpu: null,
    notes: null,
    data_sheet_url: null,
    attachments: []
  }
}

export function ServerEditDialog({ open, onOpenChange, initial, existingIds, onSave }: ServerEditDialogProps) {
  const [s, setS] = useState<Server>(() => initial ?? defaultServer())
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [hasGpu, setHasGpu] = useState<boolean>(initial?.gpu != null)
  const isEdit = initial !== null

  useEffect(() => {
    if (open) {
      setS(initial ? structuredClone(initial) : defaultServer())
      setHasGpu(initial?.gpu != null)
      setErr(null)
    }
  }, [open, initial])

  function update<K extends keyof Server>(key: K, value: Server[K]) {
    setS((prev) => ({ ...prev, [key]: value }))
  }
  function updatePort(idx: number, field: keyof ServerPortGroup, value: unknown) {
    setS((prev) => {
      const ports = prev.ports.map((p, i) => (i === idx ? { ...p, [field]: value } : p))
      return { ...prev, ports }
    })
  }
  function addPort() {
    setS((prev) => ({ ...prev, ports: [...prev.ports, { count: 2, speed_g: 25, naming_template: 'NIC/{1..2}' }] }))
  }
  function removePort(idx: number) {
    setS((prev) => ({ ...prev, ports: prev.ports.filter((_, i) => i !== idx) }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const candidate: Server = { ...s, gpu: hasGpu ? s.gpu ?? { model: '', count: 1 } : null }
    const parsed = ServerSchema.safeParse(candidate)
    if (!parsed.success) {
      setErr(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
      return
    }
    if (!isEdit && existingIds.has(parsed.data.id)) {
      setErr(`A server with id "${parsed.data.id}" already exists`)
      return
    }
    if (isEdit && initial && parsed.data.id !== initial.id && existingIds.has(parsed.data.id)) {
      setErr(`A server with id "${parsed.data.id}" already exists`)
      return
    }
    setBusy(true)
    try {
      await onSave(parsed.data)
      onOpenChange(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${initial?.id}` : 'Add server'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Product ID" required>
              <Input value={s.id} onChange={(e) => update('id', e.target.value)} required />
            </Field>
            <Field label="Display name" required>
              <Input value={s.model_display} onChange={(e) => update('model_display', e.target.value)} required />
            </Field>
            <Field label="Vendor" required>
              <Input value={s.vendor} onChange={(e) => update('vendor', e.target.value)} required />
            </Field>
            <Field label="Category">
              <Input value={s.category} onChange={(e) => update('category', e.target.value)} />
            </Field>
            <Field label="RU">
              <Input
                type="number"
                value={s.ru ?? ''}
                onChange={(e) => update('ru', e.target.value ? Number(e.target.value) : null)}
                min={1}
              />
            </Field>
            <Field label="Power (W)">
              <Input
                type="number"
                value={s.power_w ?? ''}
                onChange={(e) => update('power_w', e.target.value ? Number(e.target.value) : null)}
                min={1}
              />
            </Field>
          </div>

          <div className="border rounded-md p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">NIC port groups</div>
              <Button type="button" variant="outline" size="sm" onClick={addPort}>
                <Plus />
                Add group
              </Button>
            </div>
            {s.ports.map((p, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_1fr_2fr_auto] gap-2 items-end">
                <Field label="Count">
                  <Input type="number" value={p.count} min={1} onChange={(e) => updatePort(idx, 'count', Number(e.target.value))} />
                </Field>
                <Field label="Speed (G)">
                  <Input type="number" value={p.speed_g} min={0.01} step={0.01} onChange={(e) => updatePort(idx, 'speed_g', Number(e.target.value))} />
                </Field>
                <Field label="Naming">
                  <Input value={p.naming_template} onChange={(e) => updatePort(idx, 'naming_template', e.target.value)} />
                </Field>
                <Button type="button" variant="ghost" size="icon" onClick={() => removePort(idx)} disabled={s.ports.length <= 1}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>

          <div className="border rounded-md p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={hasGpu}
                onChange={(e) => setHasGpu(e.target.checked)}
                className="size-4"
              />
              Has GPU
            </label>
            {hasGpu && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="GPU model">
                  <Input
                    value={s.gpu?.model ?? ''}
                    onChange={(e) => update('gpu', { model: e.target.value, count: s.gpu?.count ?? 1 })}
                  />
                </Field>
                <Field label="GPU count">
                  <Input
                    type="number"
                    min={1}
                    value={s.gpu?.count ?? 1}
                    onChange={(e) => update('gpu', { model: s.gpu?.model ?? '', count: Number(e.target.value) })}
                  />
                </Field>
              </div>
            )}
          </div>

          <Field label="Notes">
            <Textarea value={s.notes ?? ''} onChange={(e) => update('notes', e.target.value || null)} rows={2} />
          </Field>

          {err && <div className="text-sm text-destructive">{err}</div>}

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add server'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required && <span className="text-destructive"> *</span>}</Label>
      {children}
    </div>
  )
}
