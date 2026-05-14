import { SwitchesFileSchema, type SwitchesFile, type Switch } from '@/schemas/switches'
import { ServersFileSchema, type ServersFile, type Server } from '@/schemas/servers'
import { OpticsFileSchema, type OpticsFile, type Optic } from '@/schemas/optics'
import { RackMappingFileSchema, type RackMappingFile } from '@/schemas/rack-mapping'
import {
  PatchPanelsFileSchema,
  type PatchPanel,
  type PatchPanelsFile
} from '@/schemas/patch-panels'
import {
  CableLinksFileSchema,
  type CableLink,
  type CableLinksFile
} from '@/schemas/cable-links'
import { BreakoutPairsFileSchema, type BreakoutPair, type BreakoutPairsFile } from '@domain'

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

export function libraryOpticsPath(workspacePath: string, switchId: string): string {
  const safe = switchId.replace(/[/\\]/g, '_')
  return `${workspacePath}/library/optics/${safe}.yaml`
}

export async function loadOpticsFile(workspacePath: string, switchId: string): Promise<OpticsFile> {
  const raw = await window.dcn.readYaml(libraryOpticsPath(workspacePath, switchId))
  const parsed = OpticsFileSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`optics/${switchId}.yaml schema validation failed: ${parsed.error.message}`)
  }
  return parsed.data
}

export async function saveOpticsFile(
  workspacePath: string,
  switchId: string,
  optics: Optic[],
  sourceCsv: string | null,
  importedAt: string | null
): Promise<void> {
  const file: OpticsFile = {
    schema_version: 1,
    switch_id: switchId,
    source_csv: sourceCsv,
    imported_at: importedAt,
    optics
  }
  const parsed = OpticsFileSchema.safeParse(file)
  if (!parsed.success) {
    throw new Error(`optics/${switchId}.yaml schema validation failed before save: ${parsed.error.message}`)
  }
  await window.dcn.writeYaml(libraryOpticsPath(workspacePath, switchId), parsed.data)
}

// ────────────────────────────────────────────────────────────────────
// Breakout pairs — curated optic-pair list consumed by the solver
// (seeded into workspace/library/breakout_pairs.yaml on first run)
// ────────────────────────────────────────────────────────────────────

export function libraryBreakoutPairsPath(workspacePath: string): string {
  return `${workspacePath}/library/breakout_pairs.yaml`
}

// Returns [] when the file is missing (older workspaces predate Phase 4 bootstrap).
// The solver treats an empty list as "no breakout suggestions available" and
// continues without crashing.
export async function loadBreakoutPairs(workspacePath: string): Promise<BreakoutPair[]> {
  const path = libraryBreakoutPairsPath(workspacePath)
  const exists = await window.dcn.fileExists(path)
  if (!exists) return []
  const raw = await window.dcn.readYaml(path)
  const parsed = BreakoutPairsFileSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`breakout_pairs.yaml schema validation failed: ${parsed.error.message}`)
  }
  return parsed.data.pairs
}

export type { BreakoutPair, BreakoutPairsFile }

// ────────────────────────────────────────────────────────────────────
// Rack mapping — user-curated rack layout (Phase 5)
// Lives at <project>/rack_mapping.yaml. Absent = solver layout still
// in effect; present = user has forked.
// ────────────────────────────────────────────────────────────────────

export function rackMappingPath(projectPath: string): string {
  return `${projectPath}/rack_mapping.yaml`
}

export async function loadRackMapping(projectPath: string): Promise<RackMappingFile | null> {
  const path = rackMappingPath(projectPath)
  const exists = await window.dcn.fileExists(path)
  if (!exists) return null
  const raw = await window.dcn.readYaml(path)
  const parsed = RackMappingFileSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`rack_mapping.yaml schema validation failed: ${parsed.error.message}`)
  }
  return parsed.data
}

export async function saveRackMapping(
  projectPath: string,
  mapping: RackMappingFile
): Promise<void> {
  const parsed = RackMappingFileSchema.safeParse(mapping)
  if (!parsed.success) {
    throw new Error(`rack_mapping.yaml schema validation failed before save: ${parsed.error.message}`)
  }
  await window.dcn.writeYaml(rackMappingPath(projectPath), parsed.data)
}

export async function deleteRackMapping(projectPath: string): Promise<void> {
  const path = rackMappingPath(projectPath)
  const exists = await window.dcn.fileExists(path)
  if (!exists) return
  await window.dcn.deleteFile(path)
}

export type { RackMappingFile }

// ────────────────────────────────────────────────────────────────────
// Patch panels — curated MPO ↔ LC cassette library (Phase 6)
// Seeded into workspace/library/patch_panels.yaml on first run.
// ────────────────────────────────────────────────────────────────────

export function libraryPatchPanelsPath(workspacePath: string): string {
  return `${workspacePath}/library/patch_panels.yaml`
}

// Returns [] when the file is missing (older workspaces predate Phase 6
// bootstrap). The synthetic-SKU fallback in patch-panel-resolver
// handles connector pairs not in the curated list.
export async function loadPatchPanels(workspacePath: string): Promise<PatchPanel[]> {
  const path = libraryPatchPanelsPath(workspacePath)
  const exists = await window.dcn.fileExists(path)
  if (!exists) return []
  const raw = await window.dcn.readYaml(path)
  const parsed = PatchPanelsFileSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`patch_panels.yaml schema validation failed: ${parsed.error.message}`)
  }
  return parsed.data.patch_panels
}

export type { PatchPanel, PatchPanelsFile }

// ────────────────────────────────────────────────────────────────────
// Cable links — per project wiring file (Phase 6)
// Lives at <project>/cable_links.yaml. Auto-seeded by Generate Design
// when absent; first user edit flips source: 'user' + forked_at.
// ────────────────────────────────────────────────────────────────────

export function cableLinksPath(projectPath: string): string {
  return `${projectPath}/cable_links.yaml`
}

export async function loadCableLinks(projectPath: string): Promise<CableLinksFile | null> {
  const path = cableLinksPath(projectPath)
  const exists = await window.dcn.fileExists(path)
  if (!exists) return null
  const raw = await window.dcn.readYaml(path)
  const parsed = CableLinksFileSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`cable_links.yaml schema validation failed: ${parsed.error.message}`)
  }
  return parsed.data
}

export async function saveCableLinks(
  projectPath: string,
  file: CableLinksFile
): Promise<void> {
  const parsed = CableLinksFileSchema.safeParse(file)
  if (!parsed.success) {
    throw new Error(`cable_links.yaml schema validation failed before save: ${parsed.error.message}`)
  }
  await window.dcn.writeYaml(cableLinksPath(projectPath), parsed.data)
}

export async function deleteCableLinks(projectPath: string): Promise<void> {
  const path = cableLinksPath(projectPath)
  const exists = await window.dcn.fileExists(path)
  if (!exists) return
  await window.dcn.deleteFile(path)
}

export type { CableLink, CableLinksFile }
