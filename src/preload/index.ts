import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { DcnApi } from './types'

const dcn: DcnApi = {
  defaultWorkspacePath: () => ipcRenderer.invoke('dcn:default-workspace-path'),
  showWorkspacePicker: (defaultPath) => ipcRenderer.invoke('dcn:show-workspace-picker', defaultPath),
  ensureWorkspace: (workspacePath) => ipcRenderer.invoke('dcn:ensure-workspace', workspacePath),
  readYaml: (filePath) => ipcRenderer.invoke('dcn:read-yaml', filePath),
  writeYaml: (filePath, data) => ipcRenderer.invoke('dcn:write-yaml', filePath, data),
  fileExists: (filePath) => ipcRenderer.invoke('dcn:file-exists', filePath),
  listProjects: (workspacePath) => ipcRenderer.invoke('dcn:list-projects', workspacePath),
  createProject: (workspacePath, name, customer) =>
    ipcRenderer.invoke('dcn:create-project', workspacePath, name, customer),
  showImportPicker: () => ipcRenderer.invoke('dcn:show-import-picker'),
  importProject: (workspacePath, sourcePath, copy) =>
    ipcRenderer.invoke('dcn:import-project', workspacePath, sourcePath, copy)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('dcn', dcn)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error window typing intentionally relaxed for dev fallback
  window.electron = electronAPI
  // @ts-expect-error window typing intentionally relaxed for dev fallback
  window.dcn = dcn
}
