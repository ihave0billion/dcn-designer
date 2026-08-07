import { describe, it, expect } from 'vitest'
import { pdf } from '@react-pdf/renderer'
import { DesignReport, type DesignReportInput } from './DesignReport'
import { exportFileName } from './render'
import type { DesignResult, RackPlacement } from '@domain'
import type { RequirementsFile } from '@/schemas/project'
import type { CableLink } from '@/schemas/cable-links'
import type { Switch } from '@/schemas/switches'
import type { TopologyGraph } from '@/lib/topology-extractor'

// End-to-end smoke test for the PDF pipeline. Rendering real bytes is the only
// honest check that the document is *valid* — a JSX-shape assertion would pass
// happily on a react-pdf primitive that throws at layout time (an unsupported
// style, a Text outside a View, an Svg child that isn't an Svg element).

const GENERATED_AT = '2026-08-06T12:00:00.000Z'

const SWITCHES = [
  { id: 'N9K-C9364D-GX2A', ru: 2, power_w: 1500 },
  { id: 'N9K-C93600CD-GX', ru: 1, power_w: 650 }
] as unknown as Switch[]

function rack(name: string, devices: RackPlacement['devices']): RackPlacement {
  return {
    rack_name: name,
    size_u: 44,
    pdu_kw_budget: 8,
    estimated_power_w: 4300,
    devices,
    over_budget: false
  }
}

const DESIGN: DesignResult = {
  schema_version: 1,
  summary: {
    total_leaves: 4,
    total_spines: 2,
    total_servers: 0,
    spines_no_breakout: 2,
    spines_with_breakout: 2,
    total_host_bw_g: 12800,
    total_uplink_bw_g: 6400,
    computed_oversub_ratio: 2,
    computed_oversub_label: '2.00:1',
    valid: true,
    breakout_required_to_be_valid: false
  },
  tiers: [
    {
      speed_tier_label: '100G',
      leaf_model_id: 'N9K-C93600CD-GX',
      endpoint_count_input: 128,
      switch_count_input: null,
      leaves_required: 4,
      endpoints_supported: 128,
      host_ports_per_leaf: 32,
      host_speed_g: 100,
      effective_uplink_ports: 4,
      effective_uplink_speed_g: 400,
      effective_uplink_choice: 'primary',
      override_uplink_speed_applied_g: null,
      host_bw_g: 12800,
      uplink_bw_g: 6400,
      xor_status: 'ok'
    }
  ],
  spine: {
    spine_model_id: 'N9K-C9364D-GX2A',
    spine_ports: 64,
    spine_speed_g: 400,
    total_leaves: 4,
    total_leaf_uplinks: 16,
    spines_capacity: 1,
    spines_touching: 2,
    spines_port_count: 1,
    spines_needed: 2,
    required_uplinks_per_leaf: 4,
    spine_touching_divisible: true
  },
  breakout: {
    applicable: true,
    fanout: 4,
    spines_with_breakout: 2,
    uplinks_per_leaf_with_breakout: 4,
    reduces_spine_count: false,
    flips_to_valid: false,
    recommended_pair: {
      spine_pid: 'QDD-4X100G-SR4-S',
      leaf_pid: 'QSFP-100G-SR4-S'
    } as never,
    patch_panel_needed: true
  },
  optics_bom: [
    { optic_id: 'QDD-4X100G-SR4-S', count: 128, scenario: 'S3', location: 'spine', notes: 'Breakout 1×→4×' },
    { optic_id: 'QSFP-100G-SR4-S', count: 16, scenario: 'S3', location: 'leaf', notes: null }
  ],
  rack_layout: [
    rack('Rack A', [
      { device_id: 'spine-1', model_id: 'N9K-C9364D-GX2A', role: 'spine', start_u: 44, ru: 2, label: 'spine-1' },
      { device_id: 'spine-2', model_id: 'N9K-C9364D-GX2A', role: 'spine', start_u: 42, ru: 2, label: 'spine-2' },
      { device_id: 'leaf-1', model_id: 'N9K-C93600CD-GX', role: 'leaf', start_u: 40, ru: 1, label: 'leaf-1' },
      { device_id: 'leaf-2', model_id: 'N9K-C93600CD-GX', role: 'leaf', start_u: 39, ru: 1, label: 'leaf-2' }
    ]),
    rack('Rack B', [
      { device_id: 'leaf-3', model_id: 'N9K-C93600CD-GX', role: 'leaf', start_u: 44, ru: 1, label: 'leaf-3' },
      { device_id: 'leaf-4', model_id: 'N9K-C93600CD-GX', role: 'leaf', start_u: 43, ru: 1, label: 'leaf-4' }
    ])
  ],
  warnings: [
    { code: 'BREAKOUT_PATCH_PANEL_NEEDED', severity: 'warn', message: 'Breakout requires a patch panel at the break point.' },
    { code: 'BREAKOUT_RECOMMENDED', severity: 'info', message: 'Breakout reduces the required spine count.' }
  ],
  candidates: [
    {
      id: 'single_no_breakout',
      pod_variant: 'single',
      breakout_variant: 'no_breakout',
      valid: true,
      spine: null,
      breakout: null,
      multipod: null,
      rack_layout: [],
      optics_bom: [],
      warnings: [],
      total_spines: 2,
      total_ipn_routers: 0,
      total_host_bw_g: 12800,
      total_uplink_bw_g: 6400,
      computed_oversub_ratio: 2,
      computed_oversub_label: '2.00:1'
    },
    {
      id: 'multi_no_breakout',
      pod_variant: 'multi',
      breakout_variant: 'no_breakout',
      valid: false,
      spine: null,
      breakout: null,
      multipod: null,
      rack_layout: [],
      optics_bom: [],
      warnings: [
        { code: 'IPN_MODEL_NOT_SELECTED', severity: 'error', message: 'No IPN router in the library.' }
      ],
      total_spines: 4,
      total_ipn_routers: 0,
      total_host_bw_g: 12800,
      total_uplink_bw_g: 6400,
      computed_oversub_ratio: 2,
      computed_oversub_label: '2.00:1'
    }
  ],
  primary_candidate_id: 'single_no_breakout',
  committed_candidate_id: 'single_no_breakout'
}

