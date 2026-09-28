import { Document, Page, View, Text, Image, Svg, Rect, Line, Path, Ellipse, type DocumentProps } from '@react-pdf/renderer'
import type { ReactElement } from 'react'
import type { DesignResult, OpticsBomScenario, SolverWarning } from '@domain'
import { DEFAULT_SWITCH_POWER_W, ndSpecFor } from '@domain'
import type { RequirementsFile } from '@/schemas/project'
import { FABRIC_MODE_LABEL } from '@/schemas/project'
import type { CableLink } from '@/schemas/cable-links'
import type { Switch } from '@/schemas/switches'
import type { TopologyGraph } from '@/lib/topology-extractor'
import { buildCableBom, cableKindLabel, cableMediaLabel, unresolvedLabel, type CableBom } from '@/lib/cable-bom'
import type { ServerInfoResolver } from '@/lib/server-symbols'
import { buildDeviceBom, type DeviceBom } from '@/lib/device-bom'
import { buildOpticsBom, opticSideLabel, type OpticsBom } from '@/lib/optics-bom'
import { findCandidate } from '@/lib/design-projection'
import { endpointTotals } from '@/lib/endpoint-totals'
import type { TopologyLayoutFile } from '@/schemas/topology-layout'
import { buildPdfScenePages, type PdfScenePage } from './topology-scene'
import { bundleGeometry, bundlePath } from '@/lib/port-channel-symbol'
import type { PanelImages } from './panel-images'
import { COLORS, PAGE_MARGIN, styles } from './styles'
import { pdfText } from './text'

// Phase 9 — the exported design report.
//
// Section order is fixed by PROJECT_PLAN: Cover → Requirements → Design
// summary → BOM → Rack layouts → Topology → Optics scenario notes →
// Warnings. Everything it draws comes from data already on disk
// (requirements.yaml, design.yaml, cable_links.yaml) plus the switch
// library — the report never recomputes the design, so what prints is
// exactly what the app shows.

export interface DesignReportInput {
  requirements: RequirementsFile
  design: DesignResult
  links: CableLink[]
  switches: Switch[]
  topology: TopologyGraph
  /** Phase 13 — the Topology tab's saved drag positions (null = auto layout). */
  topologyLayout?: TopologyLayoutFile | null
  /** Phase 13 — model_id → rasterised front panel / product photo for the topology page. */
  panelImages?: PanelImages
  /** Phase 14 — draw the Topology tab's server symbols (topology_layout.yaml show_servers). */
  showServers?: boolean
  serverInfo?: ServerInfoResolver
  /** ISO timestamp, passed in rather than read from the clock so the
   *  document is a pure function of its input (and testable). */
  generatedAt: string
}

const USE_CASE_LABEL: Record<string, string> = {
  dcn: 'Data Center Networking',
  ai: 'AI / ML',
  hpc: 'HPC',
  storage: 'Storage'
}

const CANDIDATE_LABEL: Record<string, string> = {
  single_no_breakout: 'Single-pod, no breakout',
  single_with_breakout: 'Single-pod, with breakout',
  multi_no_breakout: 'Multi-pod, no breakout',
  multi_with_breakout: 'Multi-pod, with breakout'
}

const SCENARIO_NOTE: Record<OpticsBomScenario, string> = {
  S1: 'Spine and leaf run at the same speed — a straight optic pair on both ends, no breakout.',
  S2: 'Direct speed step-down (e.g. 400G spine ↔ 100G leaf) using a verified non-breakout pair. Rare; only one such pair is carried in the library.',
  S3: 'Breakout: one spine port fans out to several leaf ports. Needs the matched spine/leaf PIDs below, and usually a patch panel at the break.'
}


function fmt(n: number | null | undefined, unit = ''): string {
  if (n == null) return '—'
  const rounded = Math.round(n * 100) / 100
  return `${rounded.toLocaleString('en-US')}${unit}`
}

