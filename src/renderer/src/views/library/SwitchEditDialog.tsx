import { useEffect, useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { SwitchSchema, type PortGroup, type Switch } from '@/schemas/switches'

interface SwitchEditDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  initial: Switch | null
  existingIds: Set<string>
  onSave(s: Switch): Promise<void>
}

function emptyPortGroup(): PortGroup {
  return { ports: 1, speed_g: 100, speed_options_g: [], naming_template: 'Eth1/{1..N}' }
}

function defaultSwitch(): Switch {
  return {
    id: '',
    model_display: '',
    vendor: 'Cisco',
    role: 'leaf',
    category: '100G',
    primary: emptyPortGroup(),
    uplink: null,
    secondary_uplink: null,
    ru: null,
    power_w: null,
    optic_hint: null,
    capabilities: {
      aci_leaf: false,
      aci_spine: false,
      nxos: true,
      rocev2: false,
      deep_buffer: false,
      smart_switch: false,
      ult_low_latency: false,
      poe: false,
      macsec: false,
      hpc: false,
      ai_ml: false,
      dpu_integrated: false
    },
    aci_note: null,
    asic: null,
    availability: 'available',
    available_from: null,
    notes: null,
    data_sheet_url: null,
    attachments: []
  }
}

const CAP_LABELS: Array<[keyof Switch['capabilities'], string]> = [
  ['aci_leaf', 'ACI Leaf'],
  ['aci_spine', 'ACI Spine'],
  ['nxos', 'NX-OS'],
  ['rocev2', 'RoCEv2'],
  ['deep_buffer', 'Deep Buffer'],
  ['smart_switch', 'Smart Switch'],
  ['ult_low_latency', 'Ultra Low Latency'],
  ['poe', 'PoE'],
  ['macsec', 'MACsec'],
  ['hpc', 'HPC'],
  ['ai_ml', 'AI / ML'],
  ['dpu_integrated', 'DPU Integrated']
]

