import type { DesignResult, BreakoutPair } from '@domain'
import type { Switch } from '@/schemas/switches'
import type { PatchPanel } from '@/schemas/patch-panels'
import type { CableLink } from '@/schemas/cable-links'
import { expandPortTemplate } from './port-template'
import { resolvePatchPanel } from './patch-panel-resolver'

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
    const leafPorts = leafUplinkPorts(leaf.model_id, choice, switches)
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

  return { links, notes }
}
