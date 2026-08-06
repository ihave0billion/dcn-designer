import { resolve, sep, join } from 'node:path'
import { homedir } from 'node:os'

/**
 * The single workspace root this server is allowed to touch. In the desktop app the
 * user picks any folder via a native dialog; on the server there is no such dialog and
 * — more importantly — no reason to let a browser client name arbitrary host paths.
 * Everything is rooted here and every client-supplied path is checked against it.
 */
export const WORKSPACE_ROOT = resolve(
  process.env.DCN_WORKSPACE || join(homedir(), 'DCN-Designer')
)

/** Scratch area for browser uploads (CSV imports, project zips). Inside the root so it is jailed too. */
export const UPLOAD_DIR = join(WORKSPACE_ROOT, '.uploads')

/**
 * Resolve a client-supplied path and refuse anything that escapes WORKSPACE_ROOT.
 *
 * The renderer threads absolute paths around (workspacePath, projectPath, per-file
 * paths) and we keep that contract so the UI code ports unchanged — but on the server
 * those strings arrive over HTTP, so they are untrusted input. Guards against `..`
 * traversal and against sibling-prefix paths (`/data/dcn-evil` vs root `/data/dcn`).
 */
export function resolveInRoot(candidate: string): string {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new Error('A path is required')
  }
  const abs = resolve(WORKSPACE_ROOT, candidate)
  if (abs !== WORKSPACE_ROOT && !abs.startsWith(WORKSPACE_ROOT + sep)) {
    throw new Error(`Path escapes the workspace root: ${candidate}`)
  }
  return abs
}
