import type { DesignResult, BreakoutPair } from '@domain'
import { IPN_PORTS_PER_SPINE_PER_IPN } from '@domain'
import type { Switch } from '@/schemas/switches'
import type { PatchPanel } from '@/schemas/patch-panels'
import type { CableLink } from '@/schemas/cable-links'
import type { LeafPair } from '@/schemas/leaf-pairs'
import { expandPortTemplate } from './port-template'
import { resolvePatchPanel } from './patch-panel-resolver'
import { peerLinkGroupFor } from '@domain'
import { switchToSpec } from './solver-bridge'

// Auto-seed the fabric uplink wiring (leaf → spine only) from a fresh
// design.yaml. Server ↔ leaf links are NOT seeded per Phase 6 Q2 — host
// wiring is implicit.
//
// Algorithm:
//   1. Pull spine + leaf devices from design.rack_layout.
//   2. For each leaf, expand the leaf's uplink port template (or
//      secondary_uplink based on the tier's effective_uplink_choice).
//   3. Round-robin distribute each leaf's uplink ports across spines:
//        - spinesPerLeaf = uplinks_per_leaf / uplinks_per_spine
//        - leaf li touches spines [(li * spinesPerLeaf + k) % spines_needed]
//          for k in 0..spinesPerLeaf-1
//        - each "touch" uses uplinks_per_spine sequential leaf ports
//   4. Per-spine port assignment is sequential within the spine's
//      primary port list. Under breakout (recommended_pair.fanout > 1),
//      each base spine port is expanded to N sub-ports named
//      `<base>/<sub>` (NX-OS-style) so each leaf link still maps to a
//      unique device_b.port.
//   5. Optic + patch-panel defaults come from the design's
//      breakout analysis when in effect.

export interface SeedCableLinksInput {
  design: DesignResult
  switches: Switch[]
  fabric: { uplinks_per_leaf: number; uplinks_per_spine: number }
  breakoutPairs: BreakoutPair[]
  patchPanels: PatchPanel[]
  // Phase 14 — vPC peer-links. Omitted = read design.vpc (members, pairs);
  // an explicit `pairs` (the leaf_pairs.yaml fork) wins over the solver's.
  vpc?: { peer_link: boolean; port_channel: boolean; members: number } | null
  pairs?: LeafPair[] | null
}

export interface SeedCableLinksResult {
  links: CableLink[]
  notes: string[]
}

interface LeafDevice {
  device_id: string
  model_id: string
  rack: string | null
  label: string
}

interface SpineDevice {
  device_id: string
  model_id: string
  rack: string | null
  label: string
}

function devicesFromLayout(design: DesignResult): {
  spines: SpineDevice[]
  leaves: LeafDevice[]
} {
  const spines: SpineDevice[] = []
  const leaves: LeafDevice[] = []
  for (const rack of design.rack_layout) {
    for (const d of rack.devices) {
      if (d.role === 'spine') {
        spines.push({
          device_id: d.device_id,
          model_id: d.model_id,
          rack: rack.rack_name,
          label: d.label
        })
      } else if (d.role === 'leaf') {
        leaves.push({
          device_id: d.device_id,
          model_id: d.model_id,
          rack: rack.rack_name,
          label: d.label
        })
      }
    }
  }
  // When rack_layout is empty (no racks defined), fall back to synthesising
  // devices straight from spine + tier counts so seeding still produces
  // a usable wiring map.
  if (spines.length === 0 && design.spine) {
    for (let i = 0; i < design.spine.spines_needed; i++) {
      spines.push({
        device_id: `spine-${i + 1}`,
        model_id: design.spine.spine_model_id,
        rack: null,
        label: `Spine ${i + 1}`
      })
    }
  }
  if (leaves.length === 0) {
    let serial = 0
    for (const t of design.tiers) {
      if (t.xor_status !== 'ok') continue
      for (let i = 0; i < t.leaves_required; i++) {
        serial += 1
        leaves.push({
          device_id: `leaf-${serial}`,
          model_id: t.leaf_model_id,
          rack: null,
          label: `Leaf ${serial}`
        })
      }
    }
  }
  return { spines, leaves }
}

