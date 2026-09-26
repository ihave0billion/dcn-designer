import type { VisioIndex } from './master-store'

// Phase 13 — which artwork stands for a switch model in the Visio export.
//
// Order (docs/VISIO_EXPORT_PLAN.md): explicit library override → exact Cisco
// master "<id> Front" → alias table (same port layout) → product photo
// (override or images/<id>.png) → generated schematic panel. Everything
// after the first two is a substitution and carries a note the Export tab
// shows — the skill's standing rule is that no stand-in ships silently.

export interface VisioHintLike {
  master?: string | null
  image?: string | null
}

export type ModelResolution =
  | { kind: 'master'; masterName: string; exact: boolean; note: string | null }
  | { kind: 'image'; imagePath: string; note: string }
  | { kind: 'schematic'; note: string }

export function masterNameFor(modelId: string): string {
  return `${modelId} Front`
}

// Cisco's packs are inconsistent about the family prefix ("N9K-93600CD-GX
// Front" for N9K-C93600CD-GX, "N9K-C9348GC-FX3 Front" for library id
// 9348GC-FX3). Compare master names with the prefix stripped, as the
// extractor does.
export function familyKey(name: string): string {
  return name
    .replace(/\s+Front$/i, '')
    .replace(/^N[39]K-C?/i, '')
    .toUpperCase()
}

/** The bundle's master name for a model: exact "<id> Front", else the same name ignoring the family prefix. */
export function findMasterName(modelId: string, index: VisioIndex | null): string | null {
  if (!index) return null
  const exact = masterNameFor(modelId)
  if (Object.prototype.hasOwnProperty.call(index.masters, exact)) return exact
  const key = familyKey(modelId)
  for (const name of Object.keys(index.masters)) {
    if (familyKey(name) === key) return name
  }
  return null
}

export function resolveModel(
  modelId: string,
  hint: VisioHintLike | null | undefined,
  index: VisioIndex | null
): ModelResolution {
  const has = (name: string): boolean =>
    !!index && Object.prototype.hasOwnProperty.call(index.masters, name)

  if (hint?.master) {
    if (has(hint.master)) {
      const exact = hint.master === masterNameFor(modelId)
      return {
        kind: 'master',
        masterName: hint.master,
        exact,
        note: exact ? null : `${modelId}: library override → stencil master "${hint.master}"`
      }
    }
    // A stale override is worse than silent fallback — say so and continue.
    return withNote(
      resolveModel(modelId, { image: hint.image }, index),
      `${modelId}: library override master "${hint.master}" is not in the stencil bundle`
    )
  }

  const found = findMasterName(modelId, index)
  if (found) return { kind: 'master', masterName: found, exact: true, note: null }

  const alias = index?.aliases[modelId]
  if (alias && has(alias)) {
    return {
      kind: 'master',
      masterName: alias,
      exact: false,
      note: `${modelId}: no exact stencil master; drawn with "${alias}" (same port layout)`
    }
  }

  if (hint?.image) {
    return { kind: 'image', imagePath: hint.image, note: `${modelId}: product photo ${hint.image}` }
  }
  const photo = index?.images[modelId]
  if (photo) return { kind: 'image', imagePath: photo, note: `${modelId}: product photo ${photo}` }

  return {
    kind: 'schematic',
    note: index
      ? `${modelId}: no stencil master or photo; drawn as a schematic front panel`
      : `${modelId}: no stencil bundle in library/visio/; drawn as a schematic front panel`
  }
}

function withNote(r: ModelResolution, prefix: string): ModelResolution {
  const note = r.note ? `${prefix}; ${r.note}` : prefix
  return { ...r, note } as ModelResolution
}
