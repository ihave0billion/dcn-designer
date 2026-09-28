// Browser implementation of the DcnApi that the Electron preload otherwise injects.
// Installed on `window.dcn` by main.tsx when the app is served by src/server (the
// self-hosted web build) rather than run as a desktop app.
//
// The filesystem methods proxy straight to the server, which keeps the same workspace
// layout as the desktop app. The four native-dialog methods have no server equivalent
// and are emulated here with ordinary browser file input / download — so every view
// that calls them (SplashView, LinksView, OpticsUploadDialog) works unchanged.

import type {
  DcnApi,
  DcnExportEntry,
  DcnOpticsIndexEntry,
  DcnProjectListEntry
} from '../../../preload/types'

/**
 * Marker prefix for "save" targets. showSaveCsvPicker can't return a real host path in
 * a browser, so it returns a marked pseudo-path; writeTextFile recognises it and
 * triggers a download instead of a server write. Keeps the callers dialog-shaped.
 */
const DOWNLOAD_PREFIX = 'browser-download:'

/**
 * A 401 means the login session ended (idle timeout, Lock, server restart).
 * Reloading swaps the app for the server's login page; the throw stops the
 * caller from acting on an empty result in the meantime.
 */
function sessionEnded(res: Response): never {
  if (res.status === 401) window.location.reload()
  throw new Error('Session ended — sign in again')
}

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const res = await fetch('/api/dcn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args })
  })
  if (res.status === 401) sessionEnded(res)
  const payload = (await res.json()) as { result?: T; error?: string }
  if (!res.ok || payload.error) {
    throw new Error(payload.error || `Request failed (${res.status})`)
  }
  return payload.result as T
}

/** Open a native file chooser and resolve with the chosen file (or null if dismissed). */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'

    // 'cancel' is not universally supported; the focus fallback covers the rest so a
    // dismissed dialog never leaves the caller hanging on an unresolved promise.
    let settled = false
    const finish = (file: File | null): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }

    input.addEventListener('change', () => finish(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => finish(null))
    window.addEventListener(
      'focus',
      () => {
        // Give 'change' a chance to land first — focus returns before it fires.
        setTimeout(() => finish(input.files?.[0] ?? null), 500)
      },
      { once: true }
    )

    document.body.appendChild(input)
    input.click()
  })
}

async function upload(endpoint: string, file: File): Promise<{ path: string; basename: string }> {
  const res = await fetch(`${endpoint}?name=${encodeURIComponent(file.name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: await file.arrayBuffer()
  })
    if (res.status === 401) sessionEnded(res)
  const payload = (await res.json()) as { path?: string; basename?: string; error?: string }
  if (!res.ok || payload.error || !payload.path) {
    throw new Error(payload.error || `Upload failed (${res.status})`)
  }
  return { path: payload.path, basename: payload.basename ?? file.name }
}

function clickDownload(href: string, filename: string): void {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Hand the browser a file to save. The bytes are staged on the server and the
 * click goes to a real same-origin URL (`/api/download/<token>/<name>`, served
 * with Content-Disposition: attachment). The earlier blob: URL, revoked right
 * after the click, stalled download managers such as Chrono at "100 %, 0 B/s":
 * they fetch the URL on their own schedule, after it was gone. If staging
 * itself fails, fall back to the blob but keep it alive for a while.
 */
async function downloadBytes(filename: string, bytes: Uint8Array, type: string): Promise<void> {
  try {
    const res = await fetch(`/api/upload/download?name=${encodeURIComponent(filename)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes as BodyInit
    })
    if (res.status === 401) sessionEnded(res)
    const staged = (await res.json()) as { token?: string; name?: string; error?: string }
    if (!res.ok || !staged.token || !staged.name) {
      throw new Error(staged.error || `Download staging failed (${res.status})`)
    }
    clickDownload(`/api/download/${staged.token}/${encodeURIComponent(staged.name)}`, staged.name)
  } catch (e) {
    console.warn('[dcn] server download failed, falling back to a blob URL', e)
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
    clickDownload(url, filename)
    // Revoke late: the browser (or an extension) may still be reading it.
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000)
  }
}

