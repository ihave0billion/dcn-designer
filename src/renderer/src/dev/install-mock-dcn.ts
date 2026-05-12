// Dev-only stub of window.dcn for running the renderer in a plain browser preview.
// In production (Electron) window.dcn is provided by the preload script and this file
// is excluded by `if (import.meta.env.DEV)` in main.tsx — Vite drops the import
// entirely during the production build.

import type { DcnApi, DcnProjectListEntry } from '../../../preload/types'

type AnyRecord = Record<string, unknown>

export function installMockDcn(): void {
  if (typeof window === 'undefined') return
  if (window.dcn) return

  const switches: AnyRecord[] = [
    {
      id: 'N9K-C9364D-GX2A',
      model_display: 'Nexus 9364D-GX2A',
      vendor: 'Cisco',
      role: 'both',
      category: '400G',
      primary: { ports: 64, speed_g: 400, speed_options_g: [400], naming_template: 'Eth1/{1..64}' },
      uplink: null,
      secondary_uplink: null,
      ru: null,
      power_w: null,
      optic_hint: 'QSFP-DD',
      capabilities: {
        aci_leaf: true, aci_spine: true, nxos: true, rocev2: true,
        deep_buffer: false, smart_switch: false, ult_low_latency: false,
        poe: false, macsec: false, hpc: true, ai_ml: true, dpu_integrated: false
      },
      aci_note: null,
      asic: null,
      availability: 'available',
      available_from: null,
      notes: null,
      data_sheet_url: null,
      attachments: []
    },
    {
      id: 'N9K-C9332D-H2R',
      model_display: 'Nexus 9332D-H2R',
      vendor: 'Cisco',
      role: 'both',
      category: '400G',
      primary: { ports: 32, speed_g: 400, speed_options_g: [400], naming_template: 'Eth1/{1..32}' },
      uplink: null,
      secondary_uplink: null,
      ru: null,
      power_w: null,
      optic_hint: 'QSFP-DD',
      capabilities: {
        aci_leaf: true, aci_spine: true, nxos: true, rocev2: false,
        deep_buffer: true, smart_switch: false, ult_low_latency: false,
        poe: false, macsec: true, hpc: false, ai_ml: false, dpu_integrated: false
      },
      aci_note: 'ACI Spine requires MODE-ACI-SPINE selection at ordering time.',
      asic: null,
      availability: 'available',
      available_from: null,
      notes: 'Deep buffer: 80MB on-die packet buffer.',
      data_sheet_url: null,
      attachments: []
    },
    {
      id: 'N9K-C93400LD-H1',
      model_display: 'Nexus 93400LD-H1',
      vendor: 'Cisco',
      role: 'leaf',
      category: '25G-ToR',
      primary: { ports: 48, speed_g: 50, speed_options_g: [10, 25, 50], naming_template: 'Eth1/{1..48}' },
      uplink: { ports: 4, speed_g: 400, speed_options_g: [400], naming_template: 'Eth1/{49..52}' },
      secondary_uplink: null,
      ru: null,
      power_w: null,
      optic_hint: 'SFP56 (primary) / QSFP-DD (uplink)',
      capabilities: {
        aci_leaf: true, aci_spine: false, nxos: true, rocev2: false,
        deep_buffer: false, smart_switch: false, ult_low_latency: false,
        poe: false, macsec: false, hpc: false, ai_ml: false, dpu_integrated: false
      },
      aci_note: null,
      asic: null,
      availability: 'available',
      available_from: null,
      notes: null,
      data_sheet_url: null,
      attachments: []
    }
  ]

  const servers: AnyRecord[] = [
    {
      id: 'UCS-C220-M7',
      model_display: 'UCS C220 M7 Rack Server',
      vendor: 'Cisco',
      role: 'server',
      category: 'Compute',
      ru: 1,
      power_w: null,
      ports: [{ count: 2, speed_g: 25, naming_template: 'MLOM/{1..2}' }],
      gpu: null,
      notes: null,
      data_sheet_url: null,
      attachments: []
    },
    {
      id: 'UCS-C885A-M8',
      model_display: 'UCS C885A M8 AI Server',
      vendor: 'Cisco',
      role: 'server',
      category: 'AI/HPC',
      ru: 8,
      power_w: null,
      ports: [{ count: 8, speed_g: 400, naming_template: 'NIC/{1..8}' }],
      gpu: { model: 'Nvidia H200', count: 8 },
      notes: null,
      data_sheet_url: null,
      attachments: []
    }
  ]

  const projects: DcnProjectListEntry[] = []

  const mock: DcnApi = {
    defaultWorkspacePath: async () => '/Users/hectgarc/DCN-Designer-Mock',
    showWorkspacePicker: async (def) => def || '/Users/hectgarc/DCN-Designer-Mock',
    ensureWorkspace: async () => ({ created: [], copied: [] }),
    readYaml: async <T = unknown>(filePath: string): Promise<T> => {
      if (filePath.endsWith('switches.yaml')) return { schema_version: 1, switches: structuredClone(switches) } as T
      if (filePath.endsWith('servers.yaml')) return { schema_version: 1, servers: structuredClone(servers) } as T
      if (filePath.endsWith('requirements.yaml')) {
        const now = new Date().toISOString()
        return { schema_version: 1, project: { name: 'mock-proj', customer: 'Mock Co.', site: '', created: now, last_edited: now } } as T
      }
      throw new Error(`[mock] readYaml not handled: ${filePath}`)
    },
    writeYaml: async (filePath, data) => {
      const d = data as { switches?: AnyRecord[]; servers?: AnyRecord[] }
      if (filePath.endsWith('switches.yaml') && d.switches) {
        switches.length = 0
        switches.push(...d.switches)
      } else if (filePath.endsWith('servers.yaml') && d.servers) {
        servers.length = 0
        servers.push(...d.servers)
      }
    },
    fileExists: async () => true,
    listProjects: async () => structuredClone(projects),
    createProject: async (workspacePath, name, customer) => {
      const path = `${workspacePath}/projects/${name}`
      projects.push({ name, path, customer, last_edited: new Date().toISOString() })
      return path
    },
    showImportPicker: async () => null,
    importProject: async () => '/mock-imported'
  }

  Object.defineProperty(window, 'dcn', { value: mock, writable: false, configurable: false })
  // eslint-disable-next-line no-console
  console.info('[dev] installed mock window.dcn for browser preview')
}
