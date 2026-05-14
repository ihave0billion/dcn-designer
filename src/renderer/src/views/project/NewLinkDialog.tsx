import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { Switch } from '@/schemas/switches'
import type { CableLink } from '@/schemas/cable-links'
import type { Optic } from '@/schemas/optics'
import type { PatchPanel } from '@/schemas/patch-panels'
import { expandPortTemplate } from '@/lib/port-template'
import { syntheticPatchPanel } from '@/lib/patch-panel-resolver'

export interface FabricDevice {
  device_id: string
  model_id: string
  role: 'spine' | 'leaf'
  rack: string | null
  label: string
}

interface NewLinkDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  spines: FabricDevice[]
  leaves: FabricDevice[]
  switches: Switch[]
  existingLinks: CableLink[]
  spineOptics: Optic[] // optics for a spine model (filtered by speed in caller? we filter here)
  leafOptics: Optic[]
  patchPanels: PatchPanel[]
  onLoadOptics(switchId: string): Promise<Optic[]>
  initialDraft?: Partial<CableLink>
  editingLinkId?: string | null
  onSubmit(link: CableLink): Promise<void> | void
}

// Synthesise a numeric link id like "link-0042" from the highest
// existing serial. Caller passes existingLinks for context.
function nextLinkId(existing: CableLink[]): string {
  let max = 0
  for (const l of existing) {
    const m = l.id.match(/(\d+)$/)
    if (m) {
      const n = Number(m[1])
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return `link-${(max + 1).toString().padStart(4, '0')}`
}

function uplinkPorts(sw: Switch | null, choice: 'primary' | 'secondary'): string[] {
  if (!sw) return []
  const grp =
    choice === 'secondary' && sw.secondary_uplink
      ? sw.secondary_uplink
      : sw.uplink ?? sw.primary
  try {
    return expandPortTemplate(grp.naming_template)
  } catch {
    return []
  }
}

function primaryPorts(sw: Switch | null): string[] {
  if (!sw) return []
  try {
    return expandPortTemplate(sw.primary.naming_template)
  } catch {
    return []
  }
}

export function NewLinkDialog({
  open,
  onOpenChange,
  spines,
  leaves,
  switches,
  existingLinks,
  spineOptics,
  leafOptics,
  patchPanels,
  onLoadOptics,
  initialDraft,
  editingLinkId,
  onSubmit
}: NewLinkDialogProps) {
  const isEdit = Boolean(editingLinkId)
  const [spineDeviceId, setSpineDeviceId] = useState<string>(initialDraft?.device_a?.device_id ?? '')
  const [leafDeviceId, setLeafDeviceId] = useState<string>(initialDraft?.device_b?.device_id ?? '')
  const [spinePort, setSpinePort] = useState<string>(initialDraft?.device_a?.port ?? '')
  const [leafPort, setLeafPort] = useState<string>(initialDraft?.device_b?.port ?? '')
  const [speedG, setSpeedG] = useState<string>(initialDraft?.speed_g?.toString() ?? '')
  const [opticId, setOpticId] = useState<string>(initialDraft?.optic_id ?? '')
  const [patchPanelId, setPatchPanelId] = useState<string>(initialDraft?.patch_panel_id ?? '')
  const [label, setLabel] = useState<string>(initialDraft?.label ?? '')
  const [lengthM, setLengthM] = useState<string>(
    initialDraft?.length_m != null ? String(initialDraft.length_m) : ''
  )
  const [leafSidePortChoice, setLeafSidePortChoice] = useState<'primary' | 'secondary'>('primary')
  const [error, setError] = useState<string | null>(null)
  const [spineOpticsLoaded, setSpineOpticsLoaded] = useState<Optic[]>(spineOptics)
  const [leafOpticsLoaded, setLeafOpticsLoaded] = useState<Optic[]>(leafOptics)

  // Reset state when dialog opens/closes or switches subject
  useEffect(() => {
    if (!open) return
    setSpineDeviceId(initialDraft?.device_a?.device_id ?? '')
    setLeafDeviceId(initialDraft?.device_b?.device_id ?? '')
    setSpinePort(initialDraft?.device_a?.port ?? '')
    setLeafPort(initialDraft?.device_b?.port ?? '')
    setSpeedG(initialDraft?.speed_g?.toString() ?? '')
    setOpticId(initialDraft?.optic_id ?? '')
    setPatchPanelId(initialDraft?.patch_panel_id ?? '')
    setLabel(initialDraft?.label ?? '')
    setLengthM(initialDraft?.length_m != null ? String(initialDraft.length_m) : '')
    setLeafSidePortChoice('primary')
    setError(null)
    setSpineOpticsLoaded(spineOptics)
    setLeafOpticsLoaded(leafOptics)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingLinkId])

  const spineDevice = useMemo(
    () => spines.find((s) => s.device_id === spineDeviceId) ?? null,
    [spines, spineDeviceId]
  )
  const leafDevice = useMemo(
    () => leaves.find((l) => l.device_id === leafDeviceId) ?? null,
    [leaves, leafDeviceId]
  )
  const spineSwitch = useMemo(
    () => (spineDevice ? switches.find((s) => s.id === spineDevice.model_id) ?? null : null),
    [switches, spineDevice]
  )
  const leafSwitch = useMemo(
    () => (leafDevice ? switches.find((s) => s.id === leafDevice.model_id) ?? null : null),
    [switches, leafDevice]
  )

  // Load optics for the chosen spine + leaf models lazily.
  useEffect(() => {
    if (!spineSwitch) return
    let cancelled = false
    onLoadOptics(spineSwitch.id).then((o) => {
      if (!cancelled) setSpineOpticsLoaded(o)
    })
    return () => {
      cancelled = true
    }
  }, [spineSwitch, onLoadOptics])

  useEffect(() => {
    if (!leafSwitch) return
    let cancelled = false
    onLoadOptics(leafSwitch.id).then((o) => {
      if (!cancelled) setLeafOpticsLoaded(o)
    })
    return () => {
      cancelled = true
    }
  }, [leafSwitch, onLoadOptics])

  const spinePortList = useMemo(() => primaryPorts(spineSwitch), [spineSwitch])
  const leafPortList = useMemo(
    () => uplinkPorts(leafSwitch, leafSidePortChoice),
    [leafSwitch, leafSidePortChoice]
  )

  // Used-port sets — exclude the current link if editing.
  const usedSpinePorts = useMemo(() => {
    const out = new Set<string>()
    for (const l of existingLinks) {
      if (editingLinkId && l.id === editingLinkId) continue
      if (l.device_a.device_id === spineDeviceId) out.add(l.device_a.port)
    }
    return out
  }, [existingLinks, spineDeviceId, editingLinkId])
  const usedLeafPorts = useMemo(() => {
    const out = new Set<string>()
    for (const l of existingLinks) {
      if (editingLinkId && l.id === editingLinkId) continue
      if (l.device_b.device_id === leafDeviceId) out.add(l.device_b.port)
    }
    return out
  }, [existingLinks, leafDeviceId, editingLinkId])

  // Optic ↔ speed compatibility filter. Keep optics whose data_rate_g
  // matches the chosen speed (or all when no speed set yet).
  const opticChoices = useMemo(() => {
    const speed = Number(speedG)
    const merged: Optic[] = []
    const seen = new Set<string>()
    for (const o of [...leafOpticsLoaded, ...spineOpticsLoaded]) {
      if (seen.has(o.id)) continue
      seen.add(o.id)
      if (!Number.isFinite(speed) || speed <= 0 || o.data_rate_g === speed) {
        merged.push(o)
      }
    }
    return merged.sort((a, b) => a.id.localeCompare(b.id))
  }, [spineOpticsLoaded, leafOpticsLoaded, speedG])

  // Patch panel options: curated + a synthetic placeholder built from the
  // chosen optic's connector (or from a generic MPO↔LC default if unknown).
  const patchPanelOptions = useMemo(() => {
    const out: PatchPanel[] = [...patchPanels]
    const chosen = opticChoices.find((o) => o.id === opticId)
    if (chosen?.connector_type) {
      const synth = syntheticPatchPanel(chosen.connector_type, 'LC (UPC)')
      if (!out.some((p) => p.id === synth.id)) out.push(synth)
    } else {
      const synth = syntheticPatchPanel('MPO-12 (UPC)', 'LC (UPC)')
      if (!out.some((p) => p.id === synth.id)) out.push(synth)
    }
    return out
  }, [patchPanels, opticChoices, opticId])

  // Auto-build a label when fields fill in (unless user has typed one).
  useEffect(() => {
    if (label !== '' && label !== `${spineDeviceId}:${spinePort} ↔ ${leafDeviceId}:${leafPort}`) {
      return
    }
    if (spineDeviceId && spinePort && leafDeviceId && leafPort) {
      setLabel(`${spineDeviceId}:${spinePort} ↔ ${leafDeviceId}:${leafPort}`)
    }
  }, [spineDeviceId, spinePort, leafDeviceId, leafPort, label])

  function handleSubmit() {
    setError(null)
    if (!spineDeviceId || !leafDeviceId || !spinePort || !leafPort) {
      setError('Pick a spine device, leaf device, and a port on each side.')
      return
    }
    const speed = Number(speedG)
    if (!Number.isFinite(speed) || speed <= 0) {
      setError('Speed must be a positive number (e.g. 100, 400).')
      return
    }
    if (usedSpinePorts.has(spinePort)) {
      setError(`Spine port ${spinePort} is already used by another link on ${spineDeviceId}.`)
      return
    }
    if (usedLeafPorts.has(leafPort)) {
      setError(`Leaf port ${leafPort} is already used by another link on ${leafDeviceId}.`)
      return
    }
    const length_m_n = lengthM.trim() === '' ? null : Number(lengthM)
    const link: CableLink = {
      id: editingLinkId ?? initialDraft?.id ?? nextLinkId(existingLinks),
      device_a: {
        rack: spineDevice?.rack ?? null,
        device_id: spineDeviceId,
        port: spinePort
      },
      device_b: {
        rack: leafDevice?.rack ?? null,
        device_id: leafDeviceId,
        port: leafPort
      },
      speed_g: speed,
      optic_id: opticId || null,
      patch_panel_id: patchPanelId || null,
      label: label || `${spineDeviceId}:${spinePort} ↔ ${leafDeviceId}:${leafPort}`,
      length_m: length_m_n != null && Number.isFinite(length_m_n) ? length_m_n : null,
      notes: initialDraft?.notes ?? null
    }
    void Promise.resolve(onSubmit(link)).then(() => onOpenChange(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit cable link' : 'New cable link'}</DialogTitle>
          <DialogDescription>
            Fabric uplink only (spine ↔ leaf). Server ↔ leaf connections stay implicit.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          {/* Spine side */}
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Spine side
            </div>
            <Field label="Spine device">
              <Select value={spineDeviceId} onValueChange={setSpineDeviceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick spine…" />
                </SelectTrigger>
                <SelectContent>
                  {spines.length === 0 ? (
                    <SelectItem disabled value="(none)">
                      No spines in design
                    </SelectItem>
                  ) : (
                    spines.map((s) => (
                      <SelectItem key={s.device_id} value={s.device_id}>
                        {s.device_id} ({s.model_id})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Spine port">
              <Select value={spinePort} onValueChange={setSpinePort} disabled={!spineDeviceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick port…" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {spinePortList.map((p) => {
                    const used = usedSpinePorts.has(p)
                    return (
                      <SelectItem key={p} value={p} disabled={used}>
                        {p} {used && <span className="text-muted-foreground">(used)</span>}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Leaf side */}
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Leaf side
            </div>
            <Field label="Leaf device">
              <Select value={leafDeviceId} onValueChange={setLeafDeviceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick leaf…" />
                </SelectTrigger>
                <SelectContent>
                  {leaves.length === 0 ? (
                    <SelectItem disabled value="(none)">
                      No leaves in design
                    </SelectItem>
                  ) : (
                    leaves.map((l) => (
                      <SelectItem key={l.device_id} value={l.device_id}>
                        {l.device_id} ({l.model_id})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </Field>
            <Field label={`Leaf port (${leafSidePortChoice} uplink)`}>
              <div className="flex gap-2">
                <Select value={leafPort} onValueChange={setLeafPort} disabled={!leafDeviceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick port…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {leafPortList.map((p) => {
                      const used = usedLeafPorts.has(p)
                      return (
                        <SelectItem key={p} value={p} disabled={used}>
                          {p} {used && <span className="text-muted-foreground">(used)</span>}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                {leafSwitch?.secondary_uplink && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setLeafSidePortChoice((p) => (p === 'primary' ? 'secondary' : 'primary'))
                    }
                  >
                    {leafSidePortChoice === 'primary' ? 'Use 2nd' : 'Use 1st'}
                  </Button>
                )}
              </div>
            </Field>
          </div>

          {/* Speed + optic + patch panel + label */}
          <div className="col-span-2 grid grid-cols-2 gap-4 pt-2 border-t">
            <Field label="Speed (G)">
              <Input
                type="number"
                min={1}
                step={1}
                value={speedG}
                onChange={(e) => setSpeedG(e.target.value)}
                placeholder="e.g. 100, 400"
              />
            </Field>
            <Field label="Optic">
              <Select value={opticId} onValueChange={setOpticId} disabled={!speedG}>
                <SelectTrigger>
                  <SelectValue placeholder={speedG ? 'Pick optic…' : 'Set speed first'} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {opticChoices.length === 0 ? (
                    <SelectItem disabled value="(none)">
                      No matching optics in library
                    </SelectItem>
                  ) : (
                    opticChoices.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.id} · {o.form_factor} {o.reach && `· ${o.reach}`}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Patch panel">
              <Select value={patchPanelId} onValueChange={setPatchPanelId}>
                <SelectTrigger>
                  <SelectValue placeholder="(none)" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="__none__">(none)</SelectItem>
                  {patchPanelOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.id}
                      {p.vendor !== '(placeholder)' && (
                        <span className="text-muted-foreground"> · {p.vendor}</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Length (m)">
              <Input
                type="number"
                min={0}
                step="0.1"
                value={lengthM}
                onChange={(e) => setLengthM(e.target.value)}
                placeholder="(optional)"
              />
            </Field>
            <Field label="Label">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="(auto)"
              />
            </Field>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              // Treat the "__none__" sentinel for patch panel
              if (patchPanelId === '__none__') setPatchPanelId('')
              handleSubmit()
            }}
          >
            {isEdit ? 'Save link' : 'Add link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}