function downloadText(filename: string, text: string): Promise<void> {
  return downloadBytes(filename, new TextEncoder().encode(text), 'text/csv;charset=utf-8')
}

const httpDcn: DcnApi = {
  defaultWorkspacePath: () => call<string>('default-workspace-path'),

  // The server owns the workspace root; there is nothing for the user to browse to.
  // Returning the server's root keeps callers happy without pretending to pick.
  showWorkspacePicker: () => call<string>('default-workspace-path'),

  ensureWorkspace: (workspacePath) =>
    call<{ created: string[]; copied: string[] }>('ensure-workspace', workspacePath),

  readYaml: <T = unknown,>(filePath: string) => call<T>('read-yaml', filePath),
  writeYaml: (filePath, data) => call<void>('write-yaml', filePath, data),
  fileExists: (filePath) => call<boolean>('file-exists', filePath),
  deleteFile: (filePath) => call<void>('delete-file', filePath),
  listProjects: (workspacePath) => call<DcnProjectListEntry[]>('list-projects', workspacePath),
  createProject: (workspacePath, name, customer) =>
    call<string>('create-project', workspacePath, name, customer),

  // A browser can't hand over a server-side directory, so importing takes a .zip of the
  // project folder. The server unpacks it to a staging dir and returns that path, which
  // then flows into the ordinary importProject call.
  showImportPicker: async () => {
    const file = await pickFile('.zip,application/zip')
    if (!file) return null
    const { path } = await upload('/api/upload/project-zip', file)
    return path
  },

  importProject: (workspacePath, sourcePath, copy) =>
    call<string>('import-project', workspacePath, sourcePath, copy),

  showCsvPicker: async () => {
    const file = await pickFile('.csv,.tsv,.txt,text/csv')
    if (!file) return null
    return upload('/api/upload/csv', file)
  },

  readTextFile: (filePath) => call<string>('read-text-file', filePath),

  writeTextFile: async (filePath, text) => {
    if (filePath.startsWith(DOWNLOAD_PREFIX)) {
      await downloadText(filePath.slice(DOWNLOAD_PREFIX.length), text)
      return
    }
    await call<void>('write-text-file', filePath, text)
  },

  showSaveCsvPicker: async (_title, defaultName) => `${DOWNLOAD_PREFIX}${defaultName || 'export.csv'}`,

  writeBinaryFile: async (filePath, data) => {
    if (filePath.startsWith(DOWNLOAD_PREFIX)) {
      const name = filePath.slice(DOWNLOAD_PREFIX.length)
      const type = name.endsWith('.vsdx') ? 'application/vnd.ms-visio.drawing' : 'application/pdf'
      await downloadBytes(name, data, type)
      return
    }
    // Real workspace path — the server owns it, so PUT the bytes there.
    const res = await fetch(`/api/write-binary?path=${encodeURIComponent(filePath)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: data as BodyInit
    })
    if (res.status === 401) sessionEnded(res)
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(payload.error || `Write failed (${res.status})`)
    }
  },

  readBinaryFile: async (filePath) => {
    const res = await fetch(`/api/read-binary?path=${encodeURIComponent(filePath)}`)
    if (res.status === 401) sessionEnded(res)
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(payload.error || `Read failed (${res.status})`)
    }
    return new Uint8Array(await res.arrayBuffer())
  },

  showSavePdfPicker: async (_title, defaultName) => `${DOWNLOAD_PREFIX}${defaultName || 'export.pdf'}`,
  showSaveVisioPicker: async (_title, defaultName) => `${DOWNLOAD_PREFIX}${defaultName || 'topology.vsdx'}`,

  listExports: (projectPath) => call<DcnExportEntry[]>('list-exports', projectPath),

  listOptics: (workspacePath) => call<DcnOpticsIndexEntry[]>('list-optics', workspacePath),
  deleteOptics: (workspacePath, switchId) => call<void>('delete-optics', workspacePath, switchId)
}

export function installHttpDcn(): void {
  if (typeof window === 'undefined' || window.dcn) return
  window.dcn = httpDcn
}
