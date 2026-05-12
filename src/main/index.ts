import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, promises as fs } from 'node:fs'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

function defaultWorkspacePath(): string {
  return join(homedir(), 'DCN-Designer')
}

function seedSourceDir(): string {
  // In dev, seeds live at <repo>/seed/. In packaged builds, copy via electron-builder
  // extraResources later (deferred to packaging phase).
  if (is.dev) {
    return join(app.getAppPath(), 'seed')
  }
  return join(process.resourcesPath, 'seed')
}

async function copyIfMissing(src: string, dst: string): Promise<boolean> {
  if (existsSync(dst)) return false
  await fs.mkdir(dirname(dst), { recursive: true })
  await fs.copyFile(src, dst)
  return true
}

function registerIpc(): void {
  ipcMain.handle('dcn:default-workspace-path', () => defaultWorkspacePath())

  ipcMain.handle('dcn:show-workspace-picker', async (_e, defaultPath: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Choose workspace folder',
      defaultPath: defaultPath || defaultWorkspacePath(),
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dcn:ensure-workspace', async (_e, workspacePath: string) => {
    const created: string[] = []
    for (const sub of ['library', 'library/optics', 'library/attachments', 'library/ccw_imports', 'projects']) {
      const p = join(workspacePath, sub)
      if (!existsSync(p)) {
        await fs.mkdir(p, { recursive: true })
        created.push(sub)
      }
    }
    // Copy seeds if missing
    const seedDir = seedSourceDir()
    const copied: string[] = []
    for (const seedFile of ['switches.yaml', 'servers.yaml']) {
      const src = join(seedDir, seedFile)
      const dst = join(workspacePath, 'library', seedFile)
      if (existsSync(src) && (await copyIfMissing(src, dst))) {
        copied.push(seedFile)
      }
    }
    return { created, copied }
  })

  ipcMain.handle('dcn:read-yaml', async (_e, filePath: string) => {
    const raw = await fs.readFile(filePath, 'utf8')
    return parseYaml(raw)
  })

  ipcMain.handle('dcn:write-yaml', async (_e, filePath: string, data: unknown) => {
    const text = stringifyYaml(data, { lineWidth: 0, sortMapEntries: false })
    await fs.mkdir(dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, text, 'utf8')
  })

  ipcMain.handle('dcn:file-exists', async (_e, filePath: string) => {
    return existsSync(filePath)
  })

  ipcMain.handle('dcn:list-projects', async (_e, workspacePath: string) => {
    const projectsDir = join(workspacePath, 'projects')
    if (!existsSync(projectsDir)) return []
    const names = await fs.readdir(projectsDir, { withFileTypes: true })
    const out: Array<{ name: string; path: string; customer: string; last_edited: string }> = []
    for (const entry of names) {
      if (!entry.isDirectory()) continue
      const reqPath = join(projectsDir, entry.name, 'requirements.yaml')
      if (!existsSync(reqPath)) continue
      try {
        const raw = await fs.readFile(reqPath, 'utf8')
        const data = parseYaml(raw) as { project?: { name?: string; customer?: string; last_edited?: string } }
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
  })

  ipcMain.handle('dcn:create-project', async (_e, workspacePath: string, name: string, customer: string) => {
    const safeName = name.trim().replace(/[^a-zA-Z0-9 _.-]/g, '_')
    if (!safeName) throw new Error('Project name cannot be empty')
    const projectPath = join(workspacePath, 'projects', safeName)
    if (existsSync(projectPath)) throw new Error(`A project named "${safeName}" already exists`)
    await fs.mkdir(projectPath, { recursive: true })
    const now = new Date().toISOString()
    const req = {
      schema_version: 1,
      project: { name: safeName, customer: customer ?? '', site: '', created: now, last_edited: now }
    }
    await fs.writeFile(join(projectPath, 'requirements.yaml'), stringifyYaml(req, { lineWidth: 0 }), 'utf8')
    return projectPath
  })

  ipcMain.handle('dcn:show-import-picker', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import existing project',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dcn:import-project', async (_e, workspacePath: string, sourcePath: string, copy: boolean) => {
    const reqPath = join(sourcePath, 'requirements.yaml')
    if (!existsSync(reqPath)) {
      throw new Error('Selected folder is not a DCN Designer project (no requirements.yaml found)')
    }
    if (!copy) return sourcePath
    const folderName = sourcePath.split('/').pop() ?? 'imported-project'
    const dst = join(workspacePath, 'projects', folderName)
    if (existsSync(dst)) {
      throw new Error(`A project named "${folderName}" already exists in the workspace`)
    }
    await fs.cp(sourcePath, dst, { recursive: true })
    return dst
  })

  ipcMain.handle('dcn:show-csv-picker', async (_e, title: string) => {
    const result = await dialog.showOpenDialog({
      title: title || 'Choose CSV file',
      properties: ['openFile'],
      filters: [
        { name: 'CSV / TSV', extensions: ['csv', 'tsv', 'txt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    return { path: filePath, basename: filePath.split('/').pop() ?? filePath }
  })

  ipcMain.handle('dcn:read-text-file', async (_e, filePath: string) => {
    return fs.readFile(filePath, 'utf8')
  })

  ipcMain.handle('dcn:list-optics', async (_e, workspacePath: string) => {
    const opticsDir = join(workspacePath, 'library', 'optics')
    if (!existsSync(opticsDir)) return []
    const entries = await fs.readdir(opticsDir, { withFileTypes: true })
    const out: Array<{ switch_id: string; source_csv: string | null; imported_at: string | null; optic_count: number }> = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue
      const filePath = join(opticsDir, entry.name)
      try {
        const raw = await fs.readFile(filePath, 'utf8')
        const data = parseYaml(raw) as {
          switch_id?: string
          source_csv?: string | null
          imported_at?: string | null
          optics?: unknown[]
        }
        const switchId = data?.switch_id ?? entry.name.replace(/\.yaml$/, '')
        out.push({
          switch_id: switchId,
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
  })

  ipcMain.handle('dcn:delete-optics', async (_e, workspacePath: string, switchId: string) => {
    const safe = switchId.replace(/[/\\]/g, '_')
    const filePath = join(workspacePath, 'library', 'optics', `${safe}.yaml`)
    if (existsSync(filePath)) {
      await fs.unlink(filePath)
    }
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.dcndesigner.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