export function SwitchEditDialog({ open, onOpenChange, initial, existingIds, onSave }: SwitchEditDialogProps) {
  const [s, setS] = useState<Switch>(() => initial ?? defaultSwitch())
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const isEdit = initial !== null

  useEffect(() => {
    if (open) {
      setS(initial ? structuredClone(initial) : defaultSwitch())
      setErr(null)
    }
  }, [open, initial])

  function update<K extends keyof Switch>(key: K, value: Switch[K]) {
    setS((prev) => ({ ...prev, [key]: value }))
  }
  function updateCap(key: keyof Switch['capabilities'], value: boolean) {
    setS((prev) => ({ ...prev, capabilities: { ...prev.capabilities, [key]: value } }))
  }
  function updatePort(group: 'primary' | 'uplink' | 'secondary_uplink', field: keyof PortGroup, value: unknown) {
    setS((prev) => {
      const current = prev[group] ?? emptyPortGroup()
      return { ...prev, [group]: { ...current, [field]: value } }
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const parsed = SwitchSchema.safeParse(s)
    if (!parsed.success) {
      setErr(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
      return
    }
    if (!isEdit && existingIds.has(parsed.data.id)) {
      setErr(`A switch with id "${parsed.data.id}" already exists`)
      return
    }
    if (isEdit && initial && parsed.data.id !== initial.id && existingIds.has(parsed.data.id)) {
      setErr(`A switch with id "${parsed.data.id}" already exists`)
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
          <DialogTitle>{isEdit ? `Edit ${initial?.id}` : 'Add switch'}</DialogTitle>
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
            <Field label="Role">
              <Select value={s.role} onValueChange={(v) => update('role', v as Switch['role'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="spine">Spine</SelectItem>
                  <SelectItem value="leaf">Leaf</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Availability">
              <Select value={s.availability} onValueChange={(v) => update('availability', v as Switch['availability'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="future">Future</SelectItem>
                  <SelectItem value="eos">End of Sale</SelectItem>
                </SelectContent>
              </Select>
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

          <PortGroupEditor
            label="Primary ports"
            group={s.primary}
            onChange={(field, value) => updatePort('primary', field, value)}
            required
          />

          <NullablePortGroup
            label="Uplink"
            group={s.uplink}
            onToggle={(present) => update('uplink', present ? emptyPortGroup() : null)}
            onChange={(field, value) => updatePort('uplink', field, value)}
          />

          <NullablePortGroup
            label="Secondary uplink"
            group={s.secondary_uplink}
            onToggle={(present) => update('secondary_uplink', present ? emptyPortGroup() : null)}
            onChange={(field, value) => updatePort('secondary_uplink', field, value)}
          />

          <div>
            <div className="text-sm font-medium mb-2">Capabilities</div>
            <div className="grid grid-cols-3 gap-2">
              {CAP_LABELS.map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={s.capabilities[key]} onCheckedChange={(v) => updateCap(key, !!v)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Optic hint">
              <Input value={s.optic_hint ?? ''} onChange={(e) => update('optic_hint', e.target.value || null)} />
            </Field>
            <Field label="ASIC">
              <Input value={s.asic ?? ''} onChange={(e) => update('asic', e.target.value || null)} />
            </Field>
          </div>

          {/* Phase 13 — Visio export hints. Blank = automatic resolution. */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Visio master (override)">
              <Input
                placeholder={`${s.id || 'N9K-…'} Front`}
                value={s.visio?.master ?? ''}
                onChange={(e) =>
                  update('visio', { master: e.target.value || null, image: s.visio?.image ?? null })
                }
              />
            </Field>
            <Field label="Visio front-view image (library/visio/…)">
              <Input
                placeholder="images/N9K-….png"
                value={s.visio?.image ?? ''}
                onChange={(e) =>
                  update('visio', { master: s.visio?.master ?? null, image: e.target.value || null })
                }
              />
            </Field>
          </div>

          <Field label="ACI note">
            <Textarea
              value={s.aci_note ?? ''}
              onChange={(e) => update('aci_note', e.target.value || null)}
              rows={2}
            />
          </Field>

          <Field label="Notes">
            <Textarea
              value={s.notes ?? ''}
              onChange={(e) => update('notes', e.target.value || null)}
              rows={2}
            />
          </Field>

          {err && <div className="text-sm text-destructive">{err}</div>}

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add switch'}
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

function PortGroupEditor({
  label,
  group,
  onChange,
  required
}: {
  label: string
  group: PortGroup
  onChange(field: keyof PortGroup, value: unknown): void
  required?: boolean
}) {
  return (
    <div className="border rounded-md p-3 space-y-3">
      <div className="text-sm font-medium">{label}{required && <span className="text-destructive"> *</span>}</div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Ports">
          <Input
            type="number"
            value={group.ports}
            onChange={(e) => onChange('ports', Number(e.target.value))}
            min={1}
          />
        </Field>
        <Field label="Speed (G)">
          <Input
            type="number"
            value={group.speed_g}
            onChange={(e) => onChange('speed_g', Number(e.target.value))}
            step={0.01}
            min={0.01}
          />
        </Field>
        <Field label="Naming">
          <Input
            value={group.naming_template}
            onChange={(e) => onChange('naming_template', e.target.value)}
          />
        </Field>
      </div>
    </div>
  )
}

function NullablePortGroup({
  label,
  group,
  onToggle,
  onChange
}: {
  label: string
  group: PortGroup | null
  onToggle(present: boolean): void
  onChange(field: keyof PortGroup, value: unknown): void
}) {
  return (
    <div className="border rounded-md p-3 space-y-3">
      <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
        <Checkbox checked={group !== null} onCheckedChange={(v) => onToggle(!!v)} />
        {label}
      </label>
      {group !== null && (
        <div className="grid grid-cols-3 gap-3">
          <Field label="Ports">
            <Input
              type="number"
              value={group.ports}
              onChange={(e) => onChange('ports', Number(e.target.value))}
              min={1}
            />
          </Field>
          <Field label="Speed (G)">
            <Input
              type="number"
              value={group.speed_g}
              onChange={(e) => onChange('speed_g', Number(e.target.value))}
              step={0.01}
              min={0.01}
            />
          </Field>
          <Field label="Naming">
            <Input
              value={group.naming_template}
              onChange={(e) => onChange('naming_template', e.target.value)}
            />
          </Field>
        </div>
      )}
    </div>
  )
}
