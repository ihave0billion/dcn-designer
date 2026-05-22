import type { IpnRouterFileEntry, IpnRouterSpec } from './types'

// Normalize a YAML-file IPN entry into the slimmer IpnRouterSpec the
// solver consumes (mirrors how SwitchSpec is a subset of the on-disk
// switch record).
export function ipnRouterSpecFromFileEntry(entry: IpnRouterFileEntry): IpnRouterSpec {
  return {
    id: entry.id,
    primary: {
      ports: entry.primary.ports,
      speed_g: entry.primary.speed_g
    },
    ru: entry.ru,
    power_w: entry.power_w,
    capabilities: {
      multipod: entry.capabilities.multipod,
      multisite: entry.capabilities.multisite,
      mpls_handoff: entry.capabilities.mpls_handoff
    }
  }
}

// Look up an IPN router by id. Returns null when:
//   - context.ipn_routers is missing or empty
//   - the requested id isn't in the library
// Callers translate null into the appropriate warning
// (IPN_MODEL_NOT_SELECTED when the requirements left the id blank;
// caller decides on a fallback otherwise).
export function pickIpnRouter(
  ipn_routers: IpnRouterSpec[] | undefined,
  requested_id: string | null | undefined
): IpnRouterSpec | null {
  if (!ipn_routers || ipn_routers.length === 0) return null
  if (requested_id) {
    return ipn_routers.find((r) => r.id === requested_id) ?? null
  }
  // No explicit selection — fall back to the first router in the
  // library. Phase 2b solver tolerates this so projects that haven't
  // visited the Multi-Pod UI (still 9b) can still surface candidates.
  return ipn_routers[0] ?? null
}