// Leaf-side uplink ports per the tier's effective choice. Falls back to
// primary uplink, then primary ports, so the seeder never produces an
// empty port list.
function leafUplinkPorts(
  leafModelId: string,
  effectiveChoice: 'primary' | 'secondary',
  switches: Switch[]
): string[] {
  const sw = switches.find((s) => s.id === leafModelId)
  if (!sw) return []
  const grp =
    effectiveChoice === 'secondary' && sw.secondary_uplink
      ? sw.secondary_uplink
      : sw.uplink ?? sw.primary
  try {
    return expandPortTemplate(grp.naming_template)
  } catch {
    return []
  }
}

// Phase 14 — the ports a leaf spends on its vPC peer-link (decision 3):
// the library's `peer_link_ports` template when set, else the FIRST ports of
// the group `peerLinkGroupFor` picks (the tier's highest-speed uplink group
// when it still has room for the spine uplinks, else the leaf's other uplink
// group). `uplinksPerLeaf` is the configured value the rule checks against.
export function peerLinkPorts(sw: Switch, members: number, uplinksPerLeaf = 0): { ports: string[]; speed_g: number } {
  if (members <= 0) return { ports: [], speed_g: 0 }
  if (sw.peer_link_ports) {
    let ports: string[]
    try {
      ports = expandPortTemplate(sw.peer_link_ports)
    } catch {
      ports = []
    }
    // A template that names ports of another group takes that group's speed.
    let speed_g = (sw.uplink ?? sw.primary).speed_g
    const owner = [sw.uplink, sw.secondary_uplink, sw.primary].find((g) => {
      if (!g) return false
      try {
        const all = expandPortTemplate(g.naming_template)
        return ports.length > 0 && ports.every((p) => all.includes(p))
      } catch {
        return false
      }
    })
    if (owner) speed_g = owner.speed_g
    return { ports: ports.slice(0, members), speed_g }
  }
  const choice = peerLinkGroupFor(switchToSpec(sw), members, uplinksPerLeaf)
  const group = (choice.group === 'uplink' ? sw.uplink : choice.group === 'secondary_uplink' ? sw.secondary_uplink : sw.primary) ?? sw.primary
  let ports: string[]
  try {
    ports = expandPortTemplate(group.naming_template)
  } catch {
    ports = []
  }
  return { ports: ports.slice(0, members), speed_g: group.speed_g }
}

/** Default peer-link template shown as the library field's placeholder. */
export function defaultPeerLinkTemplate(sw: Switch, members = 2, uplinksPerLeaf = 0): string {
  const { ports } = peerLinkPorts({ ...sw, peer_link_ports: null }, members, uplinksPerLeaf)
  if (ports.length === 0) return ''
  const m = /^(.*?)(\d+)$/.exec(ports[0])
  const last = /^(.*?)(\d+)$/.exec(ports[ports.length - 1])
  if (m && last && m[1] === last[1]) return `${m[1]}{${m[2]}..${last[2]}}`
  return ports.join(', ')
}

function spinePrimaryPorts(spineModelId: string, switches: Switch[]): string[] {
  const sw = switches.find((s) => s.id === spineModelId)
  if (!sw) return []
  try {
    return expandPortTemplate(sw.primary.naming_template)
  } catch {
    return []
  }
}

// Detect whether the design committed to the breakout option (we honor
// the solver's view: breakout_required_to_be_valid OR the committed
// spine count matches spines_with_breakout and is less than no-breakout).
function isBreakoutInEffect(design: DesignResult): boolean {
  const s = design.summary
  if (s.breakout_required_to_be_valid) return true
  if (s.spines_with_breakout != null && s.spines_with_breakout === s.total_spines && s.spines_with_breakout < s.spines_no_breakout) {
    return true
  }
  return false
}

