// Expand a port-naming template like "Eth1/{1..48}" into a flat array
// of port names: ["Eth1/1", "Eth1/2", …, "Eth1/48"].
//
// Supported grammar (kept deliberately small per JOURNAL Open Risk #7):
//   - One brace span per template: prefix "{lo..hi}" suffix
//   - lo / hi are non-negative integers, lo ≤ hi
//   - Templates with no brace span return [template] verbatim
//   - Multiple brace spans are NOT supported (throws)
//
// Examples:
//   expandPortTemplate("Eth1/{1..48}")      → ["Eth1/1", …, "Eth1/48"]
//   expandPortTemplate("MLOM/{1..2}")       → ["MLOM/1", "MLOM/2"]
//   expandPortTemplate("MgmtA")             → ["MgmtA"]

const BRACE_RE = /\{(\d+)\.\.(\d+)\}/g

export function expandPortTemplate(template: string): string[] {
  const matches = [...template.matchAll(BRACE_RE)]
  if (matches.length === 0) return [template]
  if (matches.length > 1) {
    throw new Error(
      `port-template: multiple brace spans not supported: "${template}"`
    )
  }
  const m = matches[0]
  const lo = Number(m[1])
  const hi = Number(m[2])
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi < lo) {
    throw new Error(`port-template: invalid range in "${template}"`)
  }
  const prefix = template.slice(0, m.index)
  const suffix = template.slice((m.index ?? 0) + m[0].length)
  const out: string[] = []
  for (let i = lo; i <= hi; i++) {
    out.push(`${prefix}${i}${suffix}`)
  }
  return out
}

// Convenience: count without materialising. Useful for capacity checks.
export function expandPortTemplateCount(template: string): number {
  const matches = [...template.matchAll(BRACE_RE)]
  if (matches.length === 0) return 1
  if (matches.length > 1) {
    throw new Error(
      `port-template: multiple brace spans not supported: "${template}"`
    )
  }
  const lo = Number(matches[0][1])
  const hi = Number(matches[0][2])
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi < lo) {
    throw new Error(`port-template: invalid range in "${template}"`)
  }
  return hi - lo + 1
}
