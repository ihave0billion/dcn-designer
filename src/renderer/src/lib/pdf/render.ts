import type { DesignReportInput } from './DesignReport'

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

export type { DesignReportInput }

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

/** Render the design report and resolve with the raw PDF bytes. */
export async function renderDesignReportPdf(input: DesignReportInput): Promise<Uint8Array> {
  const [{ pdf }, { DesignReport }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./DesignReport')
  ])
  const blob = await pdf(DesignReport(input)).toBlob()
  return new Uint8Array(await blob.arrayBuffer())
}
