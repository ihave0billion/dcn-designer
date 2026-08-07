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

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const res = await fetch('/api/dcn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args })
  })
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
  const payload = (await res.json()) as { path?: string; basename?: string; error?: string }
  if (!res.ok || payload.error || !payload.path) {
    throw new Error(payload.error || `Upload failed (${res.status})`)
  }
  return { path: payload.path, basename: payload.basename ?? file.name }
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function downloadText(filename: string, text: string): void {
  downloadBlob(filename, new Blob([text], { type: 'text/csv;charset=utf-8' }))
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
      downloadText(filePath.slice(DOWNLOAD_PREFIX.length), text)
      return
    }
    await call<void>('write-text-file', filePath, text)
  },

  showSaveCsvPicker: async (_title, defaultName) => `${DOWNLOAD_PREFIX}${defaultName || 'export.csv'}`,

  writeBinaryFile: async (filePath, data) => {
    if (filePath.startsWith(DOWNLOAD_PREFIX)) {
      downloadBlob(
        filePath.slice(DOWNLOAD_PREFIX.length),
        new Blob([data as BlobPart], { type: 'application/pdf' })
      )
      return
    }
    // Real workspace path — the server owns it, so PUT the bytes there.
    const res = await fetch(`/api/write-binary?path=${encodeURIComponent(filePath)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: data as BodyInit
    })
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(payload.error || `Write failed (${res.status})`)
    }
  },

  showSavePdfPicker: async (_title, defaultName) => `${DOWNLOAD_PREFIX}${defaultName || 'export.pdf'}`,

  listExports: (projectPath) => call<DcnExportEntry[]>('list-exports', projectPath),

  listOptics: (workspacePath) => call<DcnOpticsIndexEntry[]>('list-optics', workspacePath),
  deleteOptics: (workspacePath, switchId) => call<void>('delete-optics', workspacePath, switchId)
}

export function installHttpDcn(): void {
  if (typeof window === 'undefined' || window.dcn) return
  window.dcn = httpDcn
}
