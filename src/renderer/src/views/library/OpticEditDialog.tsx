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
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { OpticSchema, type Optic } from '@/schemas/optics'

interface OpticEditDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  initial: Optic | null
  existingIds: Set<string>
  onSave(o: Optic): Promise<void>
}

function defaultOptic(): Optic {
  return {
    id: '',
    family: null,
    form_factor: null,
    data_rate_g: null,
    data_rate_raw: null,
    breakout_mode: null,
    reach: null,
    cable_type: null,
    media: null,
    connector_type: null,
    transceiver_type: null,
    case_temperature: null,
    dom_capable: null,
    standard: null,
    notes: null,
    network_device_notes: null,
    business_unit: null,
    version_id: null,
    eos: false,
    os_support: [],
    data_sheet_url: null
  }
}

export function OpticEditDialog({ open, onOpenChange, initial, existingIds, onSave }: OpticEditDialogProps) {
  const [o, setO] = useState<Optic>(() => initial ?? defaultOptic())
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const isEdit = initial !== null

  useEffect(() => {
    if (open) {
      setO(initial ? structuredClone(initial) : defaultOptic())
      setErr(null)
    }
  }, [open, initial])

  function update<K extends keyof Optic>(key: K, value: Optic[K]) {
    setO((prev) => ({ ...prev, [key]: value }))
  }

  function updateOsSupport(index: number, field: 'os' | 'min_release', value: string) {
    setO((prev) => {
      const next = [...prev.os_support]
      next[index] = { ...next[index], [field]: value }
      return { ...prev, os_support: next }
    })
  }

  function addOsSupport() {
    setO((prev) => ({
      ...prev,
      os_support: [...prev.os_support, { os: '', min_release: '' }]
    }))
  }

  function removeOsSupport(index: number) {
    setO((prev) => ({
      ...prev,
      os_support: prev.os_support.filter((_, i) => i !== index)
    }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const parsed = OpticSchema.safeParse(o)
    if (!parsed.success) {
      setErr(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
      return
    }
    if (!isEdit && existingIds.has(parsed.data.id)) {
      setErr(`An optic with id "${parsed.data.id}" already exists for this switch`)
      return
    }
    if (isEdit && initial && parsed.data.id !== initial.id && existingIds.has(parsed.data.id)) {
      setErr(`An optic with id "${parsed.data.id}" already exists for this switch`)
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${initial?.id}` : 'Add optic'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Transceiver PID" required>
              <Input value={o.id} onChange={(e) => update('id', e.target.value)} required />
            </Field>
            <Field label="Family">
              <Input value={o.family ?? ''} onChange={(e) => update('family', e.target.value || null)} />
            </Field>
            <Field label="Form factor">
              <Input value={o.form_factor ?? ''} onChange={(e) => update('form_factor', e.target.value || null)} />
            </Field>
            <Field label="Data rate (G)">
              <Input
                type="number"
                value={o.data_rate_g ?? ''}
                onChange={(e) => update('data_rate_g', e.target.value ? Number(e.target.value) : null)}
                step={0.01}
                min={0}
              />
            </Field>
            <Field label="Data rate (raw)">
              <Input
                value={o.data_rate_raw ?? ''}
                onChange={(e) => update('data_rate_raw', e.target.value || null)}
                placeholder="e.g. 100 Gbps"
              />
            </Field>
            <Field label="Breakout mode">
              <Input
                value={o.breakout_mode ?? ''}
                onChange={(e) => update('breakout_mode', e.target.value || null)}
                placeholder="e.g. 4x100G (usually blank)"
              />
            </Field>
            <Field label="Reach">
              <Input value={o.reach ?? ''} onChange={(e) => update('reach', e.target.value || null)} />
            </Field>
            <Field label="Cable type">
              <Input value={o.cable_type ?? ''} onChange={(e) => update('cable_type', e.target.value || null)} />
            </Field>
            <Field label="Media">
              <Input value={o.media ?? ''} onChange={(e) => update('media', e.target.value || null)} />
            </Field>
            <Field label="Connector type">
              <Input value={o.connector_type ?? ''} onChange={(e) => update('connector_type', e.target.value || null)} />
            </Field>
            <Field label="Transceiver type">
              <Input value={o.transceiver_type ?? ''} onChange={(e) => update('transceiver_type', e.target.value || null)} />
            </Field>
            <Field label="Standard">
              <Input value={o.standard ?? ''} onChange={(e) => update('standard', e.target.value || null)} />
            </Field>
            <Field label="Case temperature">
              <Input value={o.case_temperature ?? ''} onChange={(e) => update('case_temperature', e.target.value || null)} />
            </Field>
            <Field label="Business unit">
              <Input value={o.business_unit ?? ''} onChange={(e) => update('business_unit', e.target.value || null)} />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={!!o.dom_capable}
                onCheckedChange={(v) => update('dom_capable', v === 'indeterminate' ? null : !!v)}
              />
              DOM capable
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={o.eos} onCheckedChange={(v) => update('eos', !!v)} />
              End of sale
            </label>
            <Field label="Version ID">
              <Input value={o.version_id ?? ''} onChange={(e) => update('version_id', e.target.value || null)} />
            </Field>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>OS support</Label>
              <Button type="button" size="sm" variant="outline" onClick={addOsSupport}>
                <Plus />
                Add
              </Button>
            </div>
            {o.os_support.length === 0 ? (
              <div className="text-xs text-muted-foreground border rounded p-3">
                No OS support entries.
              </div>
            ) : (
              <div className="space-y-2">
                {o.os_support.map((entry, i) => (
                  <div key={i} className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Label className="text-xs">OS</Label>
                      <Input
                        value={entry.os}
                        onChange={(e) => updateOsSupport(i, 'os', e.target.value)}
                        placeholder="ACI / NX-OS"
                      />
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs">Min release</Label>
                      <Input
                        value={entry.min_release}
                        onChange={(e) => updateOsSupport(i, 'min_release', e.target.value)}
                        placeholder="NX-OS 10.2(3) F"
                      />
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => removeOsSupport(i)}
                      aria-label="Remove OS entry"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Field label="Transceiver notes">
            <Textarea
              value={o.notes ?? ''}
              onChange={(e) => update('notes', e.target.value || null)}
              rows={2}
            />
          </Field>

          <Field label="Network device notes">
            <Textarea
              value={o.network_device_notes ?? ''}
              onChange={(e) => update('network_device_notes', e.target.value || null)}
              rows={2}
            />
          </Field>

          <Field label="Data sheet URL">
            <Input
              value={o.data_sheet_url ?? ''}
              onChange={(e) => update('data_sheet_url', e.target.value || null)}
            />
          </Field>

          {err && <div className="text-sm text-destructive">{err}</div>}

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add optic'}
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
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  )
}
