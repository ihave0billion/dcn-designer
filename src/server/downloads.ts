import { join, basename, normalize, extname } from 'node:path'
import { promises as fs, existsSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

// v1.5.3 — browser "Save a copy…" downloads go through the server.
//
// The web build used to hand a rendered PDF / .vsdx to the browser as a
// blob: URL and revoke it in the same tick as the click. Chrome itself
// tolerated that, but a download manager (Chrono) fetches the URL on its
// own schedule, found it revoked, and the transfer sat at "1.41 MB of
// 1.41 MB, 0 B/s" forever. A real same-origin URL with
// Content-Disposition: attachment is what every download path — browser,
// extension, "save link as" — knows how to finish.
//
// The renderer PUTs the bytes here, gets a one-time token back, and clicks
// an <a href="/api/download/<token>/<name>">. Files live under
// <workspace>/.uploads/downloads/<token>/<name> and are swept after TTL_MS —
// long enough for a slow download manager, short enough that the workspace
// never accumulates stale exports.

export const TTL_MS = 15 * 60_000
const TOKEN_RE = /^[0-9a-f-]{36}$/

export function safeDownloadName(raw: string, fallback: string): string {
  const base = basename(normalize(raw || fallback)).replace(/[^a-zA-Z0-9 _.-]/g, '_')
  // basename('') and basename('..') are '.' / '..' — never a file name.
  return base && base !== '.' && base !== '..' ? base : fallback
}

export function downloadMime(name: string): string {
  switch (extname(name).toLowerCase()) {
    case '.pdf':
      return 'application/pdf'
    case '.vsdx':
      return 'application/vnd.ms-visio.drawing'
    case '.csv':
      return 'text/csv; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

export class DownloadStage {
  // A plain field, not a parameter property: src/server runs under Node's
  // type-stripping loader, which refuses TypeScript-only constructor syntax.
  private readonly dir: string
  constructor(dir: string) {
    this.dir = dir
  }

  /** Store the bytes; returns the token + sanitised name the GET must use. */
  async stage(bytes: Uint8Array, rawName: string): Promise<{ token: string; name: string }> {
    const token = randomUUID()
    const name = safeDownloadName(rawName, 'download.bin')
    const folder = join(this.dir, token)
    await fs.mkdir(folder, { recursive: true })
    await fs.writeFile(join(folder, name), bytes)
    // Opportunistic sweep — no timer to leak in tests or on shutdown.
    await this.sweep().catch(() => undefined)
    return { token, name }
  }

  /** Absolute path of a staged file, or null when the token/name pair is unknown. */
  resolve(token: string, rawName: string): string | null {
    if (!TOKEN_RE.test(token)) return null
    const name = safeDownloadName(rawName, '')
    if (!name) return null
    const abs = join(this.dir, token, name)
    return existsSync(abs) && statSync(abs).isFile() ? abs : null
  }

  /** Delete staged folders older than the TTL. Returns how many were removed. */
  async sweep(now = Date.now()): Promise<number> {
    if (!existsSync(this.dir)) return 0
    let removed = 0
    for (const entry of await fs.readdir(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const folder = join(this.dir, entry.name)
      const { mtimeMs } = await fs.stat(folder)
      if (now - mtimeMs > TTL_MS) {
        await fs.rm(folder, { recursive: true, force: true })
        removed++
      }
    }
    return removed
  }
}
