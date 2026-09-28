import type { DesignReportInput } from './DesignReport'
import type { BomReportInput } from './BomReport'

// Phase 9 — render the report to bytes.
//
// Both shells run the renderer in a browser context (Electron's renderer
// process is one too), so a single client-side render serves the desktop and
// the self-hosted web build alike — no server-side PDF path, and nothing to
// keep in sync between the two targets.
//
// @react-pdf/renderer and the document that uses it are pulled in with a
// DYNAMIC import: the engine is ~2 MB of the bundle and is dead weight on
// every other screen. Keeping it out of the initial chunk matters because the
// web build is served over the LAN from the NAS. Only `exportFileName` below
// is statically importable, so a view can name the file without paying for
// the engine.

export type { DesignReportInput, BomReportInput }

/** Suggested filename: `<project>-<YYYY-MM-DD>.pdf`, filesystem-safe. */
export function exportFileName(projectName: string, generatedAt: string): string {
  const slug =
    projectName
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'design'
  const date = generatedAt.slice(0, 10)
  return `${slug}-${date}.pdf`
}

/** Phase 16 — `<project>-bom-<YYYY-MM-DD>.pdf`, next to the report's name. */
export function bomExportFileName(projectName: string, generatedAt: string): string {
  return exportFileName(projectName, generatedAt).replace(/\.pdf$/, '').replace(/-(\d{4}-\d{2}-\d{2})$/, '-bom-$1') + '.pdf'
}

/** Phase 16 — render the standalone bill of materials (one page). */
export async function renderBomReportPdf(input: BomReportInput): Promise<Uint8Array> {
  const [{ pdf }, { BomReport }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./BomReport')
  ])
  const blob = await pdf(BomReport(input)).toBlob()
  return new Uint8Array(await blob.arrayBuffer())
}

/** Render the design report and resolve with the raw PDF bytes. */
export async function renderDesignReportPdf(input: DesignReportInput): Promise<Uint8Array> {
  const [{ pdf }, { DesignReport }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./DesignReport')
  ])
  const blob = await pdf(DesignReport(input)).toBlob()
  return new Uint8Array(await blob.arrayBuffer())
}
