import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join, dirname, extname, basename, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, promises as fs, createReadStream } from 'node:fs'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import AdmZip from 'adm-zip'
import { handlers } from './dcn-handlers.ts'
import { WORKSPACE_ROOT, UPLOAD_DIR, resolveInRoot } from './paths.ts'

const here = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = process.env.DCN_WEB_ROOT || join(here, '..', '..', 'out', 'web')
const PORT = Number(process.env.PORT || 8788)
const HOST = process.env.HOST || '0.0.0.0'
const AUTH_PASSWORD = process.env.DCN_AUTH_PASSWORD || ''
const MAX_UPLOAD_BYTES = Number(process.env.DCN_MAX_UPLOAD_BYTES || 64 * 1024 * 1024)

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text)
  })
  res.end(text)
}

/** Constant-time compare so the shared password can't be probed by timing. */
function passwordMatches(supplied: string): boolean {
  const a = Buffer.from(supplied)
  const b = Buffer.from(AUTH_PASSWORD)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Optional shared-password gate. Off unless DCN_AUTH_PASSWORD is set — the default
 * deployment is LAN-only. Set it when exposing the app beyond the local network.
 */
function authorized(req: IncomingMessage): boolean {
  if (!AUTH_PASSWORD) return true
  const header = req.headers.authorization || ''
  if (!header.startsWith('Basic ')) return false
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  const password = decoded.slice(decoded.indexOf(':') + 1)
  return passwordMatches(password)
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > MAX_UPLOAD_BYTES) throw new Error('Upload exceeds the maximum allowed size')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

/** Strip any directory component a browser-supplied filename might carry. */
function safeName(raw: string, fallback: string): string {
  const base = basename(normalize(raw || fallback)).replace(/[^a-zA-Z0-9 _.-]/g, '_')
  return base || fallback
}

async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '')
  let filePath = join(WEB_ROOT, normalize(rel))

  // Never serve outside the built web root, and fall back to the SPA entry point so
  // client-side routes and deep links resolve.
  if (!filePath.startsWith(WEB_ROOT) || !existsSync(filePath) || (await fs.stat(filePath)).isDirectory()) {
    filePath = join(WEB_ROOT, 'index.html')
  }
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('Web build not found. Run `npm run build:web`.')
    return
  }

  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
  // Hashed asset filenames are safe to cache hard; index.html must not be.
  const cache = filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable'
  res.writeHead(200, { 'content-type': type, 'cache-control': cache })
  createReadStream(filePath).pipe(res)
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  // JSON-RPC-ish dispatch mirroring the Electron ipcMain.handle channels.
  if (url.pathname === '/api/dcn' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8')) as {
      method?: string
      args?: unknown[]
    }
    const fn = handlers[body.method ?? '']
    if (!fn) {
      sendJson(res, 400, { error: `Unknown method: ${body.method}` })
      return
    }
    const result = await (fn as (...a: unknown[]) => unknown)(...(body.args ?? []))
    sendJson(res, 200, { result: result ?? null })
    return
  }

  // Raw-body uploads (no multipart parsing needed — the client sends the file bytes
  // directly). The stored server-side path is handed back to the renderer, which then
  // uses the ordinary read-text-file / import-project calls against it.
  if (url.pathname === '/api/upload/csv' && req.method === 'PUT') {
    const name = safeName(url.searchParams.get('name') || '', 'upload.csv')
    await fs.mkdir(UPLOAD_DIR, { recursive: true })
    const dst = join(UPLOAD_DIR, `${randomUUID()}-${name}`)
    await fs.writeFile(dst, await readBody(req))
    sendJson(res, 200, { path: dst, basename: name })
    return
  }

  if (url.pathname === '/api/upload/project-zip' && req.method === 'PUT') {
    const stagingDir = join(UPLOAD_DIR, randomUUID())
    await fs.mkdir(stagingDir, { recursive: true })
    const zip = new AdmZip(await readBody(req))

    // Extract entry-by-entry so a zip-slip path (`../../etc/x`) can't escape staging.
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue
      const dst = join(stagingDir, normalize(entry.entryName))
      if (!dst.startsWith(stagingDir)) {
        throw new Error(`Refusing unsafe zip entry: ${entry.entryName}`)
      }
      await fs.mkdir(dirname(dst), { recursive: true })
      await fs.writeFile(dst, entry.getData())
    }

    // Accept both a zipped project folder and a zip of the folder's contents.
    let projectRoot = stagingDir
    if (!existsSync(join(projectRoot, 'requirements.yaml'))) {
      const entries = await fs.readdir(projectRoot, { withFileTypes: true })
      const dirs = entries.filter((e) => e.isDirectory())
      if (dirs.length === 1 && existsSync(join(projectRoot, dirs[0].name, 'requirements.yaml'))) {
        projectRoot = join(projectRoot, dirs[0].name)
      }
    }
    sendJson(res, 200, { path: projectRoot })
    return
  }

  // Phase 9 — write a binary payload (a rendered PDF) to a workspace path. The
  // JSON-RPC channel above would have to base64 the bytes; this takes the raw
  // body instead. `resolveInRoot` jails the target exactly as the JSON handlers do.
  if (url.pathname === '/api/write-binary' && req.method === 'PUT') {
    const abs = resolveInRoot(url.searchParams.get('path') || '')
    await fs.mkdir(dirname(abs), { recursive: true })
    await fs.writeFile(abs, await readBody(req))
    sendJson(res, 200, { path: abs })
    return
  }

  if (url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, workspace: WORKSPACE_ROOT })
    return
  }

  sendJson(res, 404, { error: 'Not found' })
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  // Liveness probe stays open so the container HEALTHCHECK and the deploy
  // script's wait loop work without the shared password. It reveals nothing
  // beyond "up"; the workspace path is only included for authenticated callers.
  if (url.pathname === '/api/health' && !authorized(req)) {
    sendJson(res, 200, { ok: true })
    return
  }

  if (!authorized(req)) {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="DCN Designer"' })
    res.end('Authentication required')
    return
  }

  const work = url.pathname.startsWith('/api/')
    ? handleApi(req, res, url)
    : serveStatic(res, url.pathname)

  work.catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    if (res.headersSent) {
      res.destroy()
      return
    }
    // Client-supplied paths and project-name collisions surface here as ordinary
    // 400s; the renderer already renders these messages inline.
    sendJson(res, 400, { error: message })
  })
})

await fs.mkdir(WORKSPACE_ROOT, { recursive: true })
// Best-effort seed on boot so a fresh volume is usable immediately.
await (handlers['ensure-workspace'] as (p: string) => Promise<unknown>)(WORKSPACE_ROOT).catch(
  (e: unknown) => console.error('[dcn] ensure-workspace on boot failed:', e)
)

server.listen(PORT, HOST, () => {
  console.log(`[dcn] DCN Designer web server listening on http://${HOST}:${PORT}`)
  console.log(`[dcn] workspace: ${WORKSPACE_ROOT}`)
  console.log(`[dcn] auth: ${AUTH_PASSWORD ? 'shared password enabled' : 'open (LAN only)'}`)
})
