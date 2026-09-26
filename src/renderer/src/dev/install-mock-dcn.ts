// Dev-only stub of window.dcn for running the renderer in a plain browser preview.
// In production (Electron) window.dcn is provided by the preload script and this file
// is excluded by `if (import.meta.env.DEV)` in main.tsx — Vite drops the import
// entirely during the production build.

import type { DcnApi, DcnOpticsIndexEntry, DcnProjectListEntry } from '../../../preload/types'

type AnyRecord = Record<string, unknown>

const MOCK_OPTICS_CSV = `Network Device Product Family,Network Device Product ID,Network Device Breakout mode,Transceiver Business Unit,Transceiver Product Family,Transceiver Product ID,Transceiver Version ID,Transceiver End of Sale,OS Type,Min Software Release,DOM OS Type,DOM Support,Network Device Notes,Data Rate,Form Factor,Reach,Cable Type,Media,Connector Type,Transceiver Type,Case Temperature,DOM Capable,Standard,Transceiver Notes,Network Device Product ID Data Sheet (link),Transceiver Product ID Data Sheet (link)
N9300,N9K-C9364D-GX2A, ,TMG,QSFP100,QSFP-100G-SR4-S, , ,ACI,ACI-N9KDK9-15.2(5),ACI,ACI-N9KDK9-15.2(5), ,100 Gbps,QSFP28,100m,Parallel Fiber,MMF,MPO-12 (UPC),Optic,0 to 70C,Y,IEEE 100GBASE-SR4,OM3: 70m; OM4/OM5: 100m. ,https://example.com/switch.html,https://example.com/optic.html,
N9300,N9K-C9364D-GX2A, ,TMG,QSFP100,QSFP-100G-SR4-S, , ,NX-OS,NX-OS 10.2(3) F,NX-OS,NX-OS 10.2(3) F, ,100 Gbps,QSFP28,100m,Parallel Fiber,MMF,MPO-12 (UPC),Optic,0 to 70C,Y,IEEE 100GBASE-SR4,OM3: 70m; OM4/OM5: 100m. ,https://example.com/switch.html,https://example.com/optic.html,
N9300,N9K-C9364D-GX2A, ,TMG,QSFP100,QSFP-100G-LR4-S, , ,ACI,ACI-N9KDK9-15.2(5),ACI,ACI-N9KDK9-15.2(5), ,100 Gbps,QSFP28,10km,Duplex Fiber,SMF,LC (UPC),Optic,0 to 70C,Y,IEEE 100GBASE-LR4, ,https://example.com/switch.html,https://example.com/optic.html,
N9300,N9K-C9364D-GX2A, ,TMG,QSFP100,QSFP-100G-LR4-S, , ,NX-OS,NX-OS 10.2(3) F,NX-OS,NX-OS 10.2(3) F, ,100 Gbps,QSFP28,10km,Duplex Fiber,SMF,LC (UPC),Optic,0 to 70C,Y,IEEE 100GBASE-LR4, ,https://example.com/switch.html,https://example.com/optic.html,
N9300,N9K-C9364D-GX2A, ,TMG,QDD400G,QDD-400G-SR4.2, ,Y,NX-OS,NX-OS 10.4(2)F,NX-OS,NX-OS 10.4(2)F, ,400 Gbps,QSFP-DD,100m,Parallel Fiber,MMF,MPO-12 (APC),Optic,0 to 70C,Y,IEEE 400GBASE-SR4.2,OM4: 100m. ,https://example.com/switch.html,https://example.com/optic.html,
N9300,N9K-C9332D-H2R, ,TMG,QDD400G,QDD-400G-LR4-S, , ,NX-OS,NX-OS 10.2(3) F,NX-OS,NX-OS 10.2(3) F, ,400 Gbps,QSFP-DD,10km,Duplex Fiber,SMF,LC (UPC),Optic,0 to 70C,Y,IEEE 400GBASE-LR4, ,https://example.com/switch.html,https://example.com/optic.html,
`

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

  // Per-switch optics: map of `library/optics/<id>.yaml` → file content (mutable)
  const opticsFiles = new Map<string, AnyRecord>()

  // Per-project requirements.yaml content keyed by absolute file path. Lets
  // save + reload round-trip in browser preview without a real filesystem.
  const requirementsFiles = new Map<string, AnyRecord>()

  // Per-project design.yaml content (Phase 4 — solver output round-trip).
  const designFiles = new Map<string, AnyRecord>()

  // Per-project rack_mapping.yaml content (Phase 5 — user-curated fork).
  const rackMappingFiles = new Map<string, AnyRecord>()

  // Per-project cable_links.yaml content (Phase 6 — fabric uplink wiring).
  const cableLinksFiles = new Map<string, AnyRecord>()

  // Per-project topology_layout.yaml content (Phase 7 — node positions).
  const topologyLayoutFiles = new Map<string, AnyRecord>()

  // Generic plain-text files (Phase 6 — CSV export round-trip).
  const textFiles = new Map<string, string>()

  // Binary files (Phase 9 — PDF export round-trip).
  const binaryFiles = new Map<string, Uint8Array>()

  // Curated patch-panel library (mirrors seed/patch_panels.yaml).
  const patchPanels = {
    schema_version: 1,
    patch_panels: [
      {
        id: 'PANDUIT-FAP12WBLAQ',
        vendor: 'Panduit',
        description: '12-fiber MPO-12 to 6× LC duplex cassette, OM4',
        connector_a: 'MPO-12 (UPC)',
        connector_b: 'LC (UPC)',
        fanout: 6,
        media: 'MMF',
        notes: null,
        data_sheet_url: null
      },
      {
        id: 'CISCO-BREAKOUT-MOD-MPO12-LC',
        vendor: 'Cisco',
        description: 'Generic Cisco MPO-12 to 4× LC breakout module',
        connector_a: 'MPO-12 (UPC)',
        connector_b: 'LC (UPC)',
        fanout: 4,
        media: 'MMF',
        notes: null,
        data_sheet_url: null
      }
    ]
  }

  // ipn_routers.yaml mirror — seeded into every mock workspace so the
  // Requirements IPN-router picker is populated and the multi-pod solver
  // can pick a router in browser preview (Phase 9b). Mirrors a subset of
  // seed/ipn_routers.yaml; the two 400G entries match the mock switches
  // above so committed multi-pod designs reference familiar models.
  const ipnRouters = {
    schema_version: 1,
    ipn_routers: [
      {
        id: 'N9K-C9364D-GX2A',
        model_display: 'Nexus 9364D-GX2A',
        vendor: 'Cisco',
        primary: { ports: 64, speed_g: 400, speed_options_g: [400], naming_template: 'Eth1/{1..64}' },
        ru: null,
        power_w: null,
        capabilities: { multipod: true, multisite: true, mpls_handoff: false },
        availability: 'available',
        notes: 'Mirrors N9K-C9364D-GX2A — 64× 400G high-density IPN for 400G-spine fabrics.'
      },
      {
        id: 'N9K-C9332D-H2R',
        model_display: 'Nexus 9332D-H2R',
        vendor: 'Cisco',
        primary: { ports: 32, speed_g: 400, speed_options_g: [400], naming_template: 'Eth1/{1..32}' },
        ru: null,
        power_w: null,
        capabilities: { multipod: true, multisite: true, mpls_handoff: false },
        availability: 'available',
        notes: 'Mirrors N9K-C9332D-H2R — 32× 400G deep-buffer IPN.'
      },
      {
        id: 'N9K-C9364C-H1',
        model_display: 'Nexus 9364C-H1',
        vendor: 'Cisco',
        primary: { ports: 64, speed_g: 100, speed_options_g: [100], naming_template: 'Eth1/{1..64}' },
        ru: null,
        power_w: null,
        capabilities: { multipod: true, multisite: true, mpls_handoff: false },
        availability: 'available',
        notes: 'Mirrors N9K-C9364C-H1 — 64× 100G IPN for 100G-spine fabrics.'
      }
    ]
  }

  // breakout_pairs.yaml mirror — seeded into every mock workspace.
  // Same two verified pairs as `seed/breakout_pairs.yaml` so the solver
  // matches verified-pair lookups in browser preview.
  const breakoutPairs = {
    schema_version: 1,
    pairs: [
      {
        spine_pid: 'QDD-400G-BD',
        leaf_pid: 'QSFP-100G-SR1.2',
        fanout: 1,
        spine_connector: 'LC (UPC)',
        leaf_connector: 'LC (UPC)',
        requires_patch_panel: false,
        verified_by: 'mock-seed'
      },
      {
        spine_pid: 'QDD-400G-SR4.2',
        leaf_pid: 'QSFP-100G-SR1.2',
        fanout: 4,
        spine_connector: 'MPO-12 (UPC)',
        leaf_connector: 'LC (UPC)',
        requires_patch_panel: true,
        verified_by: 'mock-seed'
      }
    ]
  }

  function opticsPathFor(switchId: string): string {
    return `/mock-workspace/library/optics/${switchId}.yaml`
  }

  const mock: DcnApi = {
    defaultWorkspacePath: async () => '/Users/hectgarc/DCN-Designer-Mock',
    showWorkspacePicker: async (def) => def || '/Users/hectgarc/DCN-Designer-Mock',
    ensureWorkspace: async () => ({ created: [], copied: [] }),
    readYaml: async <T = unknown>(filePath: string): Promise<T> => {
      if (filePath.endsWith('switches.yaml')) return { schema_version: 1, switches: structuredClone(switches) } as T
      if (filePath.endsWith('servers.yaml')) return { schema_version: 1, servers: structuredClone(servers) } as T
      if (filePath.endsWith('breakout_pairs.yaml')) return structuredClone(breakoutPairs) as T
      if (filePath.endsWith('ipn_routers.yaml')) return structuredClone(ipnRouters) as T
      if (filePath.endsWith('patch_panels.yaml')) return structuredClone(patchPanels) as T
      if (filePath.endsWith('cable_links.yaml')) {
        const cached = cableLinksFiles.get(filePath)
        if (cached) return structuredClone(cached) as T
        throw new Error(`[mock] no cable_links file at ${filePath}`)
      }
      if (filePath.endsWith('requirements.yaml')) {
        const cached = requirementsFiles.get(filePath)
        if (cached) return structuredClone(cached) as T
        const now = new Date().toISOString()
        return { schema_version: 1, project: { name: 'mock-proj', customer: 'Mock Co.', site: '', created: now, last_edited: now } } as T
      }
      if (filePath.endsWith('design.yaml')) {
        const cached = designFiles.get(filePath)
        if (cached) return structuredClone(cached) as T
        throw new Error(`[mock] no design file at ${filePath}`)
      }
      if (filePath.endsWith('rack_mapping.yaml')) {
        const cached = rackMappingFiles.get(filePath)
        if (cached) return structuredClone(cached) as T
        throw new Error(`[mock] no rack_mapping file at ${filePath}`)
      }
      if (filePath.endsWith('topology_layout.yaml')) {
        const cached = topologyLayoutFiles.get(filePath)
        if (cached) return structuredClone(cached) as T
        throw new Error(`[mock] no topology_layout file at ${filePath}`)
      }
      if (filePath.includes('/library/optics/')) {
        const cached = opticsFiles.get(filePath)
        if (cached) return structuredClone(cached) as T
        throw new Error(`[mock] no optics file at ${filePath}`)
      }
      throw new Error(`[mock] readYaml not handled: ${filePath}`)
    },
    writeYaml: async (filePath, data) => {
      const d = data as { switches?: AnyRecord[]; servers?: AnyRecord[]; switch_id?: string; optics?: AnyRecord[] }
      if (filePath.endsWith('switches.yaml') && d.switches) {
        switches.length = 0
        switches.push(...d.switches)
      } else if (filePath.endsWith('servers.yaml') && d.servers) {
        servers.length = 0
        servers.push(...d.servers)
      } else if (filePath.includes('/library/optics/')) {
        opticsFiles.set(filePath, structuredClone(data as AnyRecord))
      } else if (filePath.endsWith('requirements.yaml')) {
        requirementsFiles.set(filePath, structuredClone(data as AnyRecord))
      } else if (filePath.endsWith('design.yaml')) {
        designFiles.set(filePath, structuredClone(data as AnyRecord))
      } else if (filePath.endsWith('rack_mapping.yaml')) {
        rackMappingFiles.set(filePath, structuredClone(data as AnyRecord))
      } else if (filePath.endsWith('cable_links.yaml')) {
        cableLinksFiles.set(filePath, structuredClone(data as AnyRecord))
      } else if (filePath.endsWith('topology_layout.yaml')) {
        topologyLayoutFiles.set(filePath, structuredClone(data as AnyRecord))
      }
    },
    fileExists: async (filePath: string) => {
      // Files that always exist in the mock workspace
      if (filePath.endsWith('switches.yaml')) return true
      if (filePath.endsWith('servers.yaml')) return true
      if (filePath.endsWith('breakout_pairs.yaml')) return true
      if (filePath.endsWith('ipn_routers.yaml')) return true
      if (filePath.endsWith('patch_panels.yaml')) return true
      if (filePath.endsWith('requirements.yaml')) return requirementsFiles.has(filePath)
      if (filePath.endsWith('design.yaml')) return designFiles.has(filePath)
      if (filePath.endsWith('rack_mapping.yaml')) return rackMappingFiles.has(filePath)
      if (filePath.endsWith('cable_links.yaml')) return cableLinksFiles.has(filePath)
      if (filePath.endsWith('topology_layout.yaml')) return topologyLayoutFiles.has(filePath)
      if (filePath.includes('/library/optics/')) return opticsFiles.has(filePath)
      return false
    },
    deleteFile: async (filePath: string) => {
      if (filePath.endsWith('rack_mapping.yaml')) rackMappingFiles.delete(filePath)
      else if (filePath.endsWith('cable_links.yaml')) cableLinksFiles.delete(filePath)
      else if (filePath.endsWith('topology_layout.yaml')) topologyLayoutFiles.delete(filePath)
      else if (filePath.endsWith('design.yaml')) designFiles.delete(filePath)
      else if (filePath.endsWith('requirements.yaml')) requirementsFiles.delete(filePath)
      else if (filePath.includes('/library/optics/')) opticsFiles.delete(filePath)
    },
    listProjects: async () =>
      projects.map((p) => {
        const reqPath = `${p.path}/requirements.yaml`
        const req = requirementsFiles.get(reqPath) as
          | { project?: { last_edited?: string; customer?: string; name?: string } }
          | undefined
        return {
          ...p,
          name: req?.project?.name ?? p.name,
          customer: req?.project?.customer ?? p.customer,
          last_edited: req?.project?.last_edited ?? p.last_edited
        }
      }),
    createProject: async (workspacePath, name, customer) => {
      const path = `${workspacePath}/projects/${name}`
      const now = new Date().toISOString()
      projects.push({ name, path, customer, last_edited: now })
      requirementsFiles.set(`${path}/requirements.yaml`, {
        schema_version: 1,
        project: { name, customer: customer ?? '', site: '', created: now, last_edited: now }
      })
      return path
    },
    showImportPicker: async () => null,
    importProject: async () => '/mock-imported',
    showCsvPicker: async () => ({ path: '/mock/N9K-C9364D-GX2A-OPTICS.csv', basename: 'N9K-C9364D-GX2A-OPTICS.csv' }),
    readTextFile: async (filePath) => {
      const stored = textFiles.get(filePath)
      if (stored != null) return stored
      if (filePath.endsWith('.csv')) return MOCK_OPTICS_CSV
      throw new Error(`[mock] readTextFile not handled: ${filePath}`)
    },
    writeTextFile: async (filePath, text) => {
      textFiles.set(filePath, text)
    },
    showSaveCsvPicker: async (_title, defaultName) =>
      `/mock-export/${defaultName || 'export.csv'}`,
    writeBinaryFile: async (filePath, data) => {
      binaryFiles.set(filePath, data)
    },
    readBinaryFile: async (filePath) => {
      const stored = binaryFiles.get(filePath)
      if (!stored) throw new Error(`[mock] readBinaryFile not handled: ${filePath}`)
      return stored
    },
    showSavePdfPicker: async (_title, defaultName) =>
      `/mock-export/${defaultName || 'export.pdf'}`,
    showSaveVisioPicker: async (_title, defaultName) =>
      `/mock-export/${defaultName || 'topology.vsdx'}`,
    listExports: async (projectPath) => {
      const prefix = `${projectPath}/exports/`
      return [...binaryFiles.entries()]
        .filter(([path]) => path.startsWith(prefix) && (path.endsWith('.pdf') || path.endsWith('.vsdx')))
        .map(([path, bytes]) => ({
          name: path.slice(prefix.length),
          path,
          size_bytes: bytes.byteLength,
          created: new Date().toISOString()
        }))
    },
    listOptics: async () => {
      const out: DcnOpticsIndexEntry[] = []
      for (const [path, content] of opticsFiles) {
        const c = content as { switch_id?: string; source_csv?: string | null; imported_at?: string | null; optics?: unknown[] }
        out.push({
          switch_id: c.switch_id ?? path.split('/').pop()!.replace(/\.yaml$/, ''),
          source_csv: c.source_csv ?? null,
          imported_at: c.imported_at ?? null,
          optic_count: Array.isArray(c.optics) ? c.optics.length : 0
        })
      }
      out.sort((a, b) => a.switch_id.localeCompare(b.switch_id))
      return out
    },
    deleteOptics: async (_w, switchId) => {
      opticsFiles.delete(opticsPathFor(switchId))
    }
  }

  Object.defineProperty(window, 'dcn', { value: mock, writable: false, configurable: false })
  // eslint-disable-next-line no-console
  console.info('[dev] installed mock window.dcn for browser preview')
}