export function seedCableLinks(input: SeedCableLinksInput): SeedCableLinksResult {
  const { design, switches, fabric, patchPanels } = input
  const notes: string[] = []
  const links: CableLink[] = []

  // Phase 14 — peer-link settings + pairs (fork file wins over the solver).
  const vpc = input.vpc === undefined ? design.vpc ?? null : input.vpc
  const peerLinkOn = !!vpc && vpc.peer_link && vpc.members > 0
  const pairs: LeafPair[] = input.pairs ?? design.vpc?.pairs ?? []
  const reservedByLeaf = new Map<string, string[]>()
  // The group rule checks against the CONFIGURED uplinks (what the user asked
  // for), exactly as the solver's budget did.
  const configuredUplinks = design.vpc?.configured_uplinks_per_leaf ?? fabric.uplinks_per_leaf

  if (!design.spine || design.spine.spines_needed === 0) {
    notes.push('No spine sized — cable_links seed skipped.')
    return { links, notes }
  }
  if (design.tiers.every((t) => t.xor_status !== 'ok' || t.leaves_required === 0)) {
    notes.push('No valid leaf tier — cable_links seed skipped.')
    return { links, notes }
  }

  const { spines, leaves } = devicesFromLayout(design)
  if (spines.length === 0 || leaves.length === 0) {
    notes.push('No spines or leaves resolved — cable_links seed skipped.')
    return { links, notes }
  }

  const tierByLeafModel = new Map<string, (typeof design.tiers)[number]>()
  for (const t of design.tiers) {
    if (t.xor_status === 'ok') tierByLeafModel.set(t.leaf_model_id, t)
  }

  const breakoutOn = isBreakoutInEffect(design)
  const recommended = design.breakout?.recommended_pair ?? null
  const fanout = breakoutOn ? recommended?.fanout ?? 1 : 1
  const patchPanelNeeded = Boolean(breakoutOn && design.breakout?.patch_panel_needed)

  let patchPanelId: string | null = null
  if (patchPanelNeeded && recommended) {
    const resolved = resolvePatchPanel(
      patchPanels,
      recommended.spine_connector,
      recommended.leaf_connector
    )
    patchPanelId = resolved.panel_id
    if (!resolved.matched) {
      notes.push(
        `Patch panel placeholder "${resolved.panel_id}" used — no curated cassette matches ${recommended.spine_connector} ↔ ${recommended.leaf_connector}.`
      )
    }
  }

  const spinePortsByDevice = new Map<string, string[]>()
  for (const sp of spines) {
    const base = spinePrimaryPorts(sp.model_id, switches)
    if (fanout > 1) {
      const expanded: string[] = []
      for (const p of base) {
        for (let sub = 1; sub <= fanout; sub++) expanded.push(`${p}/${sub}`)
      }
      spinePortsByDevice.set(sp.device_id, expanded)
    } else {
      spinePortsByDevice.set(sp.device_id, base)
    }
  }

  const spinePortCursors = new Map<string, number>()
  for (const sp of spines) spinePortCursors.set(sp.device_id, 0)

  const uplinks_per_leaf = fabric.uplinks_per_leaf
  const uplinks_per_spine = fabric.uplinks_per_spine
  if (uplinks_per_leaf <= 0 || uplinks_per_spine <= 0) {
    notes.push('Invalid fabric uplink config — cable_links seed skipped.')
    return { links, notes }
  }
  const spinesPerLeaf = uplinks_per_leaf / uplinks_per_spine
  if (!Number.isInteger(spinesPerLeaf)) {
    notes.push(
      `uplinks_per_leaf (${uplinks_per_leaf}) is not evenly divisible by uplinks_per_spine (${uplinks_per_spine}) — cable_links seed skipped.`
    )
    return { links, notes }
  }

  const spineCount = spines.length

  let linkSerial = 0
  let overflowWarned = false

  for (let li = 0; li < leaves.length; li++) {
    const leaf = leaves[li]
    const tier = tierByLeafModel.get(leaf.model_id) ?? null
    const choice: 'primary' | 'secondary' =
      tier?.effective_uplink_choice ?? 'primary'
    const speed_g =
      tier?.override_uplink_speed_applied_g ?? tier?.effective_uplink_speed_g ?? 0
    let leafPorts = leafUplinkPorts(leaf.model_id, choice, switches)
    // Phase 14 — the peer-link owns the first ports of the group; spine
    // uplinks are then taken from the END of what remains (decision 3).
    const leafSw = switches.find((s) => s.id === leaf.model_id)
    if (peerLinkOn && leafSw && pairs.some((p) => p.members.includes(leaf.device_id))) {
      const reserved = peerLinkPorts(leafSw, vpc!.members, configuredUplinks).ports
      reservedByLeaf.set(leaf.device_id, reserved)
      const remaining = leafPorts.filter((p) => !reserved.includes(p))
      leafPorts = remaining.slice(Math.max(0, remaining.length - uplinks_per_leaf))
    }
    if (leafPorts.length < uplinks_per_leaf) {
      notes.push(
        `Leaf ${leaf.device_id} (${leaf.model_id}) has only ${leafPorts.length} ports in its uplink template — needed ${uplinks_per_leaf}. Seeded what fits.`
      )
    }
    const opticId =
      breakoutOn && recommended ? recommended.leaf_pid : null

    for (let port_idx = 0; port_idx < uplinks_per_leaf; port_idx++) {
      const leafPort = leafPorts[port_idx]
      if (!leafPort) break

      // Which spine does this leaf-port land on?
      const touchIndex = Math.floor(port_idx / uplinks_per_spine)
      const spineIdx = (li * spinesPerLeaf + touchIndex) % spineCount
      const spine = spines[spineIdx]
      const spinePorts = spinePortsByDevice.get(spine.device_id) ?? []
      const cursor = spinePortCursors.get(spine.device_id) ?? 0
      if (cursor >= spinePorts.length) {
        if (!overflowWarned) {
          notes.push(
            `Spine ${spine.device_id} ran out of ports during seed — design may be under-sized. Some links omitted.`
          )
          overflowWarned = true
        }
        continue
      }
      const spinePort = spinePorts[cursor]
      spinePortCursors.set(spine.device_id, cursor + 1)

      linkSerial += 1
      links.push({
        id: `link-${linkSerial.toString().padStart(4, '0')}`,
        kind: 'uplink',
        device_a: { rack: spine.rack, device_id: spine.device_id, port: spinePort },
        device_b: { rack: leaf.rack, device_id: leaf.device_id, port: leafPort },
        speed_g,
        optic_id: opticId,
        patch_panel_id: patchPanelId,
        label: `${spine.device_id}:${spinePort} ↔ ${leaf.device_id}:${leafPort}`,
        length_m: null,
        notes: null
      })
    }
  }

  // ── vPC peer-links (Phase 14, decision 6) ─────────────────────────
  // `members` cables between the two leaves of every pair, each on its
  // own peer-link port (same port on both ends when the models match).
  if (peerLinkOn) {
    const leafById = new Map(leaves.map((l) => [l.device_id, l]))
    const memberNote = vpc!.port_channel ? 'vPC peer-link (port-channel)' : 'vPC peer-link'
    for (const pair of pairs) {
      const a = leafById.get(pair.members[0])
      const b = leafById.get(pair.members[1])
      if (!a || !b) {
        notes.push(`Pair ${pair.id} references a leaf that is not in the design — peer-link not seeded.`)
        continue
      }
      const swA = switches.find((s) => s.id === a.model_id)
      const swB = switches.find((s) => s.id === b.model_id)
      if (!swA || !swB) {
        notes.push(`Pair ${pair.id}: leaf model not in the library — peer-link not seeded.`)
        continue
      }
      const pa = peerLinkPorts(swA, vpc!.members, configuredUplinks)
      const pb = peerLinkPorts(swB, vpc!.members, configuredUplinks)
      const n = Math.min(pa.ports.length, pb.ports.length)
      if (n < vpc!.members) {
        notes.push(`Pair ${pair.id}: only ${n} peer-link port${n === 1 ? '' : 's'} available — wanted ${vpc!.members}.`)
      }
      for (let k = 0; k < n; k++) {
        linkSerial += 1
        links.push({
          id: `link-${linkSerial.toString().padStart(4, '0')}`,
          kind: 'vpc-peer-link',
          device_a: { rack: a.rack, device_id: a.device_id, port: pa.ports[k] },
          device_b: { rack: b.rack, device_id: b.device_id, port: pb.ports[k] },
          speed_g: Math.min(pa.speed_g, pb.speed_g),
          optic_id: null,
          patch_panel_id: null,
          label: `${a.device_id}:${pa.ports[k]} ↔ ${b.device_id}:${pb.ports[k]}`,
          length_m: null,
          notes: memberNote
        })
      }
    }
  }

  // ── Spine ↔ IPN links (multi-pod committed candidate) ──────────────
  // Every spine connects to every IPN router via `ports_per_spine_per_ipn`
  // ports. Spine-side ports are taken from the END of the spine's native
  // port list (the reserved IPN block, so they don't collide with the
  // leaf uplinks taken from the start). IPN-side ports are assigned
  // sequentially per router.
  const ipns = ipnDevicesFromLayout(design)
  if (ipns.length > 0) {
    const committed = design.candidates.find((c) => c.id === design.committed_candidate_id)
    const portsPerSpinePerIpn =
      committed?.multipod?.ports_per_spine_per_ipn ?? IPN_PORTS_PER_SPINE_PER_IPN
    const ipnLinkSpeed = design.spine?.spine_speed_g ?? 0
    const reservedPerSpine = ipns.length * portsPerSpinePerIpn
    const ipnPortCursors = new Map<string, number>()
    for (const ip of ipns) ipnPortCursors.set(ip.device_id, 0)
    let ipnOverflowWarned = false

    for (const spine of spines) {
      const native = spinePrimaryPorts(spine.model_id, switches)
      const reserved = native.slice(Math.max(0, native.length - reservedPerSpine))
      let ri = 0
      for (const ip of ipns) {
        for (let k = 0; k < portsPerSpinePerIpn; k++) {
          const spinePort = reserved[ri]
          ri += 1
          if (!spinePort) {
            if (!ipnOverflowWarned) {
              notes.push(
                `Spine ${spine.device_id} ran out of reserved ports for IPN uplinks — some spine↔IPN links omitted.`
              )
              ipnOverflowWarned = true
            }
            continue
          }
          const ipnCursor = ipnPortCursors.get(ip.device_id) ?? 0
          const ipnPort = `Eth1/${ipnCursor + 1}`
          ipnPortCursors.set(ip.device_id, ipnCursor + 1)
          linkSerial += 1
          links.push({
            id: `link-${linkSerial.toString().padStart(4, '0')}`,
            kind: 'uplink',
            device_a: { rack: spine.rack, device_id: spine.device_id, port: spinePort },
            device_b: { rack: ip.rack, device_id: ip.device_id, port: ipnPort },
            speed_g: ipnLinkSpeed,
            optic_id: null,
            patch_panel_id: null,
            label: `${spine.device_id}:${spinePort} ↔ ${ip.device_id}:${ipnPort}`,
            length_m: null,
            notes: 'spine↔IPN (multi-pod)'
          })
        }
      }
    }
  }

  return { links, notes }
}

interface IpnDevice {
  device_id: string
  model_id: string
  rack: string | null
}

function ipnDevicesFromLayout(design: DesignResult): IpnDevice[] {
  const ipns: IpnDevice[] = []
  for (const rack of design.rack_layout) {
    for (const d of rack.devices) {
      if (d.role === 'ipn') {
        ipns.push({ device_id: d.device_id, model_id: d.model_id, rack: rack.rack_name })
      }
    }
  }
  return ipns
}
