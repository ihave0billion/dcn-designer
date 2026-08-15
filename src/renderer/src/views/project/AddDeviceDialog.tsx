import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { Switch } from '@/schemas/switches'
import type { Server } from '@/schemas/servers'
import type { RackMappingDevice } from '@/schemas/rack-mapping'

export interface AddDeviceDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  rackName: string
  rackSizeU: number
  switches: Switch[]
  servers: Server[]
  /** Reserves device_ids that are already used in this fork — used for auto-numbering. */
  existingDeviceIds: Set<string>
  /** Receives the new devices (1+ records depending on quantity) to insert into the rack. */
  onAdd(devices: RackMappingDevice[]): void
}

type Tab = 'switch' | 'server' | 'blank'

const BLANK_RU_OPTIONS = [1, 2, 4, 6, 10] as const

export function AddDeviceDialog({
  open,
  onOpenChange,
  rackName,
  rackSizeU,
  switches,
  servers,
  existingDeviceIds,
  onAdd
}: AddDeviceDialogProps) {
  const [tab, setTab] = useState<Tab>('switch')
  const [filter, setFilter] = useState('')
  const [selectedSwitchId, setSelectedSwitchId] = useState<string | null>(null)
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [startU, setStartU] = useState(1)
  const [quantity, setQuantity] = useState(1)
  const [blankRu, setBlankRu] = useState(1)
  const [errors, setErrors] = useState<string[]>([])

  // Reset everything whenever the dialog opens. Default Start U to the
  // top of the rack — typical DC layout puts switches at the top
  // (Phase 5b polish). Assumes a 1U device; user adjusts manually for
  // multi-U gear via the Start U input.
  useEffect(() => {
    if (!open) return
    setTab('switch')
    setFilter('')
    setSelectedSwitchId(null)
    setSelectedServerId(null)
    setLabel('')
    setStartU(rackSizeU)
    setQuantity(1)
    setBlankRu(1)
    setErrors([])
  }, [open, rackSizeU])

  // ── Filter the library lists by free-text ───────────────────────────
  const filteredSwitches = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return switches
    return switches.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.model_display.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.role.toLowerCase().includes(q)
    )
  }, [switches, filter])

  const filteredServers = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return servers
    return servers.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.model_display.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
    )
  }, [servers, filter])

  // ── Compose new devices and call onAdd ──────────────────────────────
  function handleSubmit(): void {
    const issues: string[] = []
    if (startU < 1 || startU > rackSizeU) {
      issues.push(`Start U must be between 1 and ${rackSizeU}.`)
    }
    if (quantity < 1) issues.push('Quantity must be at least 1.')

    let role: RackMappingDevice['role'] = 'switch' as never
    let model_id: string | null = null
    let ru = 1
    let labelPrefix = label.trim()
    let idPrefix = ''

    if (tab === 'switch') {
      const sw = switches.find((s) => s.id === selectedSwitchId)
      if (!sw) issues.push('Pick a switch from the list.')
      else {
        model_id = sw.id
        ru = sw.ru ?? 1
        role = sw.role === 'spine' ? 'spine' : 'leaf' // 'both' defaults to leaf for placement
        if (!labelPrefix) labelPrefix = sw.model_display
        idPrefix = role
      }
    } else if (tab === 'server') {
      const sv = servers.find((s) => s.id === selectedServerId)
      if (!sv) issues.push('Pick a server from the list.')
      else {
        model_id = sv.id
        ru = sv.ru ?? 1
        role = 'server'
        if (!labelPrefix) labelPrefix = sv.model_display
        idPrefix = 'server'
      }
    } else if (tab === 'blank') {
      model_id = null
      ru = blankRu
      role = 'blank'
      if (!labelPrefix) labelPrefix = `${blankRu}U blank panel`
      idPrefix = 'blank'
    } else {
      issues.push('CCW import is coming in Phase 8.')
    }

    if (issues.length > 0) {
      setErrors(issues)
      return
    }

    // Top device must fit in-rack
    if (startU + ru - 1 > rackSizeU) {
      issues.push(`A ${ru}U device at Start U ${startU} would extend past U${rackSizeU}.`)
    }
    // Stack downward from Start U — the bottom device lands at start_u - (qty-1)*ru
    if (startU - (quantity - 1) * ru < 1) {
      issues.push(
        `Stacking ${quantity}× ${ru}U devices downward from U${startU} would extend below U1.`
      )
    }

    if (issues.length > 0) {
      setErrors(issues)
      return
    }

    // Generate unique device_ids by walking the existing set. Devices
    // stack DOWNWARD from Start U (top-of-rack default per Phase 5b polish):
    // first device at start_u, next at start_u - ru, etc.
    const used = new Set(existingDeviceIds)
    const next: RackMappingDevice[] = []
    let cursor = startU
    let nextSerial = 1
    for (let i = 0; i < quantity; i++) {
      while (used.has(`${idPrefix}-${nextSerial}`)) nextSerial += 1
      const device_id = `${idPrefix}-${nextSerial}`
      used.add(device_id)
      next.push({
        device_id,
        model_id,
        role,
        start_u: cursor,
        ru,
        label: quantity > 1 ? `${labelPrefix} #${i + 1}` : labelPrefix
      })
      cursor -= ru
      nextSerial += 1
    }
    onAdd(next)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add device to {rackName}</DialogTitle>
          <DialogDescription>
            Pick a library device or insert a blank panel. Start U defaults to the top of the
            rack; quantity stacks devices downward from there.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="switch">Switch</TabsTrigger>
            <TabsTrigger value="server">Server</TabsTrigger>
            <TabsTrigger value="blank">Blank panel</TabsTrigger>
          </TabsList>

          <TabsContent value="switch" className="space-y-3 pt-3">
            <FilterBox value={filter} onChange={setFilter} placeholder="Filter by model, category, role…" />
            <LibraryList
              items={filteredSwitches.map((s) => ({
                id: s.id,
                title: s.model_display,
                subtitle: `${s.id} · ${s.role} · ${s.category}`,
                detail: `${s.primary.ports}× ${s.primary.speed_g}G primary${s.ru ? ` · ${s.ru}U` : ''}`
              }))}
              selectedId={selectedSwitchId}
              onSelect={setSelectedSwitchId}
              empty="No matching switches"
            />
          </TabsContent>

          <TabsContent value="server" className="space-y-3 pt-3">
            <FilterBox value={filter} onChange={setFilter} placeholder="Filter by model, category…" />
            <LibraryList
              items={filteredServers.map((s) => ({
                id: s.id,
                title: s.model_display,
                subtitle: `${s.id} · ${s.category}${s.gpu ? ` · GPU ${s.gpu.count}× ${s.gpu.model}` : ''}`,
                detail: `${s.ports.map((p) => `${p.count}× ${p.speed_g}G`).join(' / ') || 'no ports listed'}${s.ru ? ` · ${s.ru}U` : ''}`
              }))}
              selectedId={selectedServerId}
              onSelect={setSelectedServerId}
              empty="No matching servers"
            />
          </TabsContent>

          <TabsContent value="blank" className="pt-3">
            <div className="space-y-2">
              <Label>Panel height</Label>
              <div className="flex gap-2">
                {BLANK_RU_OPTIONS.map((u) => (
                  <Button
                    key={u}
                    variant={blankRu === u ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setBlankRu(u)}
                  >
                    {u}U
                  </Button>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Shared placement fields */}
        <div className="grid grid-cols-3 gap-3 border-t pt-4">
          <div className="space-y-1.5 col-span-3 md:col-span-1">
            <Label htmlFor="ad-label">Label / Hostname</Label>
            <Input
              id="ad-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="(defaults to model name)"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ad-startu">Start U</Label>
            <Input
              id="ad-startu"
              type="number"
              min={1}
              max={rackSizeU}
              value={startU}
              onChange={(e) => setStartU(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ad-qty">Quantity</Label>
            <Input
              id="ad-qty"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
        </div>

        {errors.length > 0 && (
          <ul className="text-sm text-destructive list-disc pl-5">
            {errors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Add to {rackName}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ────────────────────────────────────────────────────────────────────
// Small subcomponents
// ────────────────────────────────────────────────────────────────────

function FilterBox({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange(v: string): void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-8"
      />
    </div>
  )
}

interface LibraryItem {
  id: string
  title: string
  subtitle: string
  detail: string
}

function LibraryList({
  items,
  selectedId,
  onSelect,
  empty
}: {
  items: LibraryItem[]
  selectedId: string | null
  onSelect(id: string): void
  empty: string
}) {
  if (items.length === 0) {
    return (
      <div className="border rounded-md py-8 text-center text-sm text-muted-foreground">{empty}</div>
    )
  }
  return (
    <div className="border rounded-md max-h-64 overflow-auto">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onSelect(it.id)}
          className={cn(
            'w-full text-left px-3 py-2 border-b last:border-b-0 hover:bg-muted/60 transition-colors',
            selectedId === it.id && 'bg-muted'
          )}
        >
          <div className="text-sm font-medium">{it.title}</div>
          <div className="text-xs font-mono text-muted-foreground">{it.subtitle}</div>
          <div className="text-xs text-muted-foreground">{it.detail}</div>
        </button>
      ))}
    </div>
  )
}
