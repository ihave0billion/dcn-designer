import type { DesignResult } from '@domain'
import type { CableLink } from '@/schemas/cable-links'

// Phase 7 topology data extractor.
//
// Takes a solver `DesignResult` (rack_layout) + the cable_links.yaml
// (port-to-port wiring) and produces:
//  - nodes: spines + leaves only (Q1: server↔leaf wiring is implicit and
//    out of scope for the topology canvas).
//  - per-node usedPorts: only the ports that actually appear in
//    cable_links.yaml — these become react-flow Handle elements (Q4:
//    handles only for ports in cable_links.yaml).
//  - edges: one per cable link.
//
// Devices referenced by cable_links.yaml that don't exist in
// design.rack_layout are still surfaced as a synthetic node so the
// edge has somewhere to attach (and a count of orphans is returned for
// drift-detection later — see JOURNAL "Solver-regen drift detection").

export type TopologyRole = 'spine' | 'leaf' | 'ipn'

export interface TopologyNode {
  id: string // matches device_id from rack_layout / cable_links
  role: TopologyRole
  model_id: string
  rack: string | null
  label: string
  ru: number | null
  power_w: number | null
  // ACI Multi-Pod membership (Phase 9b). null/undefined on single-pod
  // designs and on IPN routers (shared across pods). Drives pod-boundary
  // grouping. Optional so pre-9b fixtures and callers stay valid.
  pod_index?: number | null
  // v1.2 display metadata, filled in by lib/device-nickname.ts
  // (applyNicknames) — `label` is then the hostname shown on the canvas.
  smart?: boolean
  hostname_source?: 'user' | 'auto'
  // Ports that have at least one cable link attached. Stable-sorted.
  // These render as react-flow Handles on the node.
  usedPorts: string[]
}

export interface TopologyEdge {
  id: string // matches cable link id
  source: string // device_id (spine for fabric uplinks)
  sourcePort: string
  target: string // device_id (leaf for fabric uplinks)
  targetPort: string
  speed_g: number
  optic_id: string | null
  patch_panel_id: string | null
  label: string
  length_m: number | null
}

export interface TopologyGraph {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  // device_ids referenced by cable_links.yaml but absent from
  // design.rack_layout. Phase 7 still renders them as orphan nodes so
  // edges aren't dropped silently — Phase 10 polish can surface this in
  // a banner.
  orphanDeviceIds: string[]
}

interface DeviceMeta {
  role: TopologyRole
  model_id: string
  rack: string | null
  label: string
  ru: number | null
  power_w: number | null
  pod_index: number | null
}

// Walk rack_layout and collect IPN + spine + leaf devices keyed by
// device_id. Stable order: IPNs first, then spines, then leaves (rack
// order within each). Servers are dropped per Phase 7 Q1.
function collectDevicesFromLayout(design: DesignResult): {
  ipns: Array<{ id: string } & DeviceMeta>
  spines: Array<{ id: string } & DeviceMeta>
  leaves: Array<{ id: string } & DeviceMeta>
} {
  const ipns: Array<{ id: string } & DeviceMeta> = []
  const spines: Array<{ id: string } & DeviceMeta> = []
  const leaves: Array<{ id: string } & DeviceMeta> = []
  for (const rack of design.rack_layout) {
    for (const d of rack.devices) {
      if (d.role !== 'spine' && d.role !== 'leaf' && d.role !== 'ipn') continue
      const entry = {
        id: d.device_id,
        role: d.role as TopologyRole,
        model_id: d.model_id,
        rack: rack.rack_name,
        label: d.label || d.device_id,
        ru: d.ru ?? null,
        power_w: null,
        pod_index: d.pod_index ?? null
      } satisfies { id: string } & DeviceMeta
      if (d.role === 'ipn') ipns.push(entry)
      else if (d.role === 'spine') spines.push(entry)
      else leaves.push(entry)
    }
  }
  return { ipns, spines, leaves }
}

// Fallback: when rack_layout is empty (no racks defined yet), synthesise
// spines + leaves directly from the spine summary + per-tier leaf counts
// so Topology View still renders something. Mirrors the same fallback
// in cable-links-seeder.ts.
function synthesiseDevicesFromSummary(design: DesignResult): {
  spines: Array<{ id: string } & DeviceMeta>
  leaves: Array<{ id: string } & DeviceMeta>
} {
  const spines: Array<{ id: string } & DeviceMeta> = []
  const leaves: Array<{ id: string } & DeviceMeta> = []
  if (design.spine) {
    for (let i = 0; i < design.spine.spines_needed; i++) {
      spines.push({
        id: `spine-${i + 1}`,
        role: 'spine',
        model_id: design.spine.spine_model_id,
        rack: null,
        label: `Spine ${i + 1}`,
        ru: null,
        power_w: null,
        pod_index: null
      })
    }
  }
  let serial = 0
  for (const t of design.tiers) {
    if (t.xor_status !== 'ok') continue
    for (let i = 0; i < t.leaves_required; i++) {
      serial += 1
      leaves.push({
        id: `leaf-${serial}`,
        role: 'leaf',
        model_id: t.leaf_model_id,
        rack: null,
        label: `Leaf ${serial}`,
        ru: null,
        power_w: null,
        pod_index: null
      })
    }
  }
  return { spines, leaves }
}