const REQUIREMENTS: RequirementsFile = {
  schema_version: 1,
  project: {
    name: 'Acme DC Refresh',
    customer: 'Acme Corp',
    site: 'Dallas DC2',
    created: '2026-08-01T00:00:00.000Z',
    last_edited: GENERATED_AT
  },
  current_network: {
    topology: '3-tier',
    deployment_type: 'brownfield',
    existing_endpoints: 120,
    existing_racks: 6,
    notes: ''
  },
  use_case: 'dcn',
  input_mode: 'aggregate',
  tiers: [
    {
      speed_tier_label: '100G',
      endpoint_count: 128,
      switch_count: null,
      leaf_model_id: 'N9K-C93600CD-GX',
      override_uplink_speed_g: null
    }
  ],
  fabric: {
    uplinks_per_leaf: 4,
    uplinks_per_spine: 2,
    spine_model_id: 'N9K-C9364D-GX2A',
    aci_multipod_allowed: true,
    ipn_router_model_id: null
  },
  constraints: {
    aci_capable_required: true,
    rocev2_required: false,
    license_tier: 'advantage',
    cooling: 'Front-to-back',
    notes: 'Phased cutover over two weekends.'
  },
  racks: [],
  cable_tray_m: 10,
  target_oversub_informational: 3
}

function link(id: string, target: string, rackB: string | null): CableLink {
  return {
    id,
    device_a: { rack: 'Rack A', device_id: 'spine-1', port: 'Eth1/1' },
    device_b: { rack: rackB, device_id: target, port: 'Eth1/49' },
    speed_g: 400,
    optic_id: 'QSFP-100G-SR4-S',
    patch_panel_id: null,
    label: '',
    length_m: null,
    notes: null
  }
}

const LINKS: CableLink[] = [
  link('link-0001', 'leaf-1', 'Rack A'),
  link('link-0002', 'leaf-2', 'Rack A'),
  link('link-0003', 'leaf-3', 'Rack B'),
  link('link-0004', 'leaf-4', 'Rack B')
]

const TOPOLOGY: TopologyGraph = {
  nodes: [
    { id: 'spine-1', role: 'spine', model_id: 'N9K-C9364D-GX2A', rack: 'Rack A', label: 'spine-1', ru: 2, power_w: 1500, pod_index: null, usedPorts: ['Eth1/1'] },
    { id: 'spine-2', role: 'spine', model_id: 'N9K-C9364D-GX2A', rack: 'Rack A', label: 'spine-2', ru: 2, power_w: 1500, pod_index: null, usedPorts: [] },
    { id: 'leaf-1', role: 'leaf', model_id: 'N9K-C93600CD-GX', rack: 'Rack A', label: 'leaf-1', ru: 1, power_w: 650, pod_index: null, usedPorts: ['Eth1/49'] },
    { id: 'leaf-2', role: 'leaf', model_id: 'N9K-C93600CD-GX', rack: 'Rack A', label: 'leaf-2', ru: 1, power_w: 650, pod_index: null, usedPorts: ['Eth1/49'] },
    { id: 'leaf-3', role: 'leaf', model_id: 'N9K-C93600CD-GX', rack: 'Rack B', label: 'leaf-3', ru: 1, power_w: 650, pod_index: null, usedPorts: ['Eth1/49'] },
    { id: 'leaf-4', role: 'leaf', model_id: 'N9K-C93600CD-GX', rack: 'Rack B', label: 'leaf-4', ru: 1, power_w: 650, pod_index: null, usedPorts: ['Eth1/49'] }
  ],
  edges: LINKS.map((l) => ({
    id: l.id,
    source: l.device_a.device_id,
    sourcePort: l.device_a.port,
    target: l.device_b.device_id,
    targetPort: l.device_b.port,
    speed_g: l.speed_g,
    optic_id: l.optic_id,
    patch_panel_id: l.patch_panel_id,
    label: l.label,
    length_m: l.length_m
  })),
  orphanDeviceIds: []
}

