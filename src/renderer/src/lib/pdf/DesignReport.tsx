import { Document, Page, View, Text, Svg, Rect, Line, type DocumentProps } from '@react-pdf/renderer'
import type { ReactElement } from 'react'
import type { DesignResult, OpticsBomScenario, SolverWarning } from '@domain'
import { DEFAULT_SWITCH_POWER_W } from '@domain'
import type { RequirementsFile } from '@/schemas/project'
import type { CableLink } from '@/schemas/cable-links'
import type { Switch } from '@/schemas/switches'
import type { TopologyGraph } from '@/lib/topology-extractor'
import { buildCableBom, unresolvedLabel, type CableBom } from '@/lib/cable-bom'
import { buildDeviceBom, type DeviceBom } from '@/lib/device-bom'
import { findCandidate } from '@/lib/design-projection'
import { layoutTopologyForPdf, type PdfTopologyLayout } from './topology-svg'
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

const MEDIA_LABEL: Record<string, string> = {
  dac: 'DAC (copper)',
  aoc: 'AOC',
  fiber: 'Fiber'
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
        <Def label="IPN routers" value={fmt(committed?.total_ipn_routers ?? 0)} />
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

function BomPage({
  projectName,
  design,
  deviceBom,
  cableBom,
  cableTrayM
}: {
  projectName: string
  design: DesignResult
  deviceBom: DeviceBom
  cableBom: CableBom
  cableTrayM: number | null
}): ReactElement {
  return (
    <Page size="LETTER" style={styles.page}>
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
        <Text style={styles.h3}>Optics</Text>
        {design.optics_bom.length === 0 ? (
          <Empty>No optics required — no breakout pair is in effect for this design.</Empty>
        ) : (
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
        )}
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
              <Text style={[styles.th, { flex: 1.2 }]}>Media</Text>
              <Text style={[styles.th, { flex: 1 }, styles.right]}>Speed</Text>
              <Text style={[styles.th, { flex: 3 }]}>Optic</Text>
              <Text style={[styles.th, { flex: 1 }, styles.right]}>Qty</Text>
              <Text style={[styles.th, { flex: 1.4 }, styles.right]}>Total m</Text>
            </View>
            {cableBom.rows.map((r) => (
              <View style={styles.tr} key={`${r.ordered_length_m}-${r.speed_g}-${r.optic_id ?? ''}`}>
                <Text style={[styles.td, { flex: 1.2 }, styles.right]}>{r.ordered_length_m} m</Text>
                <Text style={[styles.td, { flex: 1.2 }]}>{MEDIA_LABEL[r.media] ?? r.media}</Text>
                <Text style={[styles.td, { flex: 1 }, styles.right]}>{fmt(r.speed_g)}G</Text>
                <Text style={[styles.td, { flex: 3 }]}>{t(r.optic_id)}</Text>
                <Text style={[styles.td, { flex: 1 }, styles.right]}>{fmt(r.count)}</Text>
                <Text style={[styles.td, { flex: 1.4 }, styles.right]}>
                  {fmt(r.total_ordered_m)}
                </Text>
              </View>
            ))}
            <View style={styles.trTotal}>
              <Text style={[styles.tdBold, { flex: 7.4 }]}>Total</Text>
              <Text style={[styles.tdBold, { flex: 1 }, styles.right]}>
                {fmt(cableBom.costed_links)}
              </Text>
              <Text style={[styles.tdBold, { flex: 1.4 }, styles.right]}>
                {fmt(cableBom.total_ordered_m)}
              </Text>
            </View>
          </View>
        )}
        <Text style={styles.note}>
          {cableTrayM != null
            ? `Derived from a ${fmt(cableTrayM)} m cable tray run plus 3 m of rise at each end, rounded up to the next standard cable size. Same-rack links are costed at 3 m.`
            : 'Same-rack links are costed at 3 m. Set Cable Tray (m) in Requirements to cost cross-rack runs.'}
          {cableBom.user_specified_links > 0
            ? ` ${cableBom.user_specified_links} link(s) use a length entered by hand instead.`
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
  server: COLORS.muted
}

function RackDiagram({ rack }: { rack: DesignResult['rack_layout'][number] }): ReactElement {
  const height = rack.size_u * U_H
  return (
    <View style={styles.rackCell}>
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

const MAX_RACKS_DRAWN = 12

function RackPage({
  projectName,
  design
}: {
  projectName: string
  design: DesignResult
}): ReactElement {
  const drawn = design.rack_layout.slice(0, MAX_RACKS_DRAWN)
  const omitted = design.rack_layout.length - drawn.length

  return (
    <Page size="LETTER" style={styles.page}>
      <Text style={styles.h2}>Rack layout</Text>
      {design.rack_layout.length === 0 ? (
        <Empty>No rack inventory defined — the solver placed devices without racks.</Empty>
      ) : (
        <>
          <View style={styles.legend}>
            {(['spine', 'ipn', 'leaf', 'server'] as const).map((role) => (
              <View style={styles.legendItem} key={role}>
                <View style={[styles.legendSwatch, { backgroundColor: ROLE_COLOR[role] }]} />
                <Text style={styles.legendLabel}>{role}</Text>
              </View>
            ))}
          </View>
          <View style={[styles.rackRow, { marginTop: 8 }]}>
            {drawn.map((rack) => (
              <RackDiagram rack={rack} key={rack.rack_name} />
            ))}
          </View>
          {omitted > 0 ? (
            <Text style={styles.note}>
              {omitted} further rack(s) not drawn. See the Rack View in the app for the full layout.
            </Text>
          ) : null}
          <View style={styles.table}>
            <View style={styles.trHead}>
              <Text style={[styles.th, { flex: 2 }]}>Rack</Text>
              <Text style={[styles.th, { flex: 1 }, styles.right]}>Size</Text>
              <Text style={[styles.th, { flex: 1 }, styles.right]}>Devices</Text>
              <Text style={[styles.th, { flex: 1.4 }, styles.right]}>Power (W)</Text>
              <Text style={[styles.th, { flex: 1.4 }, styles.right]}>PDU budget</Text>
            </View>
            {design.rack_layout.map((r) => (
              <View style={styles.tr} key={r.rack_name}>
                <Text style={[styles.td, { flex: 2 }]}>{t(r.rack_name)}</Text>
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
const TOPO_MAX_H = 612 - PAGE_MARGIN * 2 - 48

function TopologyPage({
  projectName,
  layout
}: {
  projectName: string
  layout: PdfTopologyLayout
}): ReactElement {
  // viewBox does the scaling: the layout is computed at natural size and the
  // Svg box shrinks it to fit the page if the fabric is tall.
  const scale = layout.height > TOPO_MAX_H ? TOPO_MAX_H / layout.height : 1
  const drawH = Math.max(layout.height * scale, 1)
  const drawW = layout.width * scale

  return (
    <Page size="LETTER" orientation="landscape" style={styles.page}>
      <Text style={styles.h2}>Topology</Text>
      {layout.nodes.length === 0 ? (
        <Empty>No topology to draw — generate a design first.</Empty>
      ) : (
        <>
          <Svg width={drawW} height={drawH} viewBox={`0 0 ${layout.width} ${layout.height}`}>
            {layout.pods.map((p) => (
              <Rect
                key={`pod-${p.pod_index}`}
                x={p.x}
                y={p.y}
                width={p.w}
                height={p.h}
                fill="none"
                stroke={COLORS.rule}
                strokeWidth={0.8}
              />
            ))}
            {layout.edges.map((e) => (
              <Line
                key={e.id}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                stroke={COLORS.faint}
                strokeWidth={0.3}
              />
            ))}
            {layout.nodes.map((n) => (
              <Rect
                key={n.id}
                x={n.x}
                y={n.y}
                width={n.w}
                height={n.h}
                fill={ROLE_COLOR[n.role] ?? COLORS.muted}
                stroke="none"
              />
            ))}
          </Svg>
          <View style={styles.legend}>
            {(['spine', 'ipn', 'leaf'] as const).map((role) => (
              <View style={styles.legendItem} key={role}>
                <View style={[styles.legendSwatch, { backgroundColor: ROLE_COLOR[role] }]} />
                <Text style={styles.legendLabel}>
                  {role} ({layout.counts[role]})
                </Text>
              </View>
            ))}
          </View>
          {layout.edges_omitted ? (
            <Text style={styles.note}>
              {layout.edges_omitted.links} cable links ({layout.edges_omitted.pairs} device pairs)
              are not drawn — at this fabric size the wiring obscures the diagram. See the Links
              view or the exported CSV for the full port map.
            </Text>
          ) : (
            <Text style={styles.note}>
              Lines are device-to-device; each stands for one or more port-level cable links.
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
  generatedAt
}: DesignReportInput): ReactElement<DocumentProps> {
  const deviceBom = buildDeviceBom(design, switches)
  const cableBom = buildCableBom({ links, cable_tray_m: requirements.cable_tray_m })
  const topoLayout = layoutTopologyForPdf(topology, { width: TOPO_W })
  const projectName = requirements.project.name

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
        cableTrayM={requirements.cable_tray_m}
      />
      <RackPage projectName={projectName} design={design} />
      <TopologyPage projectName={projectName} layout={topoLayout} />
      <NotesPage projectName={projectName} design={design} />
    </Document>
  )
}