/** Free text from user data or solver output, made safe for Helvetica. */
function t(value: string | null | undefined): string {
  return value == null ? '—' : pdfText(value) || '—'
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// ── Small building blocks ───────────────────────────────────────────

function Def({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <View style={styles.defCell}>
      <Text style={styles.defLabel}>{label}</Text>
      <Text style={styles.defValue}>{value}</Text>
    </View>
  )
}

function Footer({ projectName }: { projectName: string }): ReactElement {
  return (
    <View style={styles.footer} fixed>
      <Text>{t(projectName)}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  )
}

function Empty({ children }: { children: string }): ReactElement {
  return <Text style={styles.empty}>{children}</Text>
}

// ── Cover + requirements ────────────────────────────────────────────

function CoverPage({
  requirements: req,
  design,
  generatedAt
}: {
  requirements: RequirementsFile
  design: DesignResult
  generatedAt: string
}): ReactElement {
  const { project } = req
  const tiers = req.tiers.filter((t) => t.endpoint_count != null || t.switch_count != null)
  const committed = findCandidate(design, design.committed_candidate_id)

  return (
    <Page size="LETTER" style={styles.page}>
      <View>
        <Text style={styles.coverTitle}>{t(project.name)}</Text>
        {project.customer ? <Text style={styles.coverCustomer}>{t(project.customer)}</Text> : null}
        <Text style={styles.coverMeta}>
          {t([project.site, `Generated ${fmtDate(generatedAt)}`].filter(Boolean).join(' · '))}
        </Text>
        <View style={styles.coverRule} />
      </View>

      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>
          {design.summary.valid ? 'Design is valid' : 'Design has blocking errors'}
        </Text>
        <Text style={styles.bannerBody}>
          {committed ? CANDIDATE_LABEL[committed.id] ?? committed.id : 'No committed candidate'}
          {' · '}
          {fmt(design.summary.total_spines)} spines, {fmt(design.summary.total_leaves)} leaves
          {' · '}oversubscription {design.summary.computed_oversub_label}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.h2}>Requirements</Text>
        <View style={styles.defGrid}>
          <Def label="Use case" value={USE_CASE_LABEL[req.use_case] ?? req.use_case} />
          <Def label="Input mode" value={req.input_mode === 'aggregate' ? 'Aggregate' : 'Per leaf'} />
          <Def label="Deployment" value={req.current_network.deployment_type} />
          <Def label="Existing topology" value={t(req.current_network.topology)} />
          <Def label="Uplinks per leaf" value={fmt(req.fabric.uplinks_per_leaf)} />
          <Def label="Uplinks per spine" value={fmt(req.fabric.uplinks_per_spine)} />
          <Def label="Spine model" value={t(req.fabric.spine_model_id) || 'Auto'} />
          <Def label="IPN router" value={t(req.fabric.ipn_router_model_id) || 'Library default'} />
          <Def label="ACI capable" value={req.constraints.aci_capable_required ? 'Required' : 'Not required'} />
          <Def label="RoCEv2" value={req.constraints.rocev2_required ? 'Required' : 'Not required'} />
          <Def label="License tier" value={req.constraints.license_tier ?? '—'} />
          <Def label="Multi-pod allowed" value={req.fabric.aci_multipod_allowed ? 'Yes' : 'No'} />
          <Def label="Fabric mode" value={FABRIC_MODE_LABEL[req.fabric.mode] ?? req.fabric.mode} />
          <Def
            label="vPC peer-link"
            value={
              design.vpc
                ? design.vpc.peer_link
                  ? `${design.vpc.members} × per pair${design.vpc.port_channel ? ' (port-channel)' : ''}; ${design.vpc.pairs.length} pair${design.vpc.pairs.length === 1 ? '' : 's'}${design.vpc.unpaired.length ? `, ${design.vpc.unpaired.length} unpaired` : ''}`
                  : `None (${design.vpc.pairs.length} logical pair${design.vpc.pairs.length === 1 ? '' : 's'})`
                : '—'
            }
          />
          <Def label="Cable tray" value={req.cable_tray_m != null ? `${fmt(req.cable_tray_m)} m` : 'Not set'} />
          <Def label="Racks defined" value={fmt(req.racks.length)} />
          <Def
            label="Target oversub"
            value={
              req.target_oversub_informational != null
                ? `${fmt(req.target_oversub_informational)}:1 (informational)`
                : '—'
            }
          />
          <Def label="Cooling" value={t(req.constraints.cooling)} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.h3}>Port requirements</Text>
        {tiers.length === 0 ? (
          <Empty>No tiers defined.</Empty>
        ) : (
          <View style={styles.table}>
            <View style={styles.trHead}>
              <Text style={[styles.th, { flex: 2 }]}>Speed tier</Text>
              <Text style={[styles.th, { flex: 2 }]}>Leaf model</Text>
              <Text style={[styles.th, { flex: 1 }, styles.right]}>Endpoints</Text>
              <Text style={[styles.th, { flex: 1 }, styles.right]}>Switches</Text>
              <Text style={[styles.th, { flex: 1 }, styles.right]}>Uplink override</Text>
            </View>
            {tiers.map((row, i) => (
              <View style={styles.tr} key={`${row.speed_tier_label}-${i}`}>
                <Text style={[styles.td, { flex: 2 }]}>{t(row.speed_tier_label)}</Text>
                <Text style={[styles.td, { flex: 2 }]}>{t(row.leaf_model_id) || 'Auto'}</Text>
                <Text style={[styles.td, { flex: 1 }, styles.right]}>{fmt(row.endpoint_count)}</Text>
                <Text style={[styles.td, { flex: 1 }, styles.right]}>{fmt(row.switch_count)}</Text>
                <Text style={[styles.td, { flex: 1 }, styles.right]}>
                  {row.override_uplink_speed_g != null ? `${row.override_uplink_speed_g}G` : '—'}
                </Text>
              </View>
            ))}
          </View>
        )}
        {req.constraints.notes ? (
          <Text style={styles.note}>Notes: {t(req.constraints.notes)}</Text>
        ) : null}
      </View>

      <Footer projectName={project.name} />
    </Page>
  )
}

// ── Design summary ──────────────────────────────────────────────────