const INPUT: DesignReportInput = {
  requirements: REQUIREMENTS,
  design: DESIGN,
  links: LINKS,
  switches: SWITCHES,
  topology: TOPOLOGY,
  generatedAt: GENERATED_AT
}

async function renderToBuffer(input: DesignReportInput): Promise<Buffer> {
  const instance = pdf(DesignReport(input))
  const stream = await instance.toBuffer()
  const chunks: Buffer[] = []
  for await (const chunk of stream as unknown as AsyncIterable<Buffer>) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

describe('DesignReport', () => {
  it('renders a structurally valid PDF', async () => {
    const buf = await renderToBuffer(INPUT)

    // A PDF must open with %PDF- and close with the EOF marker; a truncated or
    // half-rendered document fails one of these.
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buf.subarray(-1024).toString('latin1')).toContain('%%EOF')
    expect(buf.byteLength).toBeGreaterThan(3000)
  }, 30_000)

  it('emits all six pages', async () => {
    const buf = await renderToBuffer(INPUT)
    const text = buf.toString('latin1')
    const pageCount = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length
    expect(pageCount).toBe(6)
  }, 30_000)

  it('renders an empty design without throwing', async () => {
    // The Export button is reachable before Generate Design has ever run, so
    // every section has to survive a design with nothing in it.
    const empty: DesignReportInput = {
      ...INPUT,
      design: {
        ...DESIGN,
        tiers: [],
        spine: null,
        breakout: null,
        optics_bom: [],
        rack_layout: [],
        warnings: [],
        candidates: []
      },
      links: [],
      topology: { nodes: [], edges: [], orphanDeviceIds: [] }
    }
    const buf = await renderToBuffer(empty)
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  }, 30_000)

  it('renders a large multi-pod fabric without throwing', async () => {
    const leaves = Array.from({ length: 111 }, (_, i) => ({
      id: `leaf-${i + 1}`,
      role: 'leaf' as const,
      model_id: 'N9K-C93600CD-GX',
      rack: `Rack ${i % 4}`,
      label: `leaf-${i + 1}`,
      ru: 1,
      power_w: 650,
      pod_index: i % 2,
      usedPorts: []
    }))
    const spines = Array.from({ length: 8 }, (_, i) => ({
      id: `spine-${i + 1}`,
      role: 'spine' as const,
      model_id: 'N9K-C9364D-GX2A',
      rack: 'Rack A',
      label: `spine-${i + 1}`,
      ru: 2,
      power_w: 1500,
      pod_index: i % 2,
      usedPorts: []
    }))
    const big: DesignReportInput = {
      ...INPUT,
      topology: {
        nodes: [
          { id: 'ipn-1', role: 'ipn', model_id: 'N9K-C9332D-GX2B', rack: 'Rack A', label: 'ipn-1', ru: 1, power_w: 900, pod_index: null, usedPorts: [] },
          ...spines,
          ...leaves
        ],
        edges: [],
        orphanDeviceIds: []
      }
    }
    const buf = await renderToBuffer(big)
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  }, 30_000)
})

describe('exportFileName', () => {
  it('slugifies the project name and stamps the date', () => {
    expect(exportFileName('Acme DC Refresh', GENERATED_AT)).toBe('acme-dc-refresh-2026-08-06.pdf')
  })

  it('collapses punctuation and trims stray separators', () => {
    expect(exportFileName('  Acme // DC (v2)!  ', GENERATED_AT)).toBe('acme-dc-v2-2026-08-06.pdf')
  })

  it('falls back to a generic name when nothing survives slugification', () => {
    expect(exportFileName('!!!', GENERATED_AT)).toBe('design-2026-08-06.pdf')
  })
})
