import type { TopologyGraph, TopologyNode, TopologyRole } from './topology-extractor'

// Default hostnames for the topology (v1.2).
//
// The solver labels devices "Leaf 12 (N9348Y2C6D-SE1U)". When the user has
// not typed a hostname (Rack View → device label), the topology shows a
// short nickname of the model instead:
//
//   N9348Y2C6D-SE1U (smart switch) → smart-sw-leaf12
//   N9K-C9364D-GX2A                → gx2a-spine1
//   9348GC-FX3                     → fx3-leaf30
//   N9K-C9332D-GX2B (IPN)          → gx2b-ipn1
//
// A label that does not match the solver's auto pattern is treated as a
// user-given hostname and kept verbatim.

export const AUTO_LABEL_RE = /^(spine|leaf|ipn|server)\s*\d+(\s*\(.*\))?$/i

const SMART_MODEL_RE = /SE1U|SMART/i

export function isSmartModel(modelId: string, smartModels?: ReadonlySet<string>): boolean {
  if (smartModels?.has(modelId)) return true
  return SMART_MODEL_RE.test(modelId)
}

// "N9K-C9364D-GX2A" → "gx2a"; "9348GC-FX3" → "fx3"; "N9364E-SP2R-O" → "sp2r-o";
// a model with no family suffix falls back to the whole id, lower-cased.
export function modelNickname(modelId: string, smart = false): string {
  if (smart) return 'smart-sw'
  const trimmed = modelId.trim()
  if (!trimmed || trimmed === 'unknown') return 'sw'
  const stripped = trimmed.toUpperCase().replace(/^N[39]K-C/, '').replace(/^N(?=\d)/, '')
  const parts = stripped.split('-').filter(Boolean)
  const family = parts.length > 1 ? parts.slice(1).join('-') : parts[0]
  return family.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

export function defaultHostname(
  role: TopologyRole,
  index: number,
  modelId: string,
  smart = false
): string {
  return `${modelNickname(modelId, smart)}-${role}${index}`
}

// Pull the ordinal out of "leaf-12" / "Leaf 12 (…)" / "spine-3"; 0 if none.
export function deviceIndex(deviceId: string, rawLabel?: string | null): number {
  const fromId = /(\d+)\s*$/.exec(deviceId)
  if (fromId) return parseInt(fromId[1], 10)
  const fromLabel = rawLabel ? /(\d+)/.exec(rawLabel) : null
  return fromLabel ? parseInt(fromLabel[1], 10) : 0
}

export function displayName(
  node: Pick<TopologyNode, 'id' | 'label' | 'role' | 'model_id'>,
  smart = false
): { label: string; source: 'user' | 'auto' } {
  const raw = (node.label ?? '').trim()
  const isAuto = raw === '' || raw === node.id || AUTO_LABEL_RE.test(raw)
  if (!isAuto) return { label: raw, source: 'user' }
  if (node.model_id === 'unknown') return { label: raw || node.id, source: 'auto' }
  return {
    label: defaultHostname(node.role, deviceIndex(node.id, raw), node.model_id, smart),
    source: 'auto'
  }
}

// Return a copy of the graph with nicknames applied and the smart flag set.
export function applyNicknames(
  graph: TopologyGraph,
  smartModels?: ReadonlySet<string>
): TopologyGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const smart = isSmartModel(n.model_id, smartModels)
      const { label, source } = displayName(n, smart)
      return { ...n, label, smart, hostname_source: source }
    })
  }
}
