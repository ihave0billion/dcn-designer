import type { PatchPanel } from '@/schemas/patch-panels'

// Resolve a patch panel for a link with potentially mismatched
// connectors. Returns a curated entry if one matches both connectors;
// otherwise returns a stable synthetic placeholder ID of the form
// `PP-<a>-<b>` so the link can still carry a persistent reference.

export interface PatchPanelResolution {
  panel_id: string
  matched: boolean // true → curated; false → synthetic placeholder
  panel?: PatchPanel
}

// Normalize a connector string into a compact slug used in synthetic
// SKUs. Strips polish info like "(UPC)" / "(APC)" and any whitespace.
//   "MPO-12 (UPC)" → "MPO12"
//   "LC (UPC)"     → "LC"
export function connectorSlug(raw: string): string {
  if (!raw) return 'UNK'
  // drop parenthesised qualifiers
  const noParen = raw.replace(/\s*\([^)]*\)\s*/g, '')
  // collapse whitespace + dashes/dots into nothing
  return noParen.replace(/[\s\-_.]/g, '').toUpperCase()
}

export function syntheticPatchPanelId(
  spineConnector: string,
  leafConnector: string
): string {
  return `PP-${connectorSlug(spineConnector)}-${connectorSlug(leafConnector)}`
}

// Find a curated panel matching the pair, in either connector order
// (cassettes are bidirectional). Returns the first match or null.
function findCurated(
  panels: PatchPanel[],
  spineConnector: string,
  leafConnector: string
): PatchPanel | null {
  const a = connectorSlug(spineConnector)
  const b = connectorSlug(leafConnector)
  for (const p of panels) {
    const pa = connectorSlug(p.connector_a)
    const pb = connectorSlug(p.connector_b)
    if ((pa === a && pb === b) || (pa === b && pb === a)) {
      return p
    }
  }
  return null
}

export function resolvePatchPanel(
  panels: PatchPanel[],
  spineConnector: string,
  leafConnector: string
): PatchPanelResolution {
  const curated = findCurated(panels, spineConnector, leafConnector)
  if (curated) {
    return { panel_id: curated.id, matched: true, panel: curated }
  }
  return {
    panel_id: syntheticPatchPanelId(spineConnector, leafConnector),
    matched: false
  }
}

// Build a synthetic-on-the-fly PatchPanel record for display purposes
// when the resolution falls back to a placeholder. Lets the dropdown
// surface the placeholder ID without polluting patch_panels.yaml.
export function syntheticPatchPanel(
  spineConnector: string,
  leafConnector: string
): PatchPanel {
  return {
    id: syntheticPatchPanelId(spineConnector, leafConnector),
    vendor: '(placeholder)',
    description: `Synthetic ${spineConnector} ↔ ${leafConnector} placeholder. Replace with a curated SKU when known.`,
    connector_a: spineConnector,
    connector_b: leafConnector,
    fanout: 1,
    media: null,
    notes: null,
    data_sheet_url: null
  }
}
