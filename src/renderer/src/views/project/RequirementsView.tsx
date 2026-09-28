import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ExternalLink, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  RequirementsFileSchema,
  type RequirementsFile,
  type TierRow,
  type RackInventoryRow,
  type DeploymentType,
  type UseCase,
  type InputMode
} from '@/schemas/project'
import type { Switch } from '@/schemas/switches'
import type { Server } from '@/schemas/servers'
import { effectiveVpc, FABRIC_MODE_LABEL, PEER_LINK_MEMBERS_MAX, PEER_LINK_MEMBERS_MIN, type FabricMode } from '@/schemas/project'
import { loadSwitchesFile, loadIpnRouters, type IpnRouterFileEntry,
  loadServersFile
} from '@/lib/library-io'
import { useWorkspace } from '@/state/WorkspaceContext'

interface RequirementsViewProps {
  initial: RequirementsFile
  projectPath: string
  onSaved(next: RequirementsFile): void
}

const SECTIONS = [
  { id: 'project', label: 'Project info' },
  { id: 'current', label: 'Current network' },
  { id: 'use-case', label: 'Use case' },
  { id: 'tiers', label: 'Tiers' },
  { id: 'fabric', label: 'Fabric' },
  { id: 'constraints', label: 'Constraints' },
  { id: 'racks', label: 'Racks' },
  { id: 'cable', label: 'Cable tray' },
  { id: 'oversub', label: 'Target oversub' }
] as const

const LIBRARY_REVIEW_KEY = (projectPath: string): string =>
  `dcn-designer.review_library_dismissed.${projectPath}`

