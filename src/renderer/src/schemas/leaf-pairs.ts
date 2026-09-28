import { z } from 'zod'

// leaf_pairs.yaml — the vPC leaf pairs of a project (Phase 14).
//
// Seeded by Generate Design from the solver's pairing (consecutive leaves of
// a tier, the same two-per-rack grouping the rack placement uses). The user
// can re-pick the members of any pair in the Links tab; the first edit flips
// the file to `source: 'user'` and solver regeneration leaves it alone.
// Reset deletes the file and the next Generate Design re-seeds it.
//
// An odd leaf out is not stored: consumers compute "unpaired" as every leaf
// that appears in no pair, and the UI flags it.

export const LeafPairSchema = z.object({
  id: z.string().min(1), // "pair-1", "pair-2", …
  members: z.tuple([z.string().min(1), z.string().min(1)])
})
export type LeafPair = z.infer<typeof LeafPairSchema>

export const LeafPairsFileSchema = z.object({
  schema_version: z.literal(1),
  source: z.enum(['solver', 'user']).default('solver'),
  seeded_at: z.string().nullable().default(null),
  forked_at: z.string().nullable().default(null),
  pairs: z.array(LeafPairSchema).default([])
})
export type LeafPairsFile = z.infer<typeof LeafPairsFileSchema>

/** Leaves (by device id) that belong to no pair. */
export function unpairedLeaves(leafIds: readonly string[], pairs: readonly LeafPair[]): string[] {
  const paired = new Set(pairs.flatMap((p) => p.members))
  return leafIds.filter((id) => !paired.has(id))
}

/** The pair a leaf belongs to, or null. */
export function pairOf(leafId: string, pairs: readonly LeafPair[]): LeafPair | null {
  return pairs.find((p) => p.members.includes(leafId)) ?? null
}

/** The other member of a leaf's pair, or null when unpaired. */
export function peerOf(leafId: string, pairs: readonly LeafPair[]): string | null {
  const p = pairOf(leafId, pairs)
  if (!p) return null
  return p.members[0] === leafId ? p.members[1] : p.members[0]
}

/** Problems with a pair list: a leaf in two pairs, a pair of one leaf, or an unknown leaf. */
export function validatePairs(pairs: readonly LeafPair[], leafIds: readonly string[]): string[] {
  const problems: string[] = []
  const seen = new Map<string, string>()
  const known = new Set(leafIds)
  for (const p of pairs) {
    if (p.members[0] === p.members[1]) problems.push(`${p.id}: both members are ${p.members[0]}`)
    for (const m of p.members) {
      if (!known.has(m)) problems.push(`${p.id}: ${m} is not a leaf in this design`)
      const prev = seen.get(m)
      if (prev && prev !== p.id) problems.push(`${m} is in both ${prev} and ${p.id}`)
      seen.set(m, p.id)
    }
  }
  return problems
}
