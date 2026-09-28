import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Eraser,
  GitFork,
  Plus,
  RotateCcw,
  Trash2,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  RequirementsFileSchema,
  type RackInventoryRow,
  type RequirementsFile
} from '@/schemas/project'
import type { Switch } from '@/schemas/switches'
import type { Server } from '@/schemas/servers'
import type {
  RackMappingDevice,
  RackMappingFile
} from '@/schemas/rack-mapping'
import {
  deleteRackMapping,
  loadRackMapping,
  loadServersFile,
  loadSwitchesFile,
  saveRackMapping
} from '@/lib/library-io'
import { useWorkspace } from '@/state/WorkspaceContext'
import type { DesignResult, RackPlacement } from '@domain'
import { ND_NODE_POWER_W, ndSpecFor } from '@domain'
import { AddDeviceDialog } from './AddDeviceDialog'

interface RackViewProps {
  requirements: RequirementsFile
  projectPath: string
  onRequirementsChanged(next: RequirementsFile): void
  onGoToDesign(): void
}

const DEFAULT_SWITCH_POWER_W = 800
const SLOT_HEIGHT_PX = 18

export function RackView({
  requirements,
  projectPath,
  onRequirementsChanged,
  onGoToDesign
}: RackViewProps) {
  const { workspacePath } = useWorkspace()
  const [switches, setSwitches] = useState<Switch[]>([])
  const [servers, setServers] = useState<Server[]>([])
  const [solverLayout, setSolverLayout] = useState<RackPlacement[] | null>(null)
  const [mapping, setMapping] = useState<RackMappingFile | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [selectedRackId, setSelectedRackId] = useState<string | null>(null)
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [deleteRackConfirm, setDeleteRackConfirm] = useState<string | null>(null)

  // ── Load library + solver design + mapping on mount ──────────────────
  useEffect(() => {
    let cancelled = false
    if (!workspacePath) return
    setLoaded(false)
    Promise.all([
      loadSwitchesFile(workspacePath).then((f) => f.switches).catch(() => [] as Switch[]),
      loadServersFile(workspacePath).then((f) => f.servers).catch(() => [] as Server[]),
      (async () => {
        const designPath = `${projectPath}/design.yaml`
        const exists = await window.dcn.fileExists(designPath)
        if (!exists) return null
        try {
          const d = (await window.dcn.readYaml(designPath)) as DesignResult
          return d.rack_layout ?? []
        } catch {
          return null
        }
      })(),
      loadRackMapping(projectPath).catch(() => null)
    ]).then(([sw, sv, solver, map]) => {
      if (cancelled) return
      setSwitches(sw)
      setServers(sv)
      setSolverLayout(solver)
      setMapping(map)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
    // Only re-load when project/workspace changes — rack inventory churn (add/rename/delete)
    // mustn't trigger a reload that would clobber selectedRackId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath, projectPath])

  // Keep selectedRackId in sync with the current rack inventory:
  // initialize on first load, and only clear/fall back when the previously selected rack
  // is gone. Adding a rack must NOT yank the selection back to the first entry.
  useEffect(() => {
    const names = new Set(requirements.racks.map((r) => r.name))
    if (selectedRackId == null && requirements.racks.length > 0) {
      setSelectedRackId(requirements.racks[0].name)
    } else if (selectedRackId != null && !names.has(selectedRackId)) {
      setSelectedRackId(requirements.racks[0]?.name ?? null)
    }
  }, [requirements.racks, selectedRackId])

  // ── Library lookup maps ──────────────────────────────────────────────
  const switchById = useMemo(() => {
    const m = new Map<string, Switch>()
    for (const s of switches) m.set(s.id, s)
    return m
  }, [switches])

  const serverById = useMemo(() => {
    const m = new Map<string, Server>()
    for (const s of servers) m.set(s.id, s)
    return m
  }, [servers])

  // Resolve a device's power_w (cached lookups, library is source of truth)
  const powerForDevice = useCallback(
    (d: RackMappingDevice): number => {
      if (d.role === 'blank') return 0
      // Phase 17 — Nexus Dashboard nodes: catalogue estimate.
      if (d.role === 'nd') return ndSpecFor(d.model_id)?.power_w ?? ND_NODE_POWER_W
      const sw = d.model_id ? switchById.get(d.model_id) : null
      if (sw) return sw.power_w ?? DEFAULT_SWITCH_POWER_W
      const sv = d.model_id ? serverById.get(d.model_id) : null
      if (sv) return sv.power_w ?? 0
      return DEFAULT_SWITCH_POWER_W
    },
    [switchById, serverById]
  )

  const isForked = mapping != null

  // ── Compute effective devices for each rack ──────────────────────────
  // When forked: read from mapping. Otherwise: project from solverLayout
  // (or empty if no design has been generated).
  const effectiveByRack = useMemo(() => {
    const out = new Map<string, RackMappingDevice[]>()
    for (const r of requirements.racks) {
      if (mapping) {
        const found = mapping.racks.find((m) => m.rack_id === r.name)
        out.set(r.name, found?.devices ?? [])
      } else if (solverLayout) {
        const found = solverLayout.find((m) => m.rack_name === r.name)
        out.set(
          r.name,
          (found?.devices ?? []).map((d) => ({
            device_id: d.device_id,
            model_id: d.model_id,
            role: d.role,
            start_u: d.start_u,
            ru: d.ru,
            label: d.label
          }))
        )
      } else {
        out.set(r.name, [])
      }
    }
    return out
  }, [requirements.racks, mapping, solverLayout])

  // ── Computed PDU / capacity per rack ─────────────────────────────────
  const statsByRack = useMemo(() => {
    const out = new Map<string, { used_u: number; power_w: number; over_budget: boolean }>()
    for (const r of requirements.racks) {
      const devices = effectiveByRack.get(r.name) ?? []
      const used_u = devices.reduce((a, d) => a + d.ru, 0)
      const power_w = devices.reduce((a, d) => a + powerForDevice(d), 0)
      const over_budget =
        r.pdu_kw_budget != null && power_w / 1000 > r.pdu_kw_budget
      out.set(r.name, { used_u, power_w, over_budget })
    }
    return out
  }, [requirements.racks, effectiveByRack, powerForDevice])

  // Selected rack inventory entry + devices
  const selectedRack = useMemo(
    () => requirements.racks.find((r) => r.name === selectedRackId) ?? null,
    [requirements.racks, selectedRackId]
  )
  const selectedDevices = selectedRackId ? effectiveByRack.get(selectedRackId) ?? [] : []
  const selectedDevice = selectedDevices.find((d) => d.device_id === selectedDeviceId) ?? null

  // ── Mutators ─────────────────────────────────────────────────────────

  // Fork the layout into rack_mapping.yaml if not yet forked, then return
  // a draft we can mutate before saving back.
  function forkDraft(): RackMappingFile {
    if (mapping) return structuredClone(mapping)
    // Build from current solver-layout view
    const draft: RackMappingFile = {
      schema_version: 1,
      forked_at: new Date().toISOString(),
      racks: requirements.racks.map((r) => ({
        rack_id: r.name,
        devices: (effectiveByRack.get(r.name) ?? []).map((d) => ({ ...d }))
      }))
    }
    return draft
  }

  const persistMapping = useCallback(
    async (next: RackMappingFile) => {
      try {
        await saveRackMapping(projectPath, next)
        setMapping(next)
        setErr(null)
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    },
    [projectPath]
  )

  const mutateRack = useCallback(
    async (rackId: string, fn: (devices: RackMappingDevice[]) => RackMappingDevice[]) => {
      const draft = forkDraft()
      let rack = draft.racks.find((r) => r.rack_id === rackId)
      if (!rack) {
        rack = { rack_id: rackId, devices: [] }
        draft.racks.push(rack)
      }
      rack.devices = fn(rack.devices)
      await persistMapping(draft)
    },
    // forkDraft depends on mapping/solverLayout/requirements via closures;
    // useCallback would memo a stale closure here so we leave it minimal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mapping, solverLayout, requirements.racks, persistMapping]
  )

  // Save changes to requirements.yaml.racks (and migrate rack_mapping
  // entries when renaming/deleting).
  const persistRequirements = useCallback(
    async (next: RequirementsFile) => {
      const parsed = RequirementsFileSchema.safeParse({
        ...next,
        project: { ...next.project, last_edited: new Date().toISOString() }
      })
      if (!parsed.success) {
        setErr(`requirements.yaml validation failed: ${parsed.error.message}`)
        return
      }
      await window.dcn.writeYaml(`${projectPath}/requirements.yaml`, parsed.data)
      onRequirementsChanged(parsed.data)
      setErr(null)
    },
    [projectPath, onRequirementsChanged]
  )

  // ── Rack inventory: add / delete / rename / edit ─────────────────────
  const handleAddRack = useCallback(async () => {
    const baseName = 'New rack'
    let name = baseName
    let n = 1
    const taken = new Set(requirements.racks.map((r) => r.name))
    while (taken.has(name)) {
      n += 1
      name = `${baseName} ${n}`
    }
    const next: RequirementsFile = {
      ...requirements,
      racks: [
        ...requirements.racks,
        {
          name,
          size_u: 44,
          pdu_kw_budget: null,
          location: '',
          tags: []
        }
      ]
    }
    await persistRequirements(next)
    setSelectedRackId(name)
    setSelectedDeviceId(null)
  }, [requirements, persistRequirements])

  const handleDeleteRack = useCallback(
    async (rackName: string) => {
      const next: RequirementsFile = {
        ...requirements,
        racks: requirements.racks.filter((r) => r.name !== rackName)
      }
      await persistRequirements(next)
      if (mapping) {
        const draft: RackMappingFile = {
          ...mapping,
          racks: mapping.racks.filter((r) => r.rack_id !== rackName)
        }
        await persistMapping(draft)
      }
      setDeleteRackConfirm(null)
      if (selectedRackId === rackName) {
        setSelectedRackId(next.racks[0]?.name ?? null)
        setSelectedDeviceId(null)
      }
    },
    [requirements, persistRequirements, mapping, persistMapping, selectedRackId]
  )

  const handleEditRack = useCallback(
    async (rackName: string, patch: Partial<RackInventoryRow>) => {
      const renamedTo = patch.name && patch.name !== rackName ? patch.name : null
      if (renamedTo) {
        const taken = new Set(requirements.racks.map((r) => r.name))
        if (taken.has(renamedTo)) {
          setErr(`A rack named "${renamedTo}" already exists.`)
          return
        }
      }
      const next: RequirementsFile = {
        ...requirements,
        racks: requirements.racks.map((r) =>
          r.name === rackName ? { ...r, ...patch } : r
        )
      }
      await persistRequirements(next)
      if (renamedTo && mapping) {
        const draft: RackMappingFile = {
          ...mapping,
          racks: mapping.racks.map((r) =>
            r.rack_id === rackName ? { ...r, rack_id: renamedTo } : r
          )
        }
        await persistMapping(draft)
      }
      if (renamedTo && selectedRackId === rackName) {
        setSelectedRackId(renamedTo)
      }
    },
    [requirements, persistRequirements, mapping, persistMapping, selectedRackId]
  )

  // ── Device edits ─────────────────────────────────────────────────────
  const handleAddDevices = useCallback(
    async (rackId: string, devices: RackMappingDevice[]) => {
      await mutateRack(rackId, (prev) => [...prev, ...devices])
    },
    [mutateRack]
  )

  const handleEditDevice = useCallback(
    async (rackId: string, deviceId: string, patch: Partial<RackMappingDevice>) => {
      await mutateRack(rackId, (prev) =>
        prev.map((d) => (d.device_id === deviceId ? { ...d, ...patch } : d))
      )
    },
    [mutateRack]
  )

  const handleRemoveDevice = useCallback(
    async (rackId: string, deviceId: string) => {
      await mutateRack(rackId, (prev) => prev.filter((d) => d.device_id !== deviceId))
      setSelectedDeviceId(null)
    },
    [mutateRack]
  )

  // ── Reset to solver layout ───────────────────────────────────────────
  const handleReset = useCallback(async () => {
    try {
      await deleteRackMapping(projectPath)
      setMapping(null)
      setSelectedDeviceId(null)
      setResetConfirmOpen(false)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [projectPath])

  // ── Render: empty state when no racks ────────────────────────────────
  if (!loaded) {
    return <div className="p-6 text-sm text-muted-foreground">Loading rack view…</div>
  }
  if (requirements.racks.length === 0) {
    return <EmptyRacksState onAddRack={handleAddRack} onGoToDesign={onGoToDesign} hasDesign={solverLayout != null} />
  }

  // Collect all device_ids used across the fork — feeds AddDeviceDialog's
  // unique-ID generation.
  const allDeviceIds = new Set<string>()
  for (const devs of effectiveByRack.values()) {
    for (const d of devs) allDeviceIds.add(d.device_id)
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Action bar */}
      <div className="border-b bg-muted/30 px-6 py-3 flex items-center gap-3">
        <ForkStatusPill isForked={isForked} hasDesign={solverLayout != null} />
        <div className="flex-1" />
        {isForked && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setResetConfirmOpen(true)}
          >
            <RotateCcw />
            Reset to solver layout
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onGoToDesign}>
          Go to Design
          <ArrowRight />
        </Button>
      </div>

      {err && (
        <div className="border-b bg-destructive/10 text-destructive px-6 py-2 text-sm flex items-center justify-between">
          <span>{err}</span>
          <button onClick={() => setErr(null)} className="opacity-60 hover:opacity-100">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 grid grid-cols-12 min-h-0">
        {/* Sidebar — rack list */}
        <aside className="col-span-3 border-r overflow-auto">
          <div className="p-3 space-y-1">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Racks ({requirements.racks.length})
              </h2>
              <Button size="sm" variant="outline" onClick={handleAddRack}>
                <Plus />
                Add rack
              </Button>
            </div>
            {requirements.racks.map((r, idx) => {
              const stats = statsByRack.get(r.name)
              const active = selectedRackId === r.name
              // Phase 16 — caption each physical row of racks.
              const perRow = requirements.racks_per_row ?? null
              const rowHeader =
                perRow && perRow > 0 && idx % perRow === 0 ? (
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pt-2 pb-1">
                    Row {Math.floor(idx / perRow) + 1}
                  </div>
                ) : null
              return (
                <div key={r.name}>
                {rowHeader}
                <button
                  onClick={() => {
                    setSelectedRackId(r.name)
                    setSelectedDeviceId(null)
                  }}
                  className={cn(
                    'w-full text-left rounded-md border px-2.5 py-2 hover:bg-muted/60 transition-colors',
                    active && 'bg-muted border-foreground/20',
                    stats?.over_budget && 'border-destructive/60'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">{r.name}</div>
                    {stats?.over_budget && (
                      <span className="inline-flex items-center text-[10px] font-medium text-destructive">
                        <AlertTriangle className="size-3 mr-0.5" />
                        over budget
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {(effectiveByRack.get(r.name)?.length ?? 0)} devices ·{' '}
                    {stats?.used_u ?? 0}/{r.size_u} U
                  </div>
                </button>
                </div>
              )
            })}
          </div>
        </aside>

        {/* Main rack canvas */}
        <main className="col-span-6 overflow-auto border-r">
          {selectedRack ? (
            <RackCanvas
              rack={selectedRack}
              devices={selectedDevices}
              selectedDeviceId={selectedDeviceId}
              stats={statsByRack.get(selectedRack.name) ?? { used_u: 0, power_w: 0, over_budget: false }}
              onSelectDevice={setSelectedDeviceId}
              onOpenAddDevice={() => setAddDialogOpen(true)}
            />
          ) : (
            <div className="p-6 text-sm text-muted-foreground">Pick a rack from the sidebar.</div>
          )}
        </main>

        {/* Right panel — rack settings OR device properties */}
        <aside className="col-span-3 overflow-auto bg-muted/20">
          {selectedDevice && selectedRack ? (
            <DevicePropertiesPanel
              rack={selectedRack}
              device={selectedDevice}
              switches={switches}
              servers={servers}
              onEdit={(patch) =>
                handleEditDevice(selectedRack.name, selectedDevice.device_id, patch)
              }
              onRemove={() => handleRemoveDevice(selectedRack.name, selectedDevice.device_id)}
              onClose={() => setSelectedDeviceId(null)}
            />
          ) : selectedRack ? (
            <RackSettingsPanel
              rack={selectedRack}
              stats={statsByRack.get(selectedRack.name) ?? { used_u: 0, power_w: 0, over_budget: false }}
              isOnlyRack={requirements.racks.length === 1}
              onEdit={(patch) => handleEditRack(selectedRack.name, patch)}
              onDelete={() => setDeleteRackConfirm(selectedRack.name)}
            />
          ) : (
            <div className="p-6 text-sm text-muted-foreground">Pick a rack.</div>
          )}
        </aside>
      </div>

      {/* Add device dialog */}
      {selectedRack && (
        <AddDeviceDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          rackName={selectedRack.name}
          rackSizeU={selectedRack.size_u}
          switches={switches}
          servers={servers}
          existingDeviceIds={allDeviceIds}
          onAdd={(devices) => handleAddDevices(selectedRack.name, devices)}
        />
      )}

      {/* Reset confirm */}
      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to solver layout?</AlertDialogTitle>
            <AlertDialogDescription>
              This discards your rack edits and deletes <code className="font-mono text-xs">rack_mapping.yaml</code>.
              The current solver-generated layout from <code className="font-mono text-xs">design.yaml</code> becomes the displayed layout.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>
              <Eraser />
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete rack confirm */}
      <AlertDialog
        open={deleteRackConfirm != null}
        onOpenChange={(open) => !open && setDeleteRackConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete rack "{deleteRackConfirm}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the rack from requirements and any device assignments in the current fork. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteRackConfirm && handleDeleteRack(deleteRackConfirm)}
            >
              <Trash2 />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Fork-status pill
// ────────────────────────────────────────────────────────────────────

function ForkStatusPill({ isForked, hasDesign }: { isForked: boolean; hasDesign: boolean }) {
  if (isForked) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 text-xs font-medium px-2.5 py-1">
        <GitFork className="size-3.5" />
        Forked — your edits
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted text-muted-foreground text-xs font-medium px-2.5 py-1">
      {hasDesign ? 'Solver layout (read-through)' : 'No design generated yet'}
    </span>
  )
}

// ────────────────────────────────────────────────────────────────────
// Empty state (no racks)
// ────────────────────────────────────────────────────────────────────

function EmptyRacksState({
  onAddRack,
  onGoToDesign,
  hasDesign
}: {
  onAddRack(): void
  onGoToDesign(): void
  hasDesign: boolean
}) {
  return (
    <div className="p-8 max-w-xl mx-auto">
      <Card>
        <CardContent className="py-8 space-y-3 text-center">
          <h2 className="text-base font-semibold">No racks defined yet</h2>
          <p className="text-sm text-muted-foreground">
            Add a rack to start placing devices. Racks defined here also feed the solver's auto-placement on the Design tab.
            {!hasDesign && ' Generate a design first if you want the solver to populate racks for you.'}
          </p>
          <div className="flex justify-center gap-2 pt-2">
            <Button onClick={onAddRack}>
              <Plus />
              Add rack
            </Button>
            <Button variant="outline" onClick={onGoToDesign}>
              Go to Design
              <ArrowRight />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Rack canvas — 42U vertical slot list with absolutely-positioned devices
// ────────────────────────────────────────────────────────────────────

function RackCanvas({
  rack,
  devices,
  selectedDeviceId,
  stats,
  onSelectDevice,
  onOpenAddDevice
}: {
  rack: RackInventoryRow
  devices: RackMappingDevice[]
  selectedDeviceId: string | null
  stats: { used_u: number; power_w: number; over_budget: boolean }
  onSelectDevice(id: string): void
  onOpenAddDevice(): void
}) {
  // U-rows rendered top → bottom: U_max at row 0, U1 at the bottom.
  const rowsTopToBottom = Array.from({ length: rack.size_u }, (_, i) => rack.size_u - i)

  return (
    <div className="p-6 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">{rack.name}</h2>
          <p className="text-xs text-muted-foreground">
            {stats.used_u}/{rack.size_u} U · {(stats.power_w / 1000).toFixed(2)} kW
            {rack.pdu_kw_budget != null && ` / ${rack.pdu_kw_budget} kW budget`}
            {rack.location && ` · ${rack.location}`}
          </p>
        </div>
        <Button size="sm" onClick={onOpenAddDevice}>
          <Plus />
          Add device
        </Button>
      </div>

      {stats.over_budget && (
        <div className="rounded-md border border-destructive/60 bg-destructive/5 px-3 py-2 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="size-4" />
          Over PDU budget by {((stats.power_w / 1000) - (rack.pdu_kw_budget ?? 0)).toFixed(2)} kW.
        </div>
      )}

      {/* Rack visual */}
      <div
        className="relative border rounded-md bg-background overflow-hidden"
        style={{ height: `${rack.size_u * SLOT_HEIGHT_PX}px` }}
      >
        {/* U-slot rows */}
        {rowsTopToBottom.map((u, i) => (
          <div
            key={u}
            className={cn(
              'absolute left-0 right-0 border-t border-dashed border-border/60 flex items-center',
              i === 0 && 'border-t-0'
            )}
            style={{ top: `${i * SLOT_HEIGHT_PX}px`, height: `${SLOT_HEIGHT_PX}px` }}
          >
            <span className="w-10 text-[10px] font-mono text-muted-foreground px-2 select-none">
              U{u.toString().padStart(2, '0')}
            </span>
          </div>
        ))}

        {/* Devices */}
        {devices.map((d) => {
          const topEdgeU = d.start_u + d.ru - 1
          if (topEdgeU > rack.size_u) return null
          const top = (rack.size_u - topEdgeU) * SLOT_HEIGHT_PX
          const height = d.ru * SLOT_HEIGHT_PX
          const selected = selectedDeviceId === d.device_id
          return (
            <button
              key={d.device_id}
              type="button"
              onClick={() => onSelectDevice(d.device_id)}
              className={cn(
                'absolute left-12 right-2 rounded border px-2 text-left text-xs font-medium overflow-hidden transition-colors',
                deviceColor(d.role),
                selected && 'ring-2 ring-foreground/40 ring-offset-1 ring-offset-background'
              )}
              style={{ top: `${top + 1}px`, height: `${height - 2}px` }}
              title={`U${d.start_u}–U${topEdgeU} · ${d.model_id ?? d.role}`}
            >
              <div className="flex items-center justify-between gap-2 h-full">
                <span className="truncate">{d.label || d.device_id}</span>
                <span className="font-mono text-[10px] opacity-75 shrink-0">
                  U{d.start_u}
                  {d.ru > 1 && `–${topEdgeU}`}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function deviceColor(role: RackMappingDevice['role']): string {
  switch (role) {
    case 'spine':
      return 'bg-violet-100 border-violet-300 text-violet-900 dark:bg-violet-950/60 dark:border-violet-800 dark:text-violet-200 hover:bg-violet-200/80'
    case 'leaf':
      return 'bg-sky-100 border-sky-300 text-sky-900 dark:bg-sky-950/60 dark:border-sky-800 dark:text-sky-200 hover:bg-sky-200/80'
    case 'server':
      return 'bg-emerald-100 border-emerald-300 text-emerald-900 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-200 hover:bg-emerald-200/80'
    case 'ipn':
      return 'bg-amber-100 border-amber-300 text-amber-900 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-200 hover:bg-amber-200/80'
    case 'nd':
      return 'bg-teal-100 border-teal-300 text-teal-900 dark:bg-teal-950/60 dark:border-teal-800 dark:text-teal-200 hover:bg-teal-200/80'
    case 'blank':
      return 'bg-muted/50 border-dashed border-muted-foreground/40 text-muted-foreground hover:bg-muted'
  }
}

// ────────────────────────────────────────────────────────────────────
// Right-side panels: Rack settings OR Device properties
// ────────────────────────────────────────────────────────────────────

function RackSettingsPanel({
  rack,
  stats,
  isOnlyRack,
  onEdit,
  onDelete
}: {
  rack: RackInventoryRow
  stats: { used_u: number; power_w: number; over_budget: boolean }
  isOnlyRack: boolean
  onEdit(patch: Partial<RackInventoryRow>): void
  onDelete(): void
}) {
  const [name, setName] = useState(rack.name)
  const [pduKw, setPduKw] = useState(rack.pdu_kw_budget?.toString() ?? '')
  const [location, setLocation] = useState(rack.location)
  const [tags, setTags] = useState(rack.tags.join(', '))

  useEffect(() => {
    setName(rack.name)
    setPduKw(rack.pdu_kw_budget?.toString() ?? '')
    setLocation(rack.location)
    setTags(rack.tags.join(', '))
  }, [rack])

  function commitName() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === rack.name) {
      setName(rack.name)
      return
    }
    onEdit({ name: trimmed })
  }

  function commitPdu() {
    const trimmed = pduKw.trim()
    if (trimmed === '' && rack.pdu_kw_budget == null) return
    if (trimmed === '') {
      onEdit({ pdu_kw_budget: null })
      return
    }
    const n = Number(trimmed)
    if (Number.isFinite(n) && n > 0) onEdit({ pdu_kw_budget: n })
    else setPduKw(rack.pdu_kw_budget?.toString() ?? '')
  }

  return (
    <div className="p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Rack settings</h3>
        <p className="text-xs text-muted-foreground">Edits write to requirements.yaml.</p>
      </div>

      <div className="space-y-3">
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </Field>

        <Field label="Size (U)">
          <Input
            type="number"
            min={1}
            max={60}
            value={rack.size_u}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n > 0) onEdit({ size_u: Math.floor(n) })
            }}
          />
        </Field>

        <Field label="PDU budget (kW)">
          <Input
            type="number"
            step="0.1"
            min={0}
            placeholder="(none)"
            value={pduKw}
            onChange={(e) => setPduKw(e.target.value)}
            onBlur={commitPdu}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </Field>

        <Field label="Location">
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onBlur={() => location !== rack.location && onEdit({ location })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder="e.g. Row 3, Col 4"
          />
        </Field>

        <Field label="Tags (comma-separated)">
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            onBlur={() => {
              const arr = tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
              if (arr.join('|') !== rack.tags.join('|')) onEdit({ tags: arr })
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder="e.g. pod-1, ai"
          />
        </Field>
      </div>

      {/* Stats */}
      <div className="border-t pt-3 space-y-1 text-xs">
        <Kv k="Used U" v={`${stats.used_u} / ${rack.size_u}`} />
        <Kv
          k="Estimated power"
          v={`${(stats.power_w / 1000).toFixed(2)} kW${rack.pdu_kw_budget != null ? ` / ${rack.pdu_kw_budget} kW` : ''}`}
          alert={stats.over_budget}
        />
      </div>

      {/* Delete */}
      <div className="border-t pt-3">
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
          disabled={isOnlyRack}
        >
          <Trash2 />
          Delete rack
        </Button>
        {isOnlyRack && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Add another rack first — can't delete the last rack.
          </p>
        )}
      </div>
    </div>
  )
}

function DevicePropertiesPanel({
  rack,
  device,
  switches,
  servers,
  onEdit,
  onRemove,
  onClose
}: {
  rack: RackInventoryRow
  device: RackMappingDevice
  switches: Switch[]
  servers: Server[]
  onEdit(patch: Partial<RackMappingDevice>): void
  onRemove(): void
  onClose(): void
}) {
  const [label, setLabel] = useState(device.label)
  const [startU, setStartU] = useState(device.start_u.toString())
  const [ru, setRu] = useState(device.ru.toString())

  useEffect(() => {
    setLabel(device.label)
    setStartU(device.start_u.toString())
    setRu(device.ru.toString())
  }, [device])

  const sw = device.role !== 'blank' && device.model_id ? switches.find((s) => s.id === device.model_id) : null
  const sv = device.role === 'server' && device.model_id ? servers.find((s) => s.id === device.model_id) : null

  const nd = device.role === 'nd' ? ndSpecFor(device.model_id) : null
  const modelOptions =
    device.role === 'server'
      ? servers
      : device.role === 'blank' || device.role === 'nd'
        ? []
        : switches.filter((s) => (device.role === 'spine' ? s.role !== 'leaf' : s.role !== 'spine'))

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold">{device.label || device.device_id}</h3>
          <p className="text-xs text-muted-foreground capitalize">
            {device.role} · in {rack.name}
          </p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-3">
        <Field label="Label / Hostname">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => label !== device.label && onEdit({ label })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </Field>

        <Field label="Start U">
          <Input
            type="number"
            min={1}
            max={rack.size_u}
            value={startU}
            onChange={(e) => setStartU(e.target.value)}
            onBlur={() => {
              const n = Number(startU)
              if (Number.isFinite(n) && n >= 1 && n <= rack.size_u && n !== device.start_u) {
                onEdit({ start_u: Math.floor(n) })
              } else {
                setStartU(device.start_u.toString())
              }
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </Field>

        {device.role === 'nd' ? (
          <Field label="Model">
            <div className="text-sm font-mono">{device.model_id}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Nexus Dashboard node — the cluster is chosen on the Requirements tab
              {nd ? ` (${nd.cluster_model_id}, ${nd.ru}RU per node)` : ''}.
            </p>
          </Field>
        ) : device.role === 'blank' ? (
          <Field label="Height (U)">
            <Input
              type="number"
              min={1}
              max={rack.size_u}
              value={ru}
              onChange={(e) => setRu(e.target.value)}
              onBlur={() => {
                const n = Number(ru)
                if (Number.isFinite(n) && n >= 1 && n !== device.ru) {
                  onEdit({ ru: Math.floor(n) })
                } else {
                  setRu(device.ru.toString())
                }
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </Field>
        ) : (
          <Field label="Model">
            <Select
              value={device.model_id ?? ''}
              onValueChange={(v) => {
                if (v === device.model_id) return
                // Picking a new model also updates ru from library
                const newSw =
                  device.role !== 'server'
                    ? switches.find((s) => s.id === v)
                    : null
                const newSv =
                  device.role === 'server' ? servers.find((s) => s.id === v) : null
                const newRu = newSw?.ru ?? newSv?.ru ?? device.ru
                onEdit({ model_id: v, ru: newRu })
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick model" />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.model_display} ({o.id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>

      {/* Library-derived facts */}
      {(sw || sv) && (
        <div className="border-t pt-3 space-y-1 text-xs">
          {sw && (
            <>
              <Kv k="Model ID" v={sw.id} />
              <Kv k="Role" v={sw.role} />
              <Kv k="Primary ports" v={`${sw.primary.ports}× ${sw.primary.speed_g}G`} />
              <Kv k="RU" v={sw.ru?.toString() ?? '(unknown — using 1)'} />
              <Kv k="Power" v={sw.power_w ? `${sw.power_w} W` : `(unknown — using ${DEFAULT_SWITCH_POWER_W} W)`} />
            </>
          )}
          {sv && (
            <>
              <Kv k="Model ID" v={sv.id} />
              <Kv k="RU" v={sv.ru?.toString() ?? '(unknown — using 1)'} />
              <Kv k="Power" v={sv.power_w ? `${sv.power_w} W` : '(unknown — using 0 W)'} />
              {sv.gpu && <Kv k="GPU" v={`${sv.gpu.count}× ${sv.gpu.model}`} />}
            </>
          )}
        </div>
      )}

      <div className="border-t pt-3">
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 />
          Remove from rack
        </Button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Tiny utilities
// ────────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}

function Kv({ k, v, alert }: { k: string; v: string; alert?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn('font-mono', alert && 'text-destructive font-medium')}>{v}</span>
    </div>
  )
}