export function extractTopology(
  design: DesignResult,
  cableLinks: CableLink[]
): TopologyGraph {
  let { ipns, spines, leaves } = collectDevicesFromLayout(design)
  if (spines.length === 0 && leaves.length === 0) {
    ;({ spines, leaves } = synthesiseDevicesFromSummary(design))
    ipns = []
  }

  const meta = new Map<string, DeviceMeta>()
  for (const ip of ipns) meta.set(ip.id, ip)
  for (const s of spines) meta.set(s.id, s)
  for (const l of leaves) meta.set(l.id, l)

  // Walk cable_links to compute the per-device used-port set + collect
  // orphan device ids (referenced but not in the rack_layout).
  const portsByDevice = new Map<string, Set<string>>()
  const orphans = new Set<string>()
  const ensurePortBag = (deviceId: string): Set<string> => {
    let bag = portsByDevice.get(deviceId)
    if (!bag) {
      bag = new Set()
      portsByDevice.set(deviceId, bag)
    }
    return bag
  }
  for (const link of cableLinks) {
    ensurePortBag(link.device_a.device_id).add(link.device_a.port)
    ensurePortBag(link.device_b.device_id).add(link.device_b.port)
    if (!meta.has(link.device_a.device_id)) orphans.add(link.device_a.device_id)
    if (!meta.has(link.device_b.device_id)) orphans.add(link.device_b.device_id)
  }

  // Promote orphans to leaf-role nodes so they render somewhere. Leaves
  // are the safer default — usually a deleted leaf the user kept a link to.
  for (const orphanId of orphans) {
    if (meta.has(orphanId)) continue
    meta.set(orphanId, {
      role: 'leaf',
      model_id: 'unknown',
      rack: null,
      label: orphanId,
      ru: null,
      power_w: null,
      pod_index: null
    })
    leaves.push({
      id: orphanId,
      role: 'leaf',
      model_id: 'unknown',
      rack: null,
      label: orphanId,
      ru: null,
      power_w: null,
      pod_index: null
    })
  }

  const buildNode = (entry: { id: string } & DeviceMeta): TopologyNode => {
    const used = portsByDevice.get(entry.id)
    const usedPorts = used ? [...used].sort(comparePortNames) : []
    return {
      id: entry.id,
      role: entry.role,
      model_id: entry.model_id,
      rack: entry.rack,
      label: entry.label,
      ru: entry.ru,
      power_w: entry.power_w,
      pod_index: entry.pod_index,
      usedPorts
    }
  }

  // IPNs on top, spines in the middle, leaves on the bottom — same order
  // they came from the layout walk.
  const nodes: TopologyNode[] = [
    ...ipns.map(buildNode),
    ...spines.map(buildNode),
    ...leaves.map(buildNode)
  ]

  // Edges: source = spine end if either end is a spine; otherwise just
  // device_a. cable_links.yaml seeded from Phase 6 always has device_a =
  // spine, but a user-imported CSV could swap them. (Both spine↔leaf and
  // spine↔IPN links keep spine as the source.)
  const spineIds = new Set(spines.map((s) => s.id))
  const edges: TopologyEdge[] = cableLinks.map((link) => {
    const aIsSpine = spineIds.has(link.device_a.device_id)
    const bIsSpine = spineIds.has(link.device_b.device_id)
    const sourceFirst = aIsSpine || (!aIsSpine && !bIsSpine)
    const sourceEnd = sourceFirst ? link.device_a : link.device_b
    const targetEnd = sourceFirst ? link.device_b : link.device_a
    return {
      id: link.id,
      source: sourceEnd.device_id,
      sourcePort: sourceEnd.port,
      target: targetEnd.device_id,
      targetPort: targetEnd.port,
      speed_g: link.speed_g,
      optic_id: link.optic_id,
      patch_panel_id: link.patch_panel_id,
      label: link.label,
      length_m: link.length_m
    }
  })

  return { nodes, edges, orphanDeviceIds: [...orphans] }
}

// Sort port names like "Eth1/1", "Eth1/2", ..., "Eth1/49/1", "Eth1/49/2"
// in their natural order rather than lexicographic. Falls back to
// localeCompare for non-numeric segments.
export function comparePortNames(a: string, b: string): number {
  const tokA = tokenisePortName(a)
  const tokB = tokenisePortName(b)
  const max = Math.max(tokA.length, tokB.length)
  for (let i = 0; i < max; i++) {
    const ta = tokA[i]
    const tb = tokB[i]
    if (ta == null) return -1
    if (tb == null) return 1
    if (typeof ta === 'number' && typeof tb === 'number') {
      if (ta !== tb) return ta - tb
    } else {
      const sa = String(ta)
      const sb = String(tb)
      const cmp = sa.localeCompare(sb)
      if (cmp !== 0) return cmp
    }
  }
  return 0
}

function tokenisePortName(name: string): Array<string | number> {
  const tokens: Array<string | number> = []
  const re = /(\d+)|([^\d]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(name)) !== null) {
    if (m[1] != null) tokens.push(parseInt(m[1], 10))
    else tokens.push(m[2])
  }
  return tokens
}
