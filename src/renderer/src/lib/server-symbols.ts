import type { DesignResult } from '@domain'
import type { Server } from '@/schemas/servers'
import type { TopologyGraph, TopologyNode } from './topology-extractor'

// Phase 14 — what the "Show servers" symbol says about the hosts behind a
// leaf (decision 8): the tier's server model and NIC speed from the library,
// one line per NIC, never one tile per real server.
//
// The leaf's tier is found by leaf model (as the cable-links seeder does);
// the tier's `server_model_id` names a servers.yaml entry. Without one the
// symbol is a generic "Servers" box labelled with the tier's host speed.

export interface ServerInfo {
  /** servers.yaml id, or null for the generic symbol. */
  model_id: string | null
  /** Display name for the tile label. */
  label: string
  /** NIC count per host (lines drawn for a single-attached symbol). */
  nics: number
  /** NIC speed in G (the tier's host speed when no server model). */
  nic_speed_g: number | null
  /** RU of the server model (generic box = 1). */
  ru: number
}

export type ServerInfoResolver = (leaf: Pick<TopologyNode, 'id' | 'model_id'>) => ServerInfo | null

// Pick the server's NIC group: the one whose speed matches the tier's host
// speed, else the fastest group.
function nicGroup(server: Server, hostSpeedG: number | null): { count: number; speed_g: number } | null {
  if (server.ports.length === 0) return null
  const match = hostSpeedG != null ? server.ports.find((p) => p.speed_g === hostSpeedG) : null
  if (match) return { count: match.count, speed_g: match.speed_g }
  const fastest = [...server.ports].sort((a, b) => b.speed_g - a.speed_g)[0]
  return { count: fastest.count, speed_g: fastest.speed_g }
}

export function serverInfoResolver(design: DesignResult | null, servers: Server[]): ServerInfoResolver {
  const byModel = new Map(servers.map((s) => [s.id, s]))
  const tierByLeafModel = new Map<string, DesignResult['tiers'][number]>()
  for (const t of design?.tiers ?? []) {
    if (t.xor_status === 'ok' && !tierByLeafModel.has(t.leaf_model_id)) tierByLeafModel.set(t.leaf_model_id, t)
  }
  return (leaf) => {
    const tier = tierByLeafModel.get(leaf.model_id) ?? null
    const hostSpeed = tier?.host_speed_g ?? null
    const server = tier?.server_model_id ? byModel.get(tier.server_model_id) ?? null : null
    if (server) {
      const g = nicGroup(server, hostSpeed)
      return {
        model_id: server.id,
        label: server.model_display || server.id,
        nics: g?.count ?? 1,
        nic_speed_g: g?.speed_g ?? hostSpeed,
        ru: server.ru ?? 1
      }
    }
    return { model_id: null, label: 'Servers', nics: 1, nic_speed_g: hostSpeed, ru: 1 }
  }
}

/** "2×25G" / "25G NIC" — the server tile's sublabel. */
export function nicLabel(info: ServerInfo, dual: boolean): string {
  const speed = info.nic_speed_g != null ? `${info.nic_speed_g}G` : ''
  const n = dual ? 2 : info.nics
  if (!speed) return n > 1 ? `${n} NICs` : 'NIC'
  return n > 1 ? `${n}×${speed}` : `${speed} NIC`
}

/** Every distinct server model id the graph's leaves resolve to (for artwork loading). */
export function serverModelsIn(graph: TopologyGraph, resolve: ServerInfoResolver): string[] {
  const out = new Set<string>()
  for (const n of graph.nodes) {
    if (n.role !== 'leaf') continue
    const id = resolve(n)?.model_id
    if (id) out.add(id)
  }
  return [...out]
}