function DesignSummaryPage({
  requirements: req,
  design
}: {
  requirements: RequirementsFile
  design: DesignResult
}): ReactElement {
  const s = design.summary
  const committed = findCandidate(design, design.committed_candidate_id)
  const mp = committed?.multipod ?? null
  const endpoints = endpointTotals(design)

  return (
    <Page size="LETTER" style={styles.page}>
      <Text style={styles.h2}>Design summary</Text>

      <View style={styles.defGrid}>
        <Def label="Committed design" value={committed ? CANDIDATE_LABEL[committed.id] ?? committed.id : '—'} />
        <Def
          label="Auto-recommended"
          value={CANDIDATE_LABEL[design.primary_candidate_id] ?? design.primary_candidate_id}
        />
        <Def label="Valid" value={s.valid ? 'Yes' : 'No'} />
        <Def label="Oversubscription" value={s.computed_oversub_label} />
        <Def label="Total spines" value={fmt(s.total_spines)} />
        <Def label="Total leaves" value={fmt(s.total_leaves)} />
        <Def
          label="Endpoints supported"
          value={
            endpoints.requested > 0
              ? `${fmt(endpoints.supported)} (${fmt(endpoints.requested)} requested)`
              : fmt(endpoints.supported)
          }
        />
        <Def label="IPN routers" value={fmt(committed?.total_ipn_routers ?? 0)} />
        {design.nexus_dashboard ? (
          <Def
            label="Nexus Dashboard"
            value={`${t(design.nexus_dashboard.cluster_model_id)} (${fmt(design.nexus_dashboard.node_count)} × ${t(design.nexus_dashboard.node_model_id)})`}
          />
        ) : null}
        <Def label="Host bandwidth" value={`${fmt(s.total_host_bw_g)} G`} />
        <Def label="Uplink bandwidth" value={`${fmt(s.total_uplink_bw_g)} G`} />
        {design.spine ? (
          <>
            <Def label="Spine model" value={t(design.spine.spine_model_id)} />
            <Def label="Spine ports" value={fmt(design.spine.spine_ports)} />
            <Def label="Spine speed" value={`${fmt(design.spine.spine_speed_g)} G`} />
            <Def label="Leaf uplinks total" value={fmt(design.spine.total_leaf_uplinks)} />
            <Def
              label="Required uplinks/leaf"
              value={`${fmt(design.spine.required_uplinks_per_leaf)} (configured ${fmt(req.fabric.uplinks_per_leaf)})`}
            />
          </>
        ) : null}
        {mp ? (
          <>
            <Def label="Pods" value={fmt(mp.pods_needed)} />
            <Def label="Leaves per pod" value={mp.leaves_per_pod.join(' / ')} />
            <Def label="Spines per pod" value={fmt(mp.spines_per_pod)} />
            <Def label="Spine↔IPN links" value={fmt(mp.spine_to_ipn_links)} />
          </>
        ) : null}
      </View>

      {design.breakout?.applicable ? (
        <View style={styles.section}>
          <Text style={styles.h3}>Breakout analysis (S3)</Text>
          <View style={styles.defGrid}>
            <Def label="Fanout" value={`1 × ${design.breakout.fanout}`} />
            <Def label="Spines with breakout" value={fmt(design.breakout.spines_with_breakout)} />
            <Def
              label="Uplinks/leaf with breakout"
              value={fmt(design.breakout.uplinks_per_leaf_with_breakout)}
            />
            <Def label="Patch panel needed" value={design.breakout.patch_panel_needed ? 'Yes' : 'No'} />
            <Def label="Spine PID" value={t(design.breakout.recommended_pair?.spine_pid)} />
            <Def label="Leaf PID" value={t(design.breakout.recommended_pair?.leaf_pid)} />
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.h3}>Tiers</Text>
        {design.tiers.length === 0 ? (
          <Empty>No tiers were solved.</Empty>
        ) : (
          <View style={styles.table}>
            <View style={styles.trHead}>
              <Text style={[styles.th, { flex: 2 }]}>Tier</Text>
              <Text style={[styles.th, { flex: 2.4 }]}>Leaf model</Text>
              <Text style={[styles.th, { flex: 1 }, styles.right]}>Leaves</Text>
              <Text style={[styles.th, { flex: 1.2 }, styles.right]}>Endpoints</Text>
              <Text style={[styles.th, { flex: 1.2 }, styles.right]}>Host BW</Text>
              <Text style={[styles.th, { flex: 1.2 }, styles.right]}>Uplink BW</Text>
            </View>
            {design.tiers.map((row, i) => (
              <View style={styles.tr} key={`${row.speed_tier_label}-${i}`}>
                <Text style={[styles.td, { flex: 2 }]}>{t(row.speed_tier_label)}</Text>
                <Text style={[styles.td, { flex: 2.4 }]}>{t(row.leaf_model_id)}</Text>
                <Text style={[styles.td, { flex: 1 }, styles.right]}>{fmt(row.leaves_required)}</Text>
                <Text style={[styles.td, { flex: 1.2 }, styles.right]}>
                  {fmt(row.endpoints_supported)}
                </Text>
                <Text style={[styles.td, { flex: 1.2 }, styles.right]}>{fmt(row.host_bw_g)} G</Text>
                <Text style={[styles.td, { flex: 1.2 }, styles.right]}>{fmt(row.uplink_bw_g)} G</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.h3}>Candidate matrix</Text>
        <View style={styles.table}>
          <View style={styles.trHead}>
            <Text style={[styles.th, { flex: 3 }]}>Candidate</Text>
            <Text style={[styles.th, { flex: 1 }]}>Verdict</Text>
            <Text style={[styles.th, { flex: 1 }, styles.right]}>Spines</Text>
            <Text style={[styles.th, { flex: 1 }, styles.right]}>IPN</Text>
            <Text style={[styles.th, { flex: 1.2 }, styles.right]}>Oversub</Text>
            <Text style={[styles.th, { flex: 3 }]}>Blocker</Text>
          </View>
          {design.candidates.map((c) => {
            const blocker = c.warnings.find((w) => w.severity === 'error')
            const isCommitted = c.id === design.committed_candidate_id
            return (
              <View style={styles.tr} key={c.id}>
                <Text style={[isCommitted ? styles.tdBold : styles.td, { flex: 3 }]}>
                  {CANDIDATE_LABEL[c.id] ?? c.id}
                  {isCommitted ? '  (committed)' : ''}
                  {c.id === design.primary_candidate_id && !isCommitted ? '  (recommended)' : ''}
                </Text>
                <Text
                  style={[styles.td, { flex: 1, color: c.valid ? COLORS.ok : COLORS.error }]}
                >
                  {c.valid ? 'Valid' : 'Invalid'}
                </Text>
                <Text style={[styles.td, { flex: 1 }, styles.right]}>{fmt(c.total_spines)}</Text>
                <Text style={[styles.td, { flex: 1 }, styles.right]}>
                  {fmt(c.total_ipn_routers)}
                </Text>
                <Text style={[styles.td, { flex: 1.2 }, styles.right]}>
                  {c.computed_oversub_label}
                </Text>
                <Text style={[styles.td, { flex: 3 }]}>{blocker ? blocker.code : '—'}</Text>
              </View>
            )
          })}
        </View>
      </View>

      <Footer projectName={req.project.name} />
    </Page>
  )
}

// ── BOM ─────────────────────────────────────────────────────────────

// Phase 16 — also the whole of the standalone BOM export (BomReport.tsx):
// `standalone` adds the title block a one-page document needs.
export function BomPage({
  projectName,
  design,
  deviceBom,
  cableBom,
  opticsBom,
  cableTrayM,
  standalone
}: {
  projectName: string
  design: DesignResult
  deviceBom: DeviceBom
  cableBom: CableBom
  opticsBom: OpticsBom
  cableTrayM: number | null
  standalone?: { requirements: RequirementsFile; generatedAt: string }
}): ReactElement {
  return (
    <Page size="LETTER" style={styles.page}>
      {standalone ? (
        <View style={{ marginBottom: 14 }}>
          <Text style={[styles.coverTitle, { fontSize: 18 }]}>{t(standalone.requirements.project.name)}</Text>
          {standalone.requirements.project.customer || standalone.requirements.project.site ? (
            <Text style={[styles.coverCustomer, { fontSize: 10 }]}>
              {[standalone.requirements.project.customer, standalone.requirements.project.site]
                .filter(Boolean)
                .map((s) => t(s))
                .join(' · ')}
            </Text>
          ) : null}
          <Text style={styles.coverMeta}>
            Bill of materials · generated {fmtDate(standalone.generatedAt)} ·{' '}
            {CANDIDATE_LABEL[design.committed_candidate_id] ?? design.committed_candidate_id} ·{' '}
            {fmt(design.summary.total_spines)} spines, {fmt(design.summary.total_leaves)} leaves ·{' '}
            {design.summary.valid ? 'design valid' : 'design NOT valid'}
          </Text>
        </View>
      ) : null}
      <Text style={styles.h2}>Bill of materials</Text>

      <View style={styles.section}>
        <Text style={styles.h3}>Switches</Text>
        {deviceBom.rows.length === 0 ? (
          <Empty>No devices placed.</Empty>
        ) : (
          <View style={styles.table}>
            <View style={styles.trHead}>
              <Text style={[styles.th, { flex: 1 }]}>Role</Text>
              <Text style={[styles.th, { flex: 3 }]}>Model</Text>
              <Text style={[styles.th, { flex: 1 }, styles.right]}>Qty</Text>
              <Text style={[styles.th, { flex: 1 }, styles.right]}>RU each</Text>
              <Text style={[styles.th, { flex: 1 }, styles.right]}>RU total</Text>
              <Text style={[styles.th, { flex: 1.4 }, styles.right]}>Power (W)</Text>
            </View>
            {deviceBom.rows.map((r) => (
              <View style={styles.tr} key={`${r.role}-${r.model_id}`}>
                <Text style={[styles.td, { flex: 1 }]}>{r.role}</Text>
                <Text style={[styles.td, { flex: 3 }]}>
                  {t(r.model_id)}
                  {r.unknown_model ? ' *' : ''}
                </Text>
                <Text style={[styles.td, { flex: 1 }, styles.right]}>{fmt(r.count)}</Text>
                <Text style={[styles.td, { flex: 1 }, styles.right]}>{fmt(r.ru_each)}</Text>
                <Text style={[styles.td, { flex: 1 }, styles.right]}>{fmt(r.ru_total)}</Text>
                <Text style={[styles.td, { flex: 1.4 }, styles.right]}>
                  {fmt(r.power_w_total)}
                  {r.power_estimated ? ' †' : ''}
                </Text>
              </View>
            ))}
            <View style={styles.trTotal}>
              <Text style={[styles.tdBold, { flex: 4 }]}>Total</Text>
              <Text style={[styles.tdBold, { flex: 1 }, styles.right]}>
                {fmt(deviceBom.total_devices)}
              </Text>
              <Text style={[styles.tdBold, { flex: 1 }, styles.right]} />
              <Text style={[styles.tdBold, { flex: 1 }, styles.right]}>
                {fmt(deviceBom.total_ru)}
              </Text>
              <Text style={[styles.tdBold, { flex: 1.4 }, styles.right]}>
                {fmt(deviceBom.total_power_w)}
              </Text>
            </View>
          </View>
        )}
        {deviceBom.nd_cluster ? (
          <Text style={styles.note}>
            Nexus Dashboard: the {fmt(deviceBom.nd_cluster.node_count)} × {t(deviceBom.nd_cluster.node_model_id)} nodes are ordered as one{' '}
            {t(deviceBom.nd_cluster.cluster_model_id)} cluster PID
            {design.nexus_dashboard?.mgmt_leaf_ids
              ? '; management links land on the OOB tier.'
              : '; management links go to an OOB network outside this design.'}
          </Text>
        ) : null}
        {deviceBom.has_unknown_models ? (
          <Text style={styles.note}>
            * Model not found in the switch library — power is excluded from the total.
          </Text>
        ) : null}
        {deviceBom.has_estimated_power ? (
          <Text style={[styles.note, { color: COLORS.warn }]}>
            † Estimated at {DEFAULT_SWITCH_POWER_W} W per device — the switch library carries no
            power figure for {deviceBom.total_devices - deviceBom.power_known_devices} of{' '}
            {deviceBom.total_devices} devices. This is the same estimate the rack layout uses. Add
            power_w to the library for datasheet figures.
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.h3}>Optics (transceivers)</Text>
        {opticsBom.total_ends === 0 ? (
          <Empty>No cable links yet — seed them from the Links tab to count transceivers.</Empty>
        ) : opticsBom.rows.length === 0 ? (
          <Empty>Every cable end is DAC or AOC — no separate transceivers to order.</Empty>
        ) : (
          <View style={styles.table}>
            <View style={styles.trHead}>
              <Text style={[styles.th, { flex: 1.6 }]}>Side</Text>
              <Text style={[styles.th, { flex: 2.2 }]}>Switch model</Text>
              <Text style={[styles.th, { flex: 0.9 }, styles.right]}>Speed</Text>
              <Text style={[styles.th, { flex: 1.8 }]}>Media</Text>
              <Text style={[styles.th, { flex: 2.6 }]}>Optic PID</Text>
              <Text style={[styles.th, { flex: 0.9 }, styles.right]}>Qty</Text>
            </View>
            {opticsBom.rows.map((r, i) => (
              <View style={styles.tr} key={`${r.side}-${r.kind}-${r.model_id ?? ''}-${r.speed_g}-${r.media}-${r.optic_id ?? ''}-${i}`}>
                <Text style={[styles.td, { flex: 1.6 }]}>{opticSideLabel(r)}</Text>
                <Text style={[styles.td, { flex: 2.2 }]}>{t(r.model_id)}</Text>
                <Text style={[styles.td, { flex: 0.9 }, styles.right]}>{fmt(r.speed_g)}G</Text>
                <Text style={[styles.td, { flex: 1.8 }]}>{cableMediaLabel(r.media)}</Text>
                <Text style={[styles.td, { flex: 2.6 }, r.optic_id ? {} : { color: COLORS.warn }]}>
                  {r.optic_id ?? `not set${r.optic_hint ? ` (${pdfText(r.optic_hint)})` : ''}`}
                </Text>
                <Text style={[styles.td, { flex: 0.9 }, styles.right]}>{fmt(r.count)}</Text>
              </View>
            ))}
            <View style={styles.trTotal}>
              <Text style={[styles.tdBold, { flex: 9.1 }]}>
                Total transceivers — spine {fmt(opticsBom.by_side.spine)} · leaf {fmt(opticsBom.by_side.leaf)}
                {opticsBom.by_side.peer_link > 0 ? ` · peer-link ${fmt(opticsBom.by_side.peer_link)}` : ''}
                {opticsBom.by_side.other > 0 ? ` · other ${fmt(opticsBom.by_side.other)}` : ''}
              </Text>
              <Text style={[styles.tdBold, { flex: 0.9 }, styles.right]}>{fmt(opticsBom.total_transceivers)}</Text>
            </View>
          </View>
        )}
        <Text style={styles.note}>
          One transceiver per fiber cable end; a breakout spine port counts once. DAC / AOC ends are cable-integrated
          {opticsBom.integrated_ends > 0 ? ` (${fmt(opticsBom.integrated_ends)} such ends here)` : ''}.
        </Text>
        {opticsBom.ends_without_pid > 0 ? (
          <Text style={[styles.note, { color: COLORS.warn }]}>
            {fmt(opticsBom.ends_without_pid)} of {fmt(opticsBom.total_transceivers)} transceivers have no optic PID yet — pick one per
            link on the Links tab (Edit, Optic field) or import a CSV with the optic_id column. The form factor in brackets is the switch
            library's hint.
          </Text>
        ) : null}
        {design.optics_bom.length > 0 ? (
          <>
            <Text style={[styles.h3, { marginTop: 10 }]}>Solver breakout estimate</Text>
            <View style={styles.table}>
              <View style={styles.trHead}>
                <Text style={[styles.th, { flex: 3 }]}>Optic PID</Text>
                <Text style={[styles.th, { flex: 1 }]}>Scenario</Text>
                <Text style={[styles.th, { flex: 1 }]}>Location</Text>
                <Text style={[styles.th, { flex: 1 }, styles.right]}>Qty</Text>
                <Text style={[styles.th, { flex: 2 }]}>Notes</Text>
              </View>
              {design.optics_bom.map((o, i) => (
                <View style={styles.tr} key={`${o.optic_id}-${o.location}-${i}`}>
                  <Text style={[styles.td, { flex: 3 }]}>{t(o.optic_id)}</Text>
                  <Text style={[styles.td, { flex: 1 }]}>{o.scenario}</Text>
                  <Text style={[styles.td, { flex: 1 }]}>{o.location}</Text>
                  <Text style={[styles.td, { flex: 1 }, styles.right]}>{fmt(o.count)}</Text>
                  <Text style={[styles.td, { flex: 2 }]}>{t(o.notes)}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.h3}>Cables</Text>
        {cableBom.rows.length === 0 ? (
          <Empty>
            No cable lengths could be costed. Seed or import cable links, then set Cable Tray (m).
          </Empty>
        ) : (
          <View style={styles.table}>
            <View style={styles.trHead}>
              <Text style={[styles.th, { flex: 1.2 }, styles.right]}>Length</Text>
              <Text style={[styles.th, { flex: 1.6 }]}>Kind</Text>
              <Text style={[styles.th, { flex: 2 }]}>Media</Text>
              <Text style={[styles.th, { flex: 1 }, styles.right]}>Speed</Text>
              <Text style={[styles.th, { flex: 1.6 }]}>Optic</Text>
              <Text style={[styles.th, { flex: 1 }, styles.right]}>Qty</Text>
              <Text style={[styles.th, { flex: 1.4 }, styles.right]}>Total m</Text>
            </View>
            {cableBom.rows.map((r) => (
              <View style={styles.tr} key={`${r.ordered_length_m ?? 'x'}-${r.kind}-${r.speed_g}-${r.media}-${r.optic_id ?? ''}`}>
                <Text style={[styles.td, { flex: 1.2 }, styles.right, r.ordered_length_m == null ? { color: COLORS.warn } : {}]}>
                  {r.ordered_length_m != null ? `${r.ordered_length_m} m` : 'not costed'}
                </Text>
                <Text style={[styles.td, { flex: 1.6 }]}>{cableKindLabel(r.kind)}</Text>
                <Text style={[styles.td, { flex: 2 }]}>{cableMediaLabel(r.media)}</Text>
                <Text style={[styles.td, { flex: 1 }, styles.right]}>{fmt(r.speed_g)}G</Text>
                <Text style={[styles.td, { flex: 1.6 }]}>{t(r.optic_id)}</Text>
                <Text style={[styles.td, { flex: 1 }, styles.right]}>{fmt(r.count)}</Text>
                <Text style={[styles.td, { flex: 1.4 }, styles.right]}>
                  {r.ordered_length_m != null ? fmt(r.total_ordered_m) : '—'}
                </Text>
              </View>
            ))}
            <View style={styles.trTotal}>
              <Text style={[styles.tdBold, { flex: 7.4 }]}>
                Total ({fmt(cableBom.costed_links)} of {fmt(cableBom.total_links)} costed)
              </Text>
              <Text style={[styles.tdBold, { flex: 1 }, styles.right]}>
                {fmt(cableBom.total_links)}
              </Text>
              <Text style={[styles.tdBold, { flex: 1.4 }, styles.right]}>
                {fmt(cableBom.total_ordered_m)}
              </Text>
            </View>
          </View>
        )}
        <Text style={styles.note}>
          Media: {cableMediaLabel(cableBom.default_media)} unless a link says otherwise (Requirements / Cables / Default cable media, or per link on the Links tab).{' '}
          {cableTrayM != null
            ? `Lengths derived from a ${fmt(cableTrayM)} m cable tray run plus 3 m of rise at each end, rounded up to the next standard cable size. Same-rack links are costed at 3 m.`
            : 'Same-rack links are costed at 3 m. Set Cable Tray (m) in Requirements to cost cross-rack runs.'}
          {cableBom.user_specified_links > 0
            ? ` ${cableBom.user_specified_links} link(s) use a length entered by hand instead.`
            : ''}
          {cableBom.peer_link_links > 0
            ? ` ${cableBom.peer_link_links} of the cables are vPC peer-links (leaf to leaf, two optic ends each).`
            : ''}
        </Text>
        {cableBom.unresolved.map((u) => (
          <Text style={[styles.note, { color: COLORS.warn }]} key={u.reason}>
            {unresolvedLabel(u)}
          </Text>
        ))}
      </View>

      <Footer projectName={projectName} />
    </Page>
  )
}

// ── Rack layouts ────────────────────────────────────────────────────

const RACK_W = 118
const U_H = 5.4
const ROLE_COLOR: Record<string, string> = {
  spine: COLORS.spine,
  leaf: COLORS.leaf,
  ipn: COLORS.ipn,
  server: COLORS.muted,
  nd: COLORS.nd,
  oob: COLORS.oob
}
// Phase 17 — Nexus Dashboard bracket / link colour on the topology page.
const ND_COLOR = COLORS.nd

function RackDiagram({ rack }: { rack: DesignResult['rack_layout'][number] }): ReactElement {
  const height = rack.size_u * U_H
  return (
    <View style={styles.rackCell} wrap={false}>
      <Text style={styles.rackName}>{t(rack.rack_name)}</Text>
      <Text style={styles.rackMeta}>
        {rack.size_u}U · {fmt(rack.estimated_power_w)} W
        {rack.pdu_kw_budget != null ? ` / ${fmt(rack.pdu_kw_budget * 1000)} W budget` : ''}
        {rack.over_budget ? ' · OVER' : ''}
      </Text>
      <Svg width={RACK_W} height={height}>
        {/* U-slot grid, drawn top-down: U(size) at the top, U1 at the bottom. */}
        {Array.from({ length: rack.size_u }, (_, i) => (
          <Line
            key={`u-${i}`}
            x1={0}
            y1={i * U_H}
            x2={RACK_W}
            y2={i * U_H}
            strokeWidth={0.25}
            stroke={COLORS.rule}
          />
        ))}
        <Rect
          x={0}
          y={0}
          width={RACK_W}
          height={height}
          strokeWidth={0.6}
          stroke={COLORS.muted}
          fill="none"
        />
        {rack.devices.map((d) => {
          // start_u is the device's TOP U (the solver packs downward), so the
          // rect's top edge is measured from the top of the rack.
          const y = (rack.size_u - d.start_u) * U_H
          return (
            <Rect
              key={d.device_id}
              x={1}
              y={y}
              width={RACK_W - 2}
              height={Math.max(U_H * d.ru - 0.8, 1.6)}
              fill={ROLE_COLOR[d.role] ?? COLORS.muted}
              stroke="none"
            />
          )
        })}
      </Svg>
    </View>
  )
}

const MAX_RACKS_DRAWN = 40

function RackPage({
  projectName,
  design,
  racksPerRow
}: {
  projectName: string
  design: DesignResult
  racksPerRow: number | null
}): ReactElement {
  const drawn = design.rack_layout.slice(0, MAX_RACKS_DRAWN)
  const omitted = design.rack_layout.length - drawn.length
  // Phase 16 — physical rows: caption each group of `racksPerRow` racks.
  const groups: Array<{ caption: string | null; racks: typeof drawn }> = []
  if (racksPerRow && racksPerRow > 0) {
    for (let i = 0; i < drawn.length; i += racksPerRow) {
      groups.push({ caption: `Row ${groups.length + 1}`, racks: drawn.slice(i, i + racksPerRow) })
    }
  } else {
    groups.push({ caption: null, racks: drawn })
  }

  return (
    <Page size="LETTER" style={styles.page}>
      <Text style={styles.h2}>Rack layout</Text>
      {design.rack_layout.length === 0 ? (
        <Empty>No rack inventory defined — the solver placed devices without racks.</Empty>
      ) : (
        <>
          <View style={styles.legend}>
            {(['spine', 'ipn', 'leaf', 'server', 'nd'] as const)
              .filter((role) => role !== 'nd' || design.rack_layout.some((r) => r.devices.some((d) => d.role === 'nd')))
              .map((role) => (
                <View style={styles.legendItem} key={role}>
                  <View style={[styles.legendSwatch, { backgroundColor: ROLE_COLOR[role] }]} />
                  <Text style={styles.legendLabel}>{role === 'nd' ? 'Nexus Dashboard node' : role}</Text>
                </View>
              ))}
          </View>
          {groups.map((g, gi) => (
            <View key={gi}>
              {g.caption ? (
                <Text style={styles.h3}>
                  {g.caption} — {t(g.racks[0].rack_name)}
                  {g.racks.length > 1 ? ` to ${t(g.racks[g.racks.length - 1].rack_name)}` : ''}
                </Text>
              ) : null}
              <View style={[styles.rackRow, { marginTop: g.caption ? 2 : 8 }]}>
                {g.racks.map((rack) => (
                  <RackDiagram rack={rack} key={rack.rack_name} />
                ))}
              </View>
            </View>
          ))}
          {omitted > 0 ? (
            <Text style={styles.note}>
              {omitted} further rack(s) not drawn. See the Rack View in the app for the full layout.
            </Text>
          ) : null}
          <View style={styles.table} wrap={false}>
            <View style={styles.trHead}>
              <Text style={[styles.th, { flex: 2 }]}>Rack</Text>
              <Text style={[styles.th, { flex: 1 }]}>Row</Text>
              <Text style={[styles.th, { flex: 1 }, styles.right]}>Size</Text>
              <Text style={[styles.th, { flex: 1 }, styles.right]}>Devices</Text>
              <Text style={[styles.th, { flex: 1.4 }, styles.right]}>Power (W)</Text>
              <Text style={[styles.th, { flex: 1.4 }, styles.right]}>PDU budget</Text>
            </View>
            {design.rack_layout.map((r, i) => (
              <View style={styles.tr} key={r.rack_name}>
                <Text style={[styles.td, { flex: 2 }]}>{t(r.rack_name)}</Text>
                <Text style={[styles.td, { flex: 1 }]}>
                  {racksPerRow && racksPerRow > 0 ? `Row ${Math.floor(i / racksPerRow) + 1}` : '—'}
                </Text>
                <Text style={[styles.td, { flex: 1 }, styles.right]}>{r.size_u}U</Text>
                <Text style={[styles.td, { flex: 1 }, styles.right]}>{r.devices.length}</Text>
                <Text
                  style={[
                    styles.td,
                    { flex: 1.4, color: r.over_budget ? COLORS.error : COLORS.text },
                    styles.right
                  ]}
                >
                  {fmt(r.estimated_power_w)}
                </Text>
                <Text style={[styles.td, { flex: 1.4 }, styles.right]}>
                  {r.pdu_kw_budget != null ? `${fmt(r.pdu_kw_budget)} kW` : '—'}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
      <Footer projectName={projectName} />
    </Page>
  )
}

// ── Topology ────────────────────────────────────────────────────────

// Landscape LETTER minus margins.
const TOPO_W = 792 - PAGE_MARGIN * 2
// Heading + subtitle above, legend (two rows at most) + note below.
const TOPO_CHROME_H = 128
const TOPO_MAX_H = 612 - PAGE_MARGIN * 2 - TOPO_CHROME_H
// v1.6.3 — the topology page keeps the shape of the expanded Topology tab
// (one leaf row, never re-wrapped). When Letter landscape would shrink a
// tile below this scale (124 px → ~50 pt, room for a 15-char hostname at
// 6.5 pt), the SHEET grows instead — a wide custom page, like a plotter
// sheet — so the drawing stays legible at the tab's own proportions.
const TOPO_MIN_SCALE = 0.4
// Tile width in scene px (lib/topology-hierarchy TILE_W) — for the label-legibility rule.
const PANEL_TILE_W = 124
// Phase 14 — the skill's peer-link red, shared with the Visio export.
const PEER_LINK_COLOR = '#B85450'

/**
 * Phase 15 — a vPC peer-link drawn as a port-channel: `count` straight
 * parallel member lines between the two leaf panels and the Cisco oval across
 * their middle (tall, centred on the bundle, no text). Sizes are in scene px (panels are 110 wide); the ring is an arc
 * path so no transform support is needed from the PDF renderer.
 */
function PeerLinkBundle({
  x1,
  y1,
  x2,
  y2,
  count,
  scale
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  count: number
  scale: number
}): ReactElement {
  // Sized in printed points (÷ scale → scene px) with a scene-px floor, so a
  // 32-leaf page shrunk to 1:6 still prints a legible glyph and a 4-leaf
  // page does not get a giant one.
  const pt = (v: number, floor: number): number => Math.max(floor, v / scale)
  const g = bundleGeometry({ x: x1, y: y1 }, { x: x2, y: y2 }, count, {
    gap: pt(1.4, 2.4),
    ringRx: pt(1.1, 2.6),
    ringPad: pt(1.6, 3)
  })
  const ang = (g.angleDeg * Math.PI) / 180
  const ux = Math.cos(ang)
  const uy = Math.sin(ang)
  const p1 = { x: g.mid.x - ux * g.rx, y: g.mid.y - uy * g.rx }
  const p2 = { x: g.mid.x + ux * g.rx, y: g.mid.y + uy * g.rx }
  const ring = `M ${p1.x} ${p1.y} A ${g.rx} ${g.ry} ${g.angleDeg} 1 0 ${p2.x} ${p2.y} A ${g.rx} ${g.ry} ${g.angleDeg} 1 0 ${p1.x} ${p1.y}`
  return (
    <>
      <Path d={bundlePath(g)} stroke={PEER_LINK_COLOR} strokeWidth={pt(0.5, 0.6)} fill="none" />
      <Path d={ring} stroke={PEER_LINK_COLOR} strokeWidth={pt(0.4, 0.5)} fill="none" />
    </>
  )
}

function TopologyPage({
  projectName,
  page
}: {
  projectName: string
  page: PdfScenePage | null
}): ReactElement {
  // Phase 13 — the Topology tab's device level, tile for tile (see
  // lib/pdf/topology-scene.ts). The scene is laid out in screen pixels and
  // scaled to the page; rasters (front.png of a stencil master, or a product
  // photo) are overlaid as absolutely positioned Images on top of the Svg.
  const fitScale = page ? Math.min(TOPO_W / page.width, TOPO_MAX_H / page.height, 1) : 1
  const scale = Math.max(fitScale, TOPO_MIN_SCALE)
  const drawW = page ? page.width * scale : 0
  const drawH = page ? page.height * scale : 0
  // Letter landscape unless the drawing needs more at the minimum scale
  // ([width, height] in pt — react-pdf would flip an array size under
  // orientation="landscape", so the sheet is given landscape already).
  const needW = Math.ceil(drawW + PAGE_MARGIN * 2)
  const needH = Math.ceil(drawH + PAGE_MARGIN * 2 + TOPO_CHROME_H)
  // A grown sheet is cut to the drawing (a wide strip, like the tab), not
  // left half blank under a Letter-height page.
  const sheet: [number, number] = needW > 792 ? [needW, Math.max(needH, 360)] : [792, Math.max(612, needH)]
  // Labels are drawn at a fixed point size; when a tile is narrower than the
  // shortest hostname we drop them rather than print a smear.
  const labelPt = 6.5
  const showLabels = !!page && PANEL_TILE_W * scale >= 26
  const fontPx = labelPt / scale

  return (
    <Page size={sheet} style={styles.page}>
      <Text style={styles.h2}>{page ? pdfText(page.title) : 'Topology'}</Text>
      {!page || page.nodes.length === 0 ? (
        <Empty>No topology to draw — generate a design first.</Empty>
      ) : (
        <>
          <Text style={styles.note}>{page.subtitle}</Text>
          <View style={{ position: 'relative', width: drawW, height: drawH, marginTop: 4 }}>
            <Svg
              width={drawW}
              height={drawH}
              viewBox={`0 0 ${page.width} ${page.height}`}
              style={{ position: 'absolute', left: 0, top: 0 }}
            >
              {page.pairs.map((p) => (
                <Rect
                  key={`pair-${p.id}`}
                  x={p.x}
                  y={p.y}
                  width={p.w}
                  height={p.h}
                  fill="none"
                  stroke={p.kind === 'nd' ? ND_COLOR : PEER_LINK_COLOR}
                  strokeWidth={Math.max(0.6, 0.6 / scale)}
                  strokeDasharray="3 2"
                />
              ))}
              {showLabels &&
                page.pairs
                  .filter((p) => p.kind === 'nd')
                  .map((p) => (
                    <Text
                      key={`pair-${p.id}-label`}
                      x={p.x + 3}
                      y={p.y - 2}
                      style={{ fontSize: fontPx * 0.85, fontFamily: 'Helvetica-Bold', fill: ND_COLOR }}
                    >
                      {pdfText(p.label)}
                    </Text>
                  ))}
              {page.edges.map((e) =>
                e.kind === 'vpc-peer-link' ? (
                  // Phase 15 — port-channel symbol: member cables as parallel
                  // lines with a ring around their middle (same helper as the
                  // screen and the Visio export).
                  <PeerLinkBundle key={e.id} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} count={e.count} scale={scale} />
                ) : (
                  <Line
                    key={e.id}
                    x1={e.x1}
                    y1={e.y1}
                    x2={e.x2}
                    y2={e.y2}
                    stroke={e.kind === 'nd-data' ? ND_COLOR : COLORS.faint}
                    strokeWidth={e.kind === 'server' || e.kind === 'nd-mgmt' ? Math.max(0.4, 0.35 / scale) : Math.max(0.6, 0.5 / scale)}
                    strokeDasharray={e.dashed ? '4 3' : undefined}
                  />
                )
              )}
              {page.nodes.map((n) =>
                n.image ? null : n.kind === 'cloud' ? (
                  // Phase 17 — the OOB-management network outside the design.
                  <Ellipse
                    key={n.id}
                    cx={n.x + n.w / 2}
                    cy={n.y + n.h / 2}
                    rx={n.w / 2}
                    ry={n.h / 2}
                    fill={ROLE_COLOR.oob}
                    stroke={COLORS.muted}
                    strokeWidth={Math.max(0.6, 0.6 / scale)}
                    strokeDasharray="3 2"
                  />
                ) : (
                  <Rect
                    key={n.id}
                    x={n.x}
                    y={n.y}
                    width={n.w}
                    height={n.h}
                    fill={n.kind === 'server' ? ROLE_COLOR.server : (ROLE_COLOR[n.role ?? ''] ?? COLORS.muted)}
                    stroke={COLORS.rule}
                    strokeWidth={0.5}
                  />
                )
              )}
              {showLabels &&
                page.nodes.map((n) => (
                  <Text
                    key={`${n.id}-label`}
                    x={n.labelX}
                    y={n.labelAbove ? n.labelY : n.labelY + fontPx}
                    textAnchor="middle"
                    style={{ fontSize: fontPx, fontFamily: 'Helvetica', fill: COLORS.text }}
                  >
                    {pdfText(n.label)}
                  </Text>
                ))}
            </Svg>
            {page.nodes.map((n) =>
              n.image ? (
                <Image
                  key={`${n.id}-img`}
                  src={n.image}
                  style={{
                    position: 'absolute',
                    left: n.x * scale,
                    top: n.y * scale,
                    width: n.w * scale,
                    height: n.h * scale
                  }}
                />
              ) : null
            )}
          </View>
          <View style={styles.legend}>
            {(['spine', 'ipn', 'leaf', 'server', 'nd', 'oob'] as const)
              .filter((role) => (role !== 'server' && role !== 'nd' && role !== 'oob') || page.counts[role] > 0)
              .map((role) => (
                <View style={styles.legendItem} key={role}>
                  <View style={[styles.legendSwatch, { backgroundColor: ROLE_COLOR[role] }]} />
                  <Text style={styles.legendLabel}>
                    {role === 'nd' ? 'Nexus Dashboard node' : role === 'oob' ? 'OOB management network (outside the design)' : role} ({page.counts[role]})
                  </Text>
                </View>
              ))}
            {page.counts.nd > 0 ? (
              <View style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: ND_COLOR }]} />
                <Text style={styles.legendLabel}>ND data link (fabric0/1, active-standby); dashed = ND management (mgmt0/1)</Text>
              </View>
            ) : null}
            {page.peerLinks > 0 ? (
              <View style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: PEER_LINK_COLOR }]} />
                <Text style={styles.legendLabel}>vPC peer-link — port-channel oval across the member cables ({page.peerLinks})</Text>
              </View>
            ) : null}
            {page.pairs.length > 0 ? (
              <View style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: 'white', borderWidth: 0.6, borderColor: PEER_LINK_COLOR, borderStyle: 'dashed' }]} />
                <Text style={styles.legendLabel}>vPC pair, no peer-link ({page.pairs.length})</Text>
              </View>
            ) : null}
          </View>
          {page.edgesOmitted ? (
            <Text style={styles.note}>
              {page.edgesOmitted.links} cable links ({page.edgesOmitted.pairs} device pairs) are not
              drawn — at this fabric size the wiring obscures the diagram. See the Links view, the
              exported CSV, or the Visio export for the full port map.
            </Text>
          ) : (
            <Text style={styles.note}>
              Lines are device-to-device; each stands for one or more port-level cable links.
              {showLabels ? '' : ' Hostnames omitted at this scale — see the Visio export.'}
            </Text>
          )}
        </>
      )}
      <Footer projectName={projectName} />
    </Page>
  )
}

// ── Optics notes + warnings ─────────────────────────────────────────

const SEVERITY_COLOR: Record<SolverWarning['severity'], string> = {
  error: COLORS.error,
  warn: COLORS.warn,
  info: COLORS.muted
}

function NotesPage({
  projectName,
  design
}: {
  projectName: string
  design: DesignResult
}): ReactElement {
  const scenarios = [...new Set(design.optics_bom.map((o) => o.scenario))].sort()
  const bySeverity: SolverWarning['severity'][] = ['error', 'warn', 'info']

  return (
    <Page size="LETTER" style={styles.page}>
      <View style={styles.section}>
        <Text style={styles.h2}>Optics scenario notes</Text>
        {scenarios.length === 0 ? (
          <Empty>
            No optics scenario applies — this design does not use a breakout pair, so leaf and
            spine optics are ordered to match the port speeds directly.
          </Empty>
        ) : (
          scenarios.map((s) => (
            <View style={{ marginBottom: 6 }} key={s}>
              <Text style={styles.h3}>{s}</Text>
              <Text style={styles.td}>{t(SCENARIO_NOTE[s])}</Text>
            </View>
          ))
        )}
        {design.breakout?.patch_panel_needed ? (
          <Text style={[styles.note, { color: COLORS.warn }]}>
            This design breaks out spine ports, so a patch panel is required at the break point.
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.h2}>Warnings</Text>
        {design.warnings.length === 0 ? (
          <Empty>No warnings — the solver raised nothing against this design.</Empty>
        ) : (
          bySeverity.map((sev) => {
            const items = design.warnings.filter((w) => w.severity === sev)
            if (items.length === 0) return null
            return (
              <View style={{ marginBottom: 8 }} key={sev}>
                {items.map((w, i) => (
                  <View style={styles.warnRow} key={`${w.code}-${i}`}>
                    <Text style={[styles.warnTag, { color: SEVERITY_COLOR[sev] }]}>{sev}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.warnBody}>{t(w.message)}</Text>
                      <Text style={styles.warnCode}>{w.code}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )
          })
        )}
      </View>

      <Footer projectName={projectName} />
    </Page>
  )
}

// ── Document ────────────────────────────────────────────────────────

export function DesignReport({
  requirements,
  design,
  links,
  switches,
  topology,
  topologyLayout,
  showServers,
  serverInfo,
  panelImages,
  generatedAt
}: DesignReportInput): ReactElement<DocumentProps> {
  const deviceBom = buildDeviceBom(design, switches)
  const cableBom = buildCableBom({ links, cable_tray_m: requirements.cable_tray_m, default_media: requirements.default_cable_media })
  const opticsBom = buildOpticsBom({ links, design, switches, default_media: requirements.default_cable_media })
  const projectName = requirements.project.name
  const ruById = new Map(switches.map((s) => [s.id, s.ru]))
  const topoPages = buildPdfScenePages(topology, projectName, topologyLayout ?? null, {
    showServers: showServers ?? topologyLayout?.show_servers ?? false,
    serverInfo,
    images: panelImages,
    ruOf: (id) => ruById.get(id) ?? ndSpecFor(id)?.ru ?? null
  })

  return (
    <Document
      title={`${projectName} — DCN design`}
      author="DCN Designer"
      subject={requirements.project.customer || undefined}
      creator="DCN Designer"
      producer="DCN Designer"
    >
      <CoverPage requirements={requirements} design={design} generatedAt={generatedAt} />
      <DesignSummaryPage requirements={requirements} design={design} />
      <BomPage
        projectName={projectName}
        design={design}
        deviceBom={deviceBom}
        cableBom={cableBom}
        opticsBom={opticsBom}
        cableTrayM={requirements.cable_tray_m}
      />
      <RackPage projectName={projectName} design={design} racksPerRow={requirements.racks_per_row ?? null} />
      {topoPages.length === 0 ? (
        <TopologyPage projectName={projectName} page={null} />
      ) : (
        topoPages.map((pg) => <TopologyPage key={pg.fabricId} projectName={projectName} page={pg} />)
      )}
      <NotesPage projectName={projectName} design={design} />
    </Document>
  )
}
