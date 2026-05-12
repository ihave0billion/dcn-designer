export interface DcnProjectListEntry {
  name: string
  path: string
  customer: string
  last_edited: string
}

export interface DcnApi {
  defaultWorkspacePath(): Promise<string>
  showWorkspacePicker(defaultPath: string): Promise<string | null>
  ensureWorkspace(workspacePath: string): Promise<{ created: string[]; copied: string[] }>
  readYaml<T = unknown>(filePath: string): Promise<T>
  writeYaml(filePath: string, data: unknown): Promise<void>
  fileExists(filePath: string): Promise<boolean>
  listProjects(workspacePath: string): Promise<DcnProjectListEntry[]>
  createProject(workspacePath: string, name: string, customer: string): Promise<string>
  showImportPicker(): Promise<string | null>
  importProject(workspacePath: string, sourcePath: string, copy: boolean): Promise<string>
}
