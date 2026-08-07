import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, promises as fs } from 'node:fs'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { WORKSPACE_ROOT, resolveInRoot } from './paths.ts'
import type {
  DcnExportEntry,
  DcnOpticsIndexEntry,
  DcnProjectListEntry
} from '../preload/types.ts'

const here = dirname(fileURLToPath(import.meta.url))

function seedSourceDir(): string {
  // src/server/ -> repo root -> seed/. In the container the repo layout is preserved.
  return process.env.DCN_SEED_DIR || join(here, '..', '..', 'seed')
}

async function copyIfMissing(src: string, dst: string): Promise<boolean> {
  if (existsSync(dst)) return false
  await fs.mkdir(dirname(dst), { recursive: true })
  await fs.copyFile(src, dst)
  return true
}

/**
 * Server-side implementations of the DcnApi surface, ported from the Electron main
 * process (src/main/index.ts). The filesystem semantics are deliberately identical —
 * same directory layout, same YAML shape, same errors — so a workspace is portable
 * between the desktop app and this server.
 *
 * The five native-dialog methods (showWorkspacePicker, showImportPicker, showCsvPicker,
 * showSaveCsvPicker) have no server equivalent and are handled entirely in the browser
 * adapter (src/renderer/src/lib/http-dcn.ts); they never reach this dispatch table.
 */