export function RequirementsView({ initial, projectPath, onSaved }: RequirementsViewProps) {
  const { workspacePath } = useWorkspace()
  const [form, setForm] = useState<RequirementsFile>(() => structuredClone(initial))
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)
  const [switches, setSwitches] = useState<Switch[]>([])
  const [ipnRouters, setIpnRouters] = useState<IpnRouterFileEntry[]>([])
  const [servers, setServers] = useState<Server[]>([])
  const [librarySnoozed, setLibrarySnoozed] = useState<boolean>(() => {
    return localStorage.getItem(LIBRARY_REVIEW_KEY(projectPath)) === '1'
  })
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id)
  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial]
  )

  // Reset state if a new initial is supplied (e.g. after save)
  useEffect(() => {
    setForm(structuredClone(initial))
  }, [initial])

  // Load library switches for tier/spine dropdowns
  useEffect(() => {
    if (!workspacePath) return
    loadSwitchesFile(workspacePath)
      .then((file) => setSwitches(file.switches))
      .catch(() => setSwitches([]))
    loadIpnRouters(workspacePath)
      .then((routers) => setIpnRouters(routers))
      .catch(() => setIpnRouters([]))
    // Phase 14 — server models for the tier's "Show servers" symbol.
    loadServersFile(workspacePath)
      .then((file) => setServers(file.servers))
      .catch(() => setServers([]))
  }, [workspacePath])

  const vpc = useMemo(() => effectiveVpc(form.fabric), [form.fabric])

  const leafCandidates = useMemo(
    () => switches.filter((s) => s.role === 'leaf' || s.role === 'both'),
    [switches]
  )
  const spineCandidates = useMemo(
    () => switches.filter((s) => s.role === 'spine' || s.role === 'both'),
    [switches]
  )

  // ── section scroll-spy ───────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (a.boundingClientRect.top - b.boundingClientRect.top))
        if (visible[0]?.target.id) setActiveSection(visible[0].target.id)
      },
      { root, rootMargin: '-10% 0px -70% 0px', threshold: 0 }
    )
    SECTIONS.forEach((s) => {
      const el = root.querySelector(`#${s.id}`)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  const scrollTo = useCallback((id: string) => {
    const root = scrollRef.current
    if (!root) return
    const el = root.querySelector(`#${id}`) as HTMLElement | null
    if (el) {
      root.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' })
      setActiveSection(id)
    }
  }, [])

  // ── update helpers ───────────────────────────────────────────────
  function patch<K extends keyof RequirementsFile>(key: K, value: RequirementsFile[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaveOk(false)
  }

  // ── save ─────────────────────────────────────────────────────────
  async function handleSave() {
    setSaveErr(null)
    setSaveOk(false)
    const now = new Date().toISOString()
    const candidate: RequirementsFile = {
      ...form,
      project: { ...form.project, last_edited: now }
    }
    const parsed = RequirementsFileSchema.safeParse(candidate)
    if (!parsed.success) {
      setSaveErr(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
      return
    }
    setSaving(true)
    try {
      await window.dcn.writeYaml(`${projectPath}/requirements.yaml`, parsed.data)
      onSaved(parsed.data)
      setSaveOk(true)
      // auto-clear OK indicator after 2s
      setTimeout(() => setSaveOk(false), 2000)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  function dismissLibraryReview() {
    localStorage.setItem(LIBRARY_REVIEW_KEY(projectPath), '1')
    setLibrarySnoozed(true)
  }

  // ── XOR validation (display only — solver enforces too) ──────────
  const tierIssues = useMemo(() => {
    return form.tiers.map((t): string | null => {
      const hasE = t.endpoint_count != null && t.endpoint_count > 0
      const hasS = t.switch_count != null && t.switch_count > 0
      if (hasE && hasS) return 'Endpoint count and switch count cannot both be set'
      return null
    })
  }, [form.tiers])

  return (
    <div className="flex h-full min-h-0">
      {/* Section nav */}
      <nav className="w-48 shrink-0 border-r p-3 space-y-1 overflow-auto">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 px-2">
          Sections
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => scrollTo(s.id)}
            className={cn(
              'w-full text-left px-2 py-1.5 rounded text-sm transition-colors cursor-pointer',
              activeSection === s.id
                ? 'bg-accent text-accent-foreground font-medium'
                : 'hover:bg-accent/60'
            )}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-6 space-y-6">
          {!librarySnoozed && (
            <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/30">
              <CardContent className="py-3 flex items-center justify-between gap-3">
                <div className="text-sm">
                  <span className="font-medium">Any updates to switches?</span>{' '}
                  <span className="text-muted-foreground">
                    Review the library before designing — add new SKUs, update port counts, or
                    flag EoS hardware.
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      window.dispatchEvent(
                        new CustomEvent('dcn-designer:nav', { detail: { route: 'library' } })
                      )
                    }}
                  >
                    Review library
                    <ExternalLink />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={dismissLibraryReview}>
                    <X />
                    Skip
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Section id="project" title="Project info" description="Customer-facing identifiers.">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Project name" required>
                <Input
                  value={form.project.name}
                  onChange={(e) =>
                    patch('project', { ...form.project, name: e.target.value })
                  }
                />
              </Field>
              <Field label="Customer">
                <Input
                  value={form.project.customer}
                  onChange={(e) =>
                    patch('project', { ...form.project, customer: e.target.value })
                  }
                />
              </Field>
              <Field label="Site">
                <Input
                  value={form.project.site}
                  onChange={(e) =>
                    patch('project', { ...form.project, site: e.target.value })
                  }
                />
              </Field>
            </div>
          </Section>

          <Section
            id="current"
            title="Current network"
            description="Context for the design. Mirrors the WIP Sizing tab."
          >
            <div className="grid grid-cols-2 gap-4">
              <Field label="Topology">
                <Input
                  value={form.current_network.topology}
                  onChange={(e) =>
                    patch('current_network', {
                      ...form.current_network,
                      topology: e.target.value
                    })
                  }
                  placeholder="e.g. 3-tier core/agg/access"
                />
              </Field>
              <Field label="Deployment">
                <Select
                  value={form.current_network.deployment_type}
                  onValueChange={(v) =>
                    patch('current_network', {
                      ...form.current_network,
                      deployment_type: v as DeploymentType
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="greenfield">Greenfield</SelectItem>
                    <SelectItem value="brownfield">Brownfield</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Existing endpoints">
                <Input
                  type="number"
                  min={0}
                  value={form.current_network.existing_endpoints ?? ''}
                  onChange={(e) =>
                    patch('current_network', {
                      ...form.current_network,
                      existing_endpoints: e.target.value ? Number(e.target.value) : null
                    })
                  }
                />
              </Field>
              <Field label="Existing racks">
                <Input
                  type="number"
                  min={0}
                  value={form.current_network.existing_racks ?? ''}
                  onChange={(e) =>
                    patch('current_network', {
                      ...form.current_network,
                      existing_racks: e.target.value ? Number(e.target.value) : null
                    })
                  }
                />
              </Field>
            </div>
            <Field label="Notes">
              <Textarea
                rows={2}
                value={form.current_network.notes}
                onChange={(e) =>
                  patch('current_network', { ...form.current_network, notes: e.target.value })
                }
                placeholder="Any current-state details that should inform the design."
              />
            </Field>
          </Section>

          <Section
            id="use-case"
            title="Use case"
            description="Drives solver mode (AI/HPC enforces 1:1)."
          >
            <Field label="Workload type">
              <Select
                value={form.use_case}
                onValueChange={(v) => patch('use_case', v as UseCase)}
              >
                <SelectTrigger className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dcn">DCN (general data center)</SelectItem>
                  <SelectItem value="ai">AI</SelectItem>
                  <SelectItem value="hpc">HPC</SelectItem>
                  <SelectItem value="storage">Storage</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Input mode">
              <Select
                value={form.input_mode}
                onValueChange={(v) => patch('input_mode', v as InputMode)}
              >
                <SelectTrigger className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aggregate">Aggregate</SelectItem>
                  <SelectItem value="per_leaf">Per-leaf (Phase 4 UI)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Per-leaf overrides editor lands in Phase 4. Aggregate is the safe default.
              </p>
            </Field>
          </Section>

          <Section
            id="tiers"
            title="Tiers"
            description="One row per speed tier. Either endpoint count or switch count, not both (v8 rule 8)."
          >
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Label</TableHead>
                    <TableHead className="w-28">Endpoints</TableHead>
                    <TableHead className="w-28">Switches</TableHead>
                    <TableHead>Leaf model</TableHead>
                    <TableHead className="w-32">Uplink override (G)</TableHead>
                    <TableHead className="w-44">Server model</TableHead>
                    <TableHead className="w-12">vPC</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {form.tiers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        No tiers yet. Add a row to describe a leaf-side speed tier.
                      </TableCell>
                    </TableRow>
                  ) : (
                    form.tiers.map((tier, idx) => (
                      <TableRow
                        key={idx}
                        className={tierIssues[idx] ? 'bg-destructive/5' : undefined}
                      >
                        <TableCell>
                          <Input
                            value={tier.speed_tier_label}
                            onChange={(e) =>
                              patchTier(setForm, idx, { speed_tier_label: e.target.value })
                            }
                            placeholder="25G"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            value={tier.endpoint_count ?? ''}
                            onChange={(e) =>
                              patchTier(setForm, idx, {
                                endpoint_count: e.target.value ? Number(e.target.value) : null
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            value={tier.switch_count ?? ''}
                            onChange={(e) =>
                              patchTier(setForm, idx, {
                                switch_count: e.target.value ? Number(e.target.value) : null
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={tier.leaf_model_id ?? '__none'}
                            onValueChange={(v) =>
                              patchTier(setForm, idx, {
                                leaf_model_id: v === '__none' ? null : v
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="(none)" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none">(none)</SelectItem>
                              {leafCandidates.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.id} · {s.primary.ports}× {s.primary.speed_g}G
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            value={tier.override_uplink_speed_g ?? ''}
                            onChange={(e) =>
                              patchTier(setForm, idx, {
                                override_uplink_speed_g: e.target.value
                                  ? Number(e.target.value)
                                  : null
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          {/* Phase 14 — only the Topology "Show servers" symbol reads this. */}
                          <Select
                            value={tier.server_model_id ?? '__none'}
                            onValueChange={(v) =>
                              patchTier(setForm, idx, { server_model_id: v === '__none' ? null : v })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="(generic)" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none">(generic server)</SelectItem>
                              {servers.map((sv) => (
                                <SelectItem key={sv.id} value={sv.id}>
                                  {sv.model_display} · {sv.ports.map((pg) => `${pg.count}×${pg.speed_g}G`).join(' + ') || 'no NICs'}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {/* Phase 14 — off = this tier's leaves are never paired (no peer-link). */}
                          <Checkbox
                            checked={tier.vpc_pairs}
                            aria-label="vPC-pair this tier's leaves"
                            title="vPC-pair this tier's leaves (off = no pairs, no peer-link)"
                            onCheckedChange={(v) => patchTier(setForm, idx, { vpc_pairs: !!v })}
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeTier(setForm, idx)}
                            aria-label="Remove tier"
                          >
                            <Trash2 />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {tierIssues.some(Boolean) && (
              <ul className="text-xs text-destructive space-y-0.5 mt-2">
                {tierIssues.map((msg, i) =>
                  msg ? (
                    <li key={i}>
                      Row {i + 1}: {msg}
                    </li>
                  ) : null
                )}
              </ul>
            )}
            <div className="flex justify-start">
              <Button variant="outline" size="sm" onClick={() => addTier(setForm)}>
                <Plus />
                Add tier
              </Button>
            </div>
          </Section>

          <Section id="fabric" title="Fabric" description="Uplinks and spine selection.">
            <div className="grid grid-cols-3 gap-4">
              <Field label="Uplinks per leaf">
                <Input
                  type="number"
                  min={1}
                  value={form.fabric.uplinks_per_leaf}
                  onChange={(e) =>
                    patch('fabric', {
                      ...form.fabric,
                      uplinks_per_leaf: Number(e.target.value) || 1
                    })
                  }
                />
              </Field>
              <Field label="Uplinks per spine">
                <Input
                  type="number"
                  min={1}
                  value={form.fabric.uplinks_per_spine}
                  onChange={(e) =>
                    patch('fabric', {
                      ...form.fabric,
                      uplinks_per_spine: Number(e.target.value) || 1
                    })
                  }
                />
              </Field>
              <Field label="Spine model">
                <Select
                  value={form.fabric.spine_model_id ?? '__none'}
                  onValueChange={(v) =>
                    patch('fabric', {
                      ...form.fabric,
                      spine_model_id: v === '__none' ? null : v
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="(none)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">(none)</SelectItem>
                    {spineCandidates.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.id} · {s.primary.ports}× {s.primary.speed_g}G
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              {`Spines/leaf = uplinks_per_leaf / uplinks_per_spine = ${
                form.fabric.uplinks_per_spine > 0
                  ? form.fabric.uplinks_per_leaf / form.fabric.uplinks_per_spine
                  : '—'
              }`}
              {form.fabric.uplinks_per_spine > 0 &&
                form.fabric.uplinks_per_leaf % form.fabric.uplinks_per_spine !== 0 && (
                  <span className="text-destructive">
                    {' '}
                    — not evenly divisible; solver will flag invalid.
                  </span>
                )}
            </p>

            {/* ── Fabric mode + vPC leaf pairs (Phase 14) ─────────────── */}
            <div className="border-t pt-4 space-y-3">
              <div className="grid grid-cols-3 gap-4">
                <Field label="Fabric mode">
                  <Select
                    value={form.fabric.mode}
                    onValueChange={(v) => patch('fabric', { ...form.fabric, mode: v as FabricMode })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(FABRIC_MODE_LABEL) as FabricMode[]).map((m) => (
                        <SelectItem key={m} value={m}>
                          {FABRIC_MODE_LABEL[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Peer-link members">
                  <Input
                    type="number"
                    min={PEER_LINK_MEMBERS_MIN}
                    max={PEER_LINK_MEMBERS_MAX}
                    disabled={!vpc.peer_link}
                    value={form.fabric.peer_link_members}
                    onChange={(e) =>
                      patch('fabric', {
                        ...form.fabric,
                        peer_link_members: Math.min(
                          PEER_LINK_MEMBERS_MAX,
                          Math.max(PEER_LINK_MEMBERS_MIN, Number(e.target.value) || PEER_LINK_MEMBERS_MIN)
                        )
                      })
                    }
                  />
                </Field>
                <div className="space-y-2 pt-6">
                  <label className={`flex items-center gap-2 text-sm ${form.fabric.mode === 'nxos-evpn' ? 'cursor-pointer' : 'opacity-60'}`}>
                    <Checkbox
                      checked={vpc.peer_link}
                      disabled={form.fabric.mode !== 'nxos-evpn'}
                      onCheckedChange={(v) => patch('fabric', { ...form.fabric, peer_link_enabled: !!v })}
                    />
                    vPC peer-link
                  </label>
                  <label className={`flex items-center gap-2 text-sm ${form.fabric.mode === 'nxos-evpn' && vpc.peer_link ? 'cursor-pointer' : 'opacity-60'}`}>
                    <Checkbox
                      checked={vpc.port_channel}
                      disabled={form.fabric.mode !== 'nxos-evpn' || !vpc.peer_link}
                      onCheckedChange={(v) => patch('fabric', { ...form.fabric, peer_link_port_channel: !!v })}
                    />
                    Port-channel
                  </label>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {form.fabric.mode === 'nxos-classic' &&
                  'Classic vPC: every leaf pair gets a peer-link in a port-channel (mandatory).'}
                {form.fabric.mode === 'nxos-evpn' &&
                  'VXLAN EVPN: the peer-link and its port-channel are optional (both on by default).'}
                {form.fabric.mode === 'aci' &&
                  'ACI: leaf pairs are logical only — no peer-link, no port-channel; the topology shows a bracket.'}
                {vpc.peer_link &&
                  ` The peer-link takes ${vpc.members} port${vpc.members === 1 ? '' : 's'} per leaf from the uplink group (first ports; spine uplinks then use the last ones) — the solver reduces uplinks per leaf if needed and warns.`}
              </p>
            </div>

            {/* ── ACI Multi-Pod (Phase 9b) ─────────────────────────── */}
            <div className="border-t pt-4 space-y-3">
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={form.fabric.aci_multipod_allowed}
                  onCheckedChange={(v) =>
                    patch('fabric', { ...form.fabric, aci_multipod_allowed: !!v })
                  }
                />
                <span>
                  Allow ACI Multi-Pod
                  <span className="block text-xs text-muted-foreground">
                    Lets the solver offer multi-pod candidates. Requires Cisco Premier+ licensing
                    in production. Unchecking blocks multi-pod candidates (they still appear, marked
                    license-blocked).
                  </span>
                </span>
              </label>
              <Field label="IPN router model">
                <Select
                  value={form.fabric.ipn_router_model_id ?? '__auto'}
                  onValueChange={(v) =>
                    patch('fabric', {
                      ...form.fabric,
                      ipn_router_model_id: v === '__auto' ? null : v
                    })
                  }
                >
                  <SelectTrigger className="max-w-md">
                    <SelectValue placeholder="(auto)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto">Auto (first in library)</SelectItem>
                    {ipnRouters.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.model_display ?? r.id} · {r.primary.ports}× {r.primary.speed_g}G
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <p className="text-xs text-muted-foreground">
                Inter-Pod Network router used to stitch pods together (2 per site for HA). The
                solver reserves {`${4}`} ports per spine per IPN.
              </p>
            </div>
          </Section>

          <Section id="constraints" title="Constraints" description="Solver filters and notes.">
            <div className="grid grid-cols-2 gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={form.constraints.aci_capable_required}
                  onCheckedChange={(v) =>
                    patch('constraints', {
                      ...form.constraints,
                      aci_capable_required: !!v
                    })
                  }
                />
                ACI-capable required
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={form.constraints.rocev2_required}
                  onCheckedChange={(v) =>
                    patch('constraints', {
                      ...form.constraints,
                      rocev2_required: !!v
                    })
                  }
                />
                RoCEv2 required
              </label>
              <Field label="License tier">
                <Select
                  value={form.constraints.license_tier ?? '__none'}
                  onValueChange={(v) =>
                    patch('constraints', {
                      ...form.constraints,
                      license_tier:
                        v === '__none' ? null : (v as 'essentials' | 'advantage' | 'premier')
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="(none)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">(none)</SelectItem>
                    <SelectItem value="essentials">Essentials</SelectItem>
                    <SelectItem value="advantage">Advantage</SelectItem>
                    <SelectItem value="premier">Premier</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Cooling">
                <Input
                  value={form.constraints.cooling}
                  onChange={(e) =>
                    patch('constraints', { ...form.constraints, cooling: e.target.value })
                  }
                  placeholder="e.g. front-to-back, liquid"
                />
              </Field>
            </div>
            <Field label="Constraint notes">
              <Textarea
                rows={2}
                value={form.constraints.notes}
                onChange={(e) =>
                  patch('constraints', { ...form.constraints, notes: e.target.value })
                }
              />
            </Field>
          </Section>

          <Section
            id="racks"
            title="Racks"
            description="Rack inventory used by the solver's placement heuristic and PDU budget check."
          >
            <Field label="Racks per row">
              <Input
                type="number"
                min={1}
                step={1}
                value={form.racks_per_row ?? ''}
                onChange={(e) =>
                  patch('racks_per_row', e.target.value ? Math.max(1, Math.floor(Number(e.target.value))) : null)
                }
                placeholder="e.g. 10"
                className="max-w-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Racks are read as physical rows of this many, in list order. The solver puts one spine in
                each row (first rack of the row) and the Rack view and PDF caption the rows. Leave empty for
                no row structure.
              </p>
            </Field>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-24">Size (U)</TableHead>
                    <TableHead className="w-32">PDU budget (kW)</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Tags</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {form.racks.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        No racks yet. Solver will place everything in one logical rack until you add some.
                      </TableCell>
                    </TableRow>
                  ) : (
                    form.racks.map((rack, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <Input
                            value={rack.name}
                            onChange={(e) =>
                              patchRack(setForm, idx, { name: e.target.value })
                            }
                            placeholder="Rack 1"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={1}
                            value={rack.size_u}
                            onChange={(e) =>
                              patchRack(setForm, idx, {
                                size_u: Number(e.target.value) || 44
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            step={0.1}
                            value={rack.pdu_kw_budget ?? ''}
                            onChange={(e) =>
                              patchRack(setForm, idx, {
                                pdu_kw_budget: e.target.value ? Number(e.target.value) : null
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={rack.location}
                            onChange={(e) =>
                              patchRack(setForm, idx, { location: e.target.value })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={rack.tags.join(', ')}
                            onChange={(e) =>
                              patchRack(setForm, idx, {
                                tags: e.target.value
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean)
                              })
                            }
                            placeholder="e.g. pod-a, ai"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeRack(setForm, idx)}
                            aria-label="Remove rack"
                          >
                            <Trash2 />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-start">
              <Button variant="outline" size="sm" onClick={() => addRack(setForm)}>
                <Plus />
                Add rack
              </Button>
            </div>
          </Section>

          <Section
            id="cable"
            title="Cable tray"
            description="Distance feeds the cable-length BOM (Phase 9)."
          >
            <Field label="Cable tray length (m)">
              <Input
                type="number"
                min={0}
                step={0.1}
                value={form.cable_tray_m ?? ''}
                onChange={(e) =>
                  patch('cable_tray_m', e.target.value ? Number(e.target.value) : null)
                }
                className="max-w-xs"
              />
            </Field>
          </Section>

          <Section
            id="oversub"
            title="Target oversub (informational)"
            description="Display-only. The solver computes actual oversub from inputs (v8 rule 9)."
          >
            <Field label="Target ratio (host : uplink)">
              <Input
                type="number"
                min={0.1}
                step={0.1}
                value={form.target_oversub_informational ?? ''}
                onChange={(e) =>
                  patch(
                    'target_oversub_informational',
                    e.target.value ? Number(e.target.value) : null
                  )
                }
                className="max-w-xs"
                placeholder="e.g. 3 for 3:1"
              />
            </Field>
          </Section>

          <div className="h-12" />
        </div>

        {/* Save bar */}
        <footer className="border-t bg-background/70 backdrop-blur px-6 py-3 flex items-center gap-3">
          <div className="flex-1 text-xs text-muted-foreground">
            {dirty ? 'Unsaved changes' : 'All changes saved'}
          </div>
          {saveErr && <div className="text-xs text-destructive max-w-md truncate">{saveErr}</div>}
          {saveOk && (
            <div className="text-xs text-emerald-600 flex items-center gap-1">
              <Check className="size-3.5" /> Saved
            </div>
          )}
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save requirements'}
          </Button>
        </footer>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function patchTier(
  setForm: React.Dispatch<React.SetStateAction<RequirementsFile>>,
  idx: number,
  patch: Partial<TierRow>
): void {
  setForm((prev) => ({
    ...prev,
    tiers: prev.tiers.map((t, i) => (i === idx ? { ...t, ...patch } : t))
  }))
}

function addTier(setForm: React.Dispatch<React.SetStateAction<RequirementsFile>>): void {
  setForm((prev) => ({
    ...prev,
    tiers: [
      ...prev.tiers,
      {
        speed_tier_label: '',
        endpoint_count: null,
        switch_count: null,
        leaf_model_id: null,
        override_uplink_speed_g: null,
        server_model_id: null,
        vpc_pairs: true
      }
    ]
  }))
}

function removeTier(
  setForm: React.Dispatch<React.SetStateAction<RequirementsFile>>,
  idx: number
): void {
  setForm((prev) => ({ ...prev, tiers: prev.tiers.filter((_, i) => i !== idx) }))
}

function patchRack(
  setForm: React.Dispatch<React.SetStateAction<RequirementsFile>>,
  idx: number,
  patch: Partial<RackInventoryRow>
): void {
  setForm((prev) => ({
    ...prev,
    racks: prev.racks.map((r, i) => (i === idx ? { ...r, ...patch } : r))
  }))
}

function addRack(setForm: React.Dispatch<React.SetStateAction<RequirementsFile>>): void {
  setForm((prev) => ({
    ...prev,
    racks: [
      ...prev.racks,
      { name: `Rack ${prev.racks.length + 1}`, size_u: 44, pdu_kw_budget: null, location: '', tags: [] }
    ]
  }))
}

function removeRack(
  setForm: React.Dispatch<React.SetStateAction<RequirementsFile>>,
  idx: number
): void {
  setForm((prev) => ({ ...prev, racks: prev.racks.filter((_, i) => i !== idx) }))
}

function Section({
  id,
  title,
  description,
  children
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Card id={id} className="scroll-mt-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

function Field({
  label,
  required,
  children
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
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
