import { SwitchesFileSchema, type SwitchesFile, type Switch } from '@/schemas/switches'
import { ServersFileSchema, type ServersFile, type Server } from '@/schemas/servers'

export function librarySwitchesPath(workspacePath: string): string {
  return `${workspacePath}/library/switches.yaml`
}

export function libraryServersPath(workspacePath: string): string {
  return `${workspacePath}/library/servers.yaml`
}

export async function loadSwitchesFile(workspacePath: string): Promise<SwitchesFile> {
  const raw = await window.dcn.readYaml(librarySwitchesPath(workspacePath))
  const parsed = SwitchesFileSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`switches.yaml schema validation failed: ${parsed.error.message}`)
  }
  return parsed.data
}

export async function saveSwitches(workspacePath: string, switches: Switch[]): Promise<void> {
  const file: SwitchesFile = { schema_version: 1, switches }
  const parsed = SwitchesFileSchema.safeParse(file)
  if (!parsed.success) {
    throw new Error(`switches.yaml schema validation failed before save: ${parsed.error.message}`)
  }
  await window.dcn.writeYaml(librarySwitchesPath(workspacePath), parsed.data)
}

export async function loadServersFile(workspacePath: string): Promise<ServersFile> {
  const raw = await window.dcn.readYaml(libraryServersPath(workspacePath))
  const parsed = ServersFileSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`servers.yaml schema validation failed: ${parsed.error.message}`)
  }
  return parsed.data
}

export async function saveServers(workspacePath: string, servers: Server[]): Promise<void> {
  const file: ServersFile = { schema_version: 1, servers }
  const parsed = ServersFileSchema.safeParse(file)
  if (!parsed.success) {
    throw new Error(`servers.yaml schema validation failed before save: ${parsed.error.message}`)
  }
  await window.dcn.writeYaml(libraryServersPath(workspacePath), parsed.data)
}