export const handlers: Record<string, (...args: never[]) => unknown> = {
  'default-workspace-path': (): string => WORKSPACE_ROOT,

  'ensure-workspace': async (workspacePath: string) => {
    const root = resolveInRoot(workspacePath)
    const created: string[] = []
    for (const sub of [
      'library',
      'library/optics',
      'library/attachments',
      'library/ccw_imports',
      'projects'
    ]) {
      const p = join(root, sub)
      if (!existsSync(p)) {
        await fs.mkdir(p, { recursive: true })
        created.push(sub)
      }
    }
    const seedDir = seedSourceDir()
    const copied: string[] = []
    for (const seedFile of [
      'switches.yaml',
      'servers.yaml',
      'breakout_pairs.yaml',
      'patch_panels.yaml',
      'ipn_routers.yaml'
    ]) {
      const src = join(seedDir, seedFile)
      const dst = join(root, 'library', seedFile)
      if (existsSync(src) && (await copyIfMissing(src, dst))) {
        copied.push(seedFile)
      }
    }
    return { created, copied }
  },

  'read-yaml': async (filePath: string) => {
    const raw = await fs.readFile(resolveInRoot(filePath), 'utf8')
    return parseYaml(raw)
  },

  'write-yaml': async (filePath: string, data: unknown) => {
    const abs = resolveInRoot(filePath)
    const text = stringifyYaml(data, { lineWidth: 0, sortMapEntries: false })
    await fs.mkdir(dirname(abs), { recursive: true })
    await fs.writeFile(abs, text, 'utf8')
  },

  'file-exists': (filePath: string): boolean => existsSync(resolveInRoot(filePath)),

  'delete-file': async (filePath: string) => {
    const abs = resolveInRoot(filePath)
    if (existsSync(abs)) await fs.unlink(abs)
  },

  'list-projects': async (workspacePath: string): Promise<DcnProjectListEntry[]> => {
    const projectsDir = join(resolveInRoot(workspacePath), 'projects')
    if (!existsSync(projectsDir)) return []
    const names = await fs.readdir(projectsDir, { withFileTypes: true })
    const out: DcnProjectListEntry[] = []
    for (const entry of names) {
      if (!entry.isDirectory()) continue
      const reqPath = join(projectsDir, entry.name, 'requirements.yaml')
      if (!existsSync(reqPath)) continue
      try {
        const raw = await fs.readFile(reqPath, 'utf8')
        const data = parseYaml(raw) as {
          project?: { name?: string; customer?: string; last_edited?: string }
        }
        out.push({
          name: data?.project?.name ?? entry.name,
          path: join(projectsDir, entry.name),
          customer: data?.project?.customer ?? '',
          last_edited: data?.project?.last_edited ?? ''
        })
      } catch {
        // skip unreadable
      }
    }
    out.sort((a, b) => (b.last_edited || '').localeCompare(a.last_edited || ''))
    return out
  },

  'create-project': async (workspacePath: string, name: string, customer: string) => {
    const root = resolveInRoot(workspacePath)
    const safeName = name.trim().replace(/[^a-zA-Z0-9 _.-]/g, '_')
    if (!safeName) throw new Error('Project name cannot be empty')
    const projectPath = join(root, 'projects', safeName)
    if (existsSync(projectPath)) throw new Error(`A project named "${safeName}" already exists`)
    await fs.mkdir(projectPath, { recursive: true })
    const now = new Date().toISOString()
    const req = {
      schema_version: 1,
      project: { name: safeName, customer: customer ?? '', site: '', created: now, last_edited: now }
    }
    await fs.writeFile(
      join(projectPath, 'requirements.yaml'),
      stringifyYaml(req, { lineWidth: 0 }),
      'utf8'
    )
    return projectPath
  },

  'import-project': async (workspacePath: string, sourcePath: string, copy: boolean) => {
    const root = resolveInRoot(workspacePath)
    const src = resolveInRoot(sourcePath)
    const reqPath = join(src, 'requirements.yaml')
    if (!existsSync(reqPath)) {
      throw new Error('Selected folder is not a DCN Designer project (no requirements.yaml found)')
    }
    if (!copy) return src
    const folderName = src.split('/').pop() ?? 'imported-project'
    const dst = join(root, 'projects', folderName)
    if (existsSync(dst)) {
      throw new Error(`A project named "${folderName}" already exists in the workspace`)
    }
    await fs.cp(src, dst, { recursive: true })
    return dst
  },

  'read-text-file': (filePath: string): Promise<string> =>
    fs.readFile(resolveInRoot(filePath), 'utf8'),

  'write-text-file': async (filePath: string, text: string) => {
    const abs = resolveInRoot(filePath)
    await fs.mkdir(dirname(abs), { recursive: true })
    await fs.writeFile(abs, text, 'utf8')
  },

  // Phase 9 — PDF exports archived into the project's exports/ dir. The bytes
  // themselves arrive over PUT /api/write-binary (JSON-RPC is a poor fit for a
  // binary body); this handler only lists what landed.
  'list-exports': async (projectPath: string): Promise<DcnExportEntry[]> => {
    const exportsDir = join(resolveInRoot(projectPath), 'exports')
    if (!existsSync(exportsDir)) return []
    const entries = await fs.readdir(exportsDir, { withFileTypes: true })
    const out: DcnExportEntry[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.pdf')) continue
      const abs = join(exportsDir, entry.name)
      try {
        const st = await fs.stat(abs)
        out.push({
          name: entry.name,
          path: abs,
          size_bytes: st.size,
          created: st.mtime.toISOString()
        })
      } catch {
        // skip unreadable export
      }
    }
    out.sort((a, b) => b.created.localeCompare(a.created))
    return out
  },

  'list-optics': async (workspacePath: string): Promise<DcnOpticsIndexEntry[]> => {
    const opticsDir = join(resolveInRoot(workspacePath), 'library', 'optics')
    if (!existsSync(opticsDir)) return []
    const entries = await fs.readdir(opticsDir, { withFileTypes: true })
    const out: DcnOpticsIndexEntry[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue
      try {
        const raw = await fs.readFile(join(opticsDir, entry.name), 'utf8')
        const data = parseYaml(raw) as {
          switch_id?: string
          source_csv?: string | null
          imported_at?: string | null
          optics?: unknown[]
        }
        out.push({
          switch_id: data?.switch_id ?? entry.name.replace(/\.yaml$/, ''),
          source_csv: data?.source_csv ?? null,
          imported_at: data?.imported_at ?? null,
          optic_count: Array.isArray(data?.optics) ? data.optics.length : 0
        })
      } catch {
        // skip unreadable optics files
      }
    }
    out.sort((a, b) => a.switch_id.localeCompare(b.switch_id))
    return out
  },

  'delete-optics': async (workspacePath: string, switchId: string) => {
    const safe = switchId.replace(/[/\\]/g, '_')
    const filePath = join(resolveInRoot(workspacePath), 'library', 'optics', `${safe}.yaml`)
    if (existsSync(filePath)) await fs.unlink(filePath)
  }
}
