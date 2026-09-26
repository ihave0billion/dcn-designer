export interface DcnProjectListEntry {
  name: string
  path: string
  customer: string
  last_edited: string
}

export interface DcnOpticsIndexEntry {
  switch_id: string
  source_csv: string | null
  imported_at: string | null
  optic_count: number
}

export interface DcnExportEntry {
  name: string
  path: string
  size_bytes: number
  created: string
}

export interface DcnApi {
  defaultWorkspacePath(): Promise<string>
  showWorkspacePicker(defaultPath: string): Promise<string | null>
  ensureWorkspace(workspacePath: string): Promise<{ created: string[]; copied: string[] }>
  readYaml<T = unknown>(filePath: string): Promise<T>
  writeYaml(filePath: string, data: unknown): Promise<void>
  fileExists(filePath: string): Promise<boolean>
  deleteFile(filePath: string): Promise<void>
  listProjects(workspacePath: string): Promise<DcnProjectListEntry[]>
  createProject(workspacePath: string, name: string, customer: string): Promise<string>
  showImportPicker(): Promise<string | null>
  importProject(workspacePath: string, sourcePath: string, copy: boolean): Promise<string>
  showCsvPicker(title: string): Promise<{ path: string; basename: string } | null>
  readTextFile(filePath: string): Promise<string>
  writeTextFile(filePath: string, text: string): Promise<void>
  showSaveCsvPicker(title: string, defaultName: string): Promise<string | null>
  // Phase 9 — PDF export. Mirrors the CSV pair above, but for binary payloads.
  // The web adapter has no host filesystem to save into, so its picker returns
  // a `browser-download:` pseudo-path that writeBinaryFile turns into a download.
  writeBinaryFile(filePath: string, data: Uint8Array): Promise<void>
  // Phase 13 — Visio export reads stencil assets (master XML/EMF, PNG photos)
  // out of <workspace>/library/visio/. Text parts use readTextFile.
  readBinaryFile(filePath: string): Promise<Uint8Array>
  showSavePdfPicker(title: string, defaultName: string): Promise<string | null>
  showSaveVisioPicker(title: string, defaultName: string): Promise<string | null>
  listExports(projectPath: string): Promise<DcnExportEntry[]>
  listOptics(workspacePath: string): Promise<DcnOpticsIndexEntry[]>
  deleteOptics(workspacePath: string, switchId: string): Promise<void>
}
