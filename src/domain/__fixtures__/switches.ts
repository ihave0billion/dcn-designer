import type { BreakoutPair, SwitchSpec } from '../types'

// Minimal switch fixtures used across the domain tests. Each entry
// mirrors the relevant slice of seed/switches.yaml — kept inline so
// tests don't depend on YAML I/O or filesystem state.

export const N9K_C9364D_GX2A: SwitchSpec = {
  id: 'N9K-C9364D-GX2A',
  role: 'both',
  primary: { ports: 64, speed_g: 400 },
  uplink: null,
  secondary_uplink: null,
  ru: 2,
  power_w: 1200,
  capabilities: { rocev2: true, aci_leaf: true, aci_spine: true, nxos: true }
}

export const N9K_C9364C_H1: SwitchSpec = {
  id: 'N9K-C9364C-H1',
  role: 'both',
  primary: { ports: 64, speed_g: 100 },
  uplink: null,
  secondary_uplink: null,
  ru: 2,
  power_w: 1100,
  capabilities: { rocev2: false, aci_leaf: true, aci_spine: true, nxos: true }
}

// 25G ToR with 6× 400G primary uplinks AND 2× 100G secondary uplinks —
// the case where uplink auto-pick (v8 rule 13) chooses the higher
// per-port speed group (the 400G one).
export const N9348Y2C6D_SE1U: SwitchSpec = {
  id: 'N9348Y2C6D-SE1U',
  role: 'leaf',
  primary: { ports: 48, speed_g: 25 },
  uplink: { ports: 6, speed_g: 400 },
  secondary_uplink: { ports: 2, speed_g: 100 },
  ru: 1,
  power_w: 600,
  capabilities: { rocev2: true, aci_leaf: true, nxos: true }
}

// Synthetic leaf where the SECONDARY uplink has the higher per-port
// speed — used to assert that auto-pick selects secondary, not
// primary, when its speed wins.
export const SYN_SECONDARY_FASTER: SwitchSpec = {
  id: 'SYN-SECONDARY-FASTER',
  role: 'leaf',
  primary: { ports: 4, speed_g: 100 },
  uplink: { ports: 4, speed_g: 100 },
  secondary_uplink: { ports: 4, speed_g: 400 },
  ru: 1,
  power_w: 600,
  capabilities: { rocev2: false, nxos: true }
}

// A non-RoCEv2 leaf — used to assert AI/HPC warns when chosen.
export const SYN_LEAF_NO_ROCEV2: SwitchSpec = {
  id: 'SYN-LEAF-NO-ROCEV2',
  role: 'leaf',
  primary: { ports: 48, speed_g: 25 },
  uplink: { ports: 4, speed_g: 100 },
  secondary_uplink: null,
  ru: 1,
  power_w: 500,
  capabilities: { rocev2: false, nxos: true }
}

export const ALL_SWITCHES: SwitchSpec[] = [
  N9K_C9364D_GX2A,
  N9K_C9364C_H1,
  N9348Y2C6D_SE1U,
  SYN_SECONDARY_FASTER,
  SYN_LEAF_NO_ROCEV2
]

export const BREAKOUT_PAIRS: BreakoutPair[] = [
  {
    spine_pid: 'QDD-400G-BD',
    leaf_pid: 'QSFP-100G-SR1.2',
    fanout: 1,
    spine_connector: 'LC (UPC)',
    leaf_connector: 'LC (UPC)',
    requires_patch_panel: false,
    verified_by: 'CLAUDE.md rule 11',
    notes: null
  },
  {
    spine_pid: 'QDD-400G-SR4.2',
    leaf_pid: 'QSFP-100G-SR1.2',
    fanout: 4,
    spine_connector: 'MPO-12 (UPC)',
    leaf_connector: 'LC (UPC)',
    requires_patch_panel: true,
    verified_by: 'test fixture',
    notes: null
  }
]
