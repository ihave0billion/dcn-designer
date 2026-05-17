# DCN Designer — Project Plan

Successor GUI app to `DCN_Spine_Leaf_Calculator_v8.xlsx` + `DCN Network Requirements WIP.xlsx`. Replaces both spreadsheets, and adds rack layout + port-level wiring + CCW import features inspired by the Fabric Rack and Wiring Assistant.

This document is the **source of truth** for decisions, phases, and progress. Read it at the start of every session. Update it at the end of every session.

---

## Session protocol (read first)

This project is built across **multiple sessions** to avoid context rot. One phase per session, with handoff state captured here.

**At session start:**
1. Read [CLAUDE.md](CLAUDE.md), this file, and [JOURNAL.md](JOURNAL.md).
2. Find the first phase whose status is `pending` in the Phase Plan table below. That is this session's work.
3. Read only the sections of this doc relevant to that phase. Do not start any other phase.
4. Scan JOURNAL.md's **Open items** for anything that might affect this phase, and re-ask any that target "top of next session."

**At session end:**
1. Update the phase row's status (`done` / `partial` / `blocked`).
2. Append a row to the **Session Log** with: date, phase, what was done, what's next, any decisions deviating from this plan.
3. If decisions changed, update the relevant section here so future sessions read the current truth.
4. Update [JOURNAL.md](JOURNAL.md) — log any new errors and their fixes, capture any decisions parked for later in **Open items**, and move resolved items out of **Open items**.

**Session-start prompt template** (paste into a new Claude Code session in this folder):

```
Read CLAUDE.md, PROJECT_PLAN.md, and JOURNAL.md. Confirm the next
"pending" phase in the Phase Plan table. Scan JOURNAL.md's Open
Items for anything that affects this phase. Read only the sections
of PROJECT_PLAN.md relevant to that phase. Work it to its acceptance
criteria. At session end, update the phase status, append a Session
Log entry, and update JOURNAL.md (new errors, new open items, move
resolved items out). Do not start a second phase in this session.
```

---

## Decisions (locked)

| Area | Decision |
|---|---|
| Audience | Personal — Mac-only |
| Deliverable | In-app dashboard + PDF export (no spreadsheets) |
| Offline | Fully offline |
| Library | YAML structured data + linked source PDFs in `attachments/` |
| Use case | Single solver with `DCN / AI / HPC / Storage` selector |
| Port granularity | Both aggregate AND per-leaf; user picks mode pre-generate |
| Topology rendering | **react-flow** for in-app interactive view; **hand-rolled SVG** for PDF export |
| Stack | Electron + TypeScript + React + shadcn/ui + Tailwind |
| Project model | One workspace folder, many projects; splash screen on launch |
| Theme | Both light and dark with toggle |
| Library files | `switches.yaml`, `servers.yaml` (flat lists); `optics/<switch-id>.yaml` (one file per switch); CCW imports staged in `ccw_imports/` |
| Switch library source | `N9K.md` (the original .md file from which v8 `Hardware_Ref` was derived). One-time manual transcription into `seed/switches.yaml`; v8 spreadsheet is not consulted. |
| Optics library design | Per-switch: each switch has its own optics YAML populated from a Cisco TMG optics CSV upload (hundreds of optics per switch). At upload time, if a file already exists, app prompts: replace or keep existing. The solver uses these per-switch lists to narrow optic choices to those compatible with both ends of a link. |
| "Any updates?" prompt | When the user begins their workflow (timing TBD — likely at project open or as a banner on splash), the app prompts whether to add/edit switches in the library before starting. |
| Rack-aware solver | Yes — solver suggests rack layout; user can override or upload a rack mapping |
| Port names | Dropdown from library (each switch declares its port-naming convention; library tracks per-port utilization) |
| CCW Import (v1) | Cisco Commerce Workspace estimate exports — CSV / TSV / XML formats; Excel + PDF later |
| Cable Tray (m) | Drives cable length BOM (sums per-link distances, rounds to standard cable lengths) |
| PDU Budget (kW) | Validates per-rack — warn when est. power > budget; solver respects budget when suggesting placement |
| Rack default size | **44 RU** (industry standard data-center cabinet). Existing projects keep their stored size; only new projects + new racks default to 44 (Phase 5b polish, 2026-05-13). |
| Switch placement default | **Top-of-rack** — solver places spines at U(size_u), leaves immediately below; AddDeviceDialog defaults Start U to the top of the rack and stacks added devices downward (Phase 5b polish, 2026-05-13). |
| Multi-pod ACI | Solver computes a **2×2 candidate matrix** in parallel — `{single-pod, multi-pod} × {no-breakout, with-breakout}`. Each candidate carries its own port math, validity, and BOM. Auto-promotes the **simplest valid** candidate as primary (fewer pods first, then no-breakout if tied) and writes it to `design.yaml`; remaining viable candidates are surfaced as alternates in the Design view. User can override the primary via a "commit this candidate" toggle. Mirrors today's breakout-pass advisor pattern — the app verifies what works AND surfaces options the user might not have thought of. Trigger: ACI-mode + license tier permits multi-pod + at least one strategy is viable. (Decision 2026-05-13; Phase 2b solver + dedicated UI phase planned.) |
| IPN routers | New device role `'ipn'`. **Library source TBD in Phase 2b** — either extend `switches.yaml` role enum or ship a separate `ipn_routers.yaml`. Topology default: 2 IPN routers per site (HA), every spine connects to every IPN. |

---

## Workspace layout (on user's disk)

```
~/DCN-Designer/
├── library/
│   ├── switches.yaml
│   ├── servers.yaml
│   ├── optics/
│   │   └── <switch-id>.yaml        # one per switch, populated from TMG optics CSV upload
│   ├── attachments/
│   │   └── <model-id>/
│   │       └── data-sheet.pdf
│   └── ccw_imports/
│       └── <YYYYMMDD-HHmm>/
│           ├── source.csv          # original imported file
│           └── extracted.yaml      # parsed entries staged for promotion
├── projects/
│   └── <project-name>/
│       ├── requirements.yaml
│       ├── design.yaml             # generated solver output (incl. rack layout)
│       ├── rack_mapping.yaml       # optional user override; takes precedence over solver
│       ├── cable_links.yaml        # port-to-port wiring (manual or generated)
│       ├── topology.svg            # generated visual (PDF-export version)
│       └── exports/
│           └── <name>-<date>.pdf
└── settings.yaml                   # theme, last opened project, default workspace path
```

All YAML files carry a `schema_version` field from day one.

---

## Data model (abridged schemas)

### switches.yaml — list of switch records

- `id` (e.g. `N9K-C9364D-GX2A`), `model_display`, `vendor`
- `role`: `leaf | spine | both`
- `category` (`100G`, `400G`, `1G-PoE`, `25G-ToR`, …)
- `primary: {ports, speed_g, naming_template}` (e.g. `Eth1/{1..48}`)
- `uplink: {ports, speed_g, naming_template}` (nullable)
- `secondary_uplink: {ports, speed_g, naming_template}` (nullable)
- `ru`, `power_w`
- `optic_hint`
- `capabilities: {aci, nxos, rocev2, deep_buffer, smart_switch, ult_low_latency, poe}`
- `notes`
- `attachments: [<relative paths under attachments/<id>/>]`

### servers.yaml — list of server records

- `id` (e.g. `UCS-C845a-M8`), `model_display`, `vendor`
- `role`: `server`
- `ru`, `power_w`
- `ports`: list of `{count, speed_g, naming_template}` groups (mirrors how the colleague's tool lists `8 ports (10G / 200G / 400G)`)
- `gpu`: optional `{model, count}` (e.g. `Nvidia RTX 6000 Pro`)
- `notes`, `attachments`

### optics/&lt;switch-id&gt;.yaml — per-switch optics compatibility (one file per switch)

Populated by uploading a Cisco TMG-format optics CSV. Each switch has its own file because a single switch supports hundreds of optic SKUs across OS variants and breakout modes. The solver cross-references the two endpoints' optics files to narrow choices for any given link.

- `schema_version`
- `switch_id` (matches an `id` in `switches.yaml`)
- `source_csv` (filename of last imported CSV)
- `imported_at` (ISO timestamp)
- `optics`: list of optic records, each:
  - `id` (e.g. `QSFP-100G-SR4-S`)
  - `family` (e.g. `QSFP100`, `QSFPDD400`)
  - `form_factor` (`QSFP28`, `QSFP-DD`, `OSFP`, …)
  - `data_rate_g` (numeric, e.g. 100, 400)
  - `breakout_mode` (e.g. `4x100G`, or `null` for non-breakout)
  - `reach` (e.g. `100m`, `2km`, `10km`)
  - `media` (`MMF` / `SMF` / `Copper` / `AOC` / `DAC`)
  - `connector_type` (e.g. `LC (UPC)`, `MPO-12 (UPC)`)
  - `transceiver_type` (`Optic`, `DAC`, `AOC`)
  - `standard` (e.g. `IEEE 100GBASE-SR4`)
  - `case_temperature`
  - `dom_capable`
  - `eos` (end-of-sale flag)
  - `os_support`: list of `{os, min_release}` (e.g. `[{os: ACI, min_release: ACI-N9KDK9-15.2(5)}, {os: NX-OS, min_release: NX-OS 10.2(3) F}]`)
  - `notes`
  - `data_sheet_url`

**Re-import behavior:** on upload, if the target file already exists, app prompts "replace existing or keep current?" before overwriting.

### requirements.yaml — per project

- `project: {name, customer, site, created, last_edited}`
- `current_network: {topology, brownfield_or_greenfield, endpoints, racks, …}` (mirrors WIP `Sizing` tab)
- `use_case`: `dcn | ai | hpc | storage`
- `input_mode`: `aggregate | per_leaf`
- `port_requirements: [{speed_g, count}]` **xor** `switch_requirements: [{model_id, count}]` per row (v8 rule 8)
- `per_leaf_overrides`: optional per-leaf port maps when `input_mode == per_leaf`
- `fabric: {uplinks_per_leaf, uplinks_per_spine}`
- `target_oversub_informational` — display-only, **not** consumed by solver (v8 rule 9)
- `constraints: {aci_capable_required, license_tier, cooling, …}`
- `selected_models` per tier (or `auto`)
- `racks: [{name, size_u, pdu_kw_budget, location, tags}]` — user-defined rack inventory
- `cable_tray_m` — distance for cable-length BOM

### design.yaml — solver output (regenerable)

- `summary: {total_leaves, total_spines, total_servers, spines_no_breakout, spines_with_breakout, computed_oversub, valid, breakout_required_to_be_valid}`
- `tiers: [{speed_g, model_id, leaves, host_bw, uplink_bw, uplink_type}]`
- `optics_bom: [{optic_id, count, scenario (S1|S2|S3), location}]`
- `rack_layout: [{rack_id, devices: [{device_id, model_id, role, start_u, label}]}]`
- `topology: {spines: [...], leaves: [...], servers: [...]}` (consumed by react-flow renderer)
- `warnings`

### cable_links.yaml — per project

- `links: [{id, device_a: {rack, model_id, port}, device_b: {rack, model_id, port}, speed_g, optic_id, label, length_m}]`
- Either generated by solver (default layout) or built manually in the Cable Links UI.

### rack_mapping.yaml — optional user override

- `racks: [{name, devices: [{device_id, start_u}]}]`
- When present, takes precedence over solver's `design.yaml.rack_layout`.

---

## Solver

### Per-tier (leaf) computation

- **Aggregate mode:** `leaves = CEIL(endpoint_count / host_ports_per_leaf)`
- **Switch-count mode:** `leaves = switch_count`; `endpoints_supported = switch_count × non_uplink_ports`
- Host BW = `leaves × host_ports × host_speed`
- Uplink BW = `leaves × uplinks_per_leaf × MIN(uplink_speed, override_speed)`
- Uplink auto-pick (v8 rule 13): when a leaf has both primary and secondary uplinks, use whichever group has higher per-port speed; surface choice in "Uplink Type" column

### Spine count (three constraints, MAX, then HA floor)

- `spines_capacity = CEIL(total_uplink_BW / (spine_ports × spine_speed))`
- `spines_touching = uplinks_per_leaf / uplinks_per_spine` — INVALID if not evenly divisible
- `spines_port_count = CEIL(total_leaf_uplinks / spine_ports)`
- `spines_needed = MAX(2, spines_capacity, spines_touching, spines_port_count)` (v8 rule 7)

### Breakout pass

Recompute spine count assuming S3 (400G→4×100G breakout). Surface the breakout option whenever it reduces spine count or flips an invalid design to valid (v8 Dashboard "breakout-valid indicator").

### Use-case enforcement

`ai | hpc` → enforce 1:1 (`host_BW == uplink_BW`), filter candidates to `rocev2: true`, warn if user-picked model lacks `rocev2`.

### Rack placement (new)

After device counts are known, the solver assigns devices to racks with these heuristics:
- Spines distributed across separate racks for HA (no two spines in the same rack if more than one spine exists and rack inventory permits)
- Leaves grouped in "pod racks," paired (leaf-A + leaf-B) per pod
- Servers grouped under their pod's leaf pair
- Respect `pdu_kw_budget` per rack — never pack a rack past its kW limit
- If user supplied `rack_mapping.yaml`, skip placement and use the user's mapping verbatim (warn on any device the mapping doesn't cover)

### Optic compatibility filtering (new — depends on phase 1b)

For any given link (e.g. 400G spine to 100G leaf with 4x100G breakout), the solver intersects:

- The spine switch's `optics/<spine-id>.yaml` filtered by `data_rate_g`, `breakout_mode`, OS, and media class
- The leaf switch's `optics/<leaf-id>.yaml` filtered the same way
- The cross-product where the two optics are physically compatible (matching standard / wavelength / connector / reach)

The resulting list is what's offered in the Cable Links UI's "optic" dropdown. If the list is empty for a planned link, the design is flagged INVALID until the user uploads an optics CSV that covers the case or selects a different switch.

### Validation list

- XOR per row (port count vs. switch count)
- Uplinks/leaf ≤ available uplink ports on chosen model
- `uplinks_per_leaf` divisible by `uplinks_per_spine`
- Spines ≥ 2
- No nulls in design output (v8 rule 2 — DESIGN VALID by default)
- Optic compatibility: every link in `cable_links.yaml` must resolve to at least one optic from the intersection of the two switches' optics files (v8 rule 11 — "verify against current Cisco data sheet")
- Per-rack power ≤ PDU budget
- Per-leaf port utilization ≤ available ports (Cable Links manager enforces no double-booking)

### Multi-Pod ACI (planned — Phase 2b solver + Phase 9b UI)

ACI Multi-Pod is the Cisco architecture for horizontally scaling an ACI fabric beyond what a single pair of spines can support. Each pod is a self-contained spine-leaf fabric; pods share a common APIC controller cluster but are physically separate. The pods are stitched together by the **IPN (Inter-Pod Network)** — typically 2 IPN routers per site (HA), with every spine in every pod connecting to every IPN router via L3 BGP-EVPN.

**When the solver promotes to multi-pod:** ACI mode + at least one of the four candidate strategies requires it for validity (e.g. user picked 2× 64-port GX2A spines but tier sums to 111 leaves needing 444 uplinks — single-pod fails port-count, multi-pod with 4 spines split across 2 pods fits 56+55 leaves). Decision rule documented in the Decisions table; auto-promote the simplest valid candidate as primary, surface all viable alternates on the Design view.

**Candidate matrix.** The Phase 2 `DesignResult` becomes one of N candidates inside `DesignResult.candidates[]`:

| Candidate | Pods | Spines/pod | IPN routers | Breakout |
|---|---|---|---|---|
| `single_no_breakout` | 1 | sized by Phase 2 spine math | 0 | off |
| `single_with_breakout` | 1 | reduced by breakout fanout | 0 | on |
| `multi_no_breakout` | N (computed) | 2 (HA floor per pod) or more if pod-level math demands | 2 (HA) | off |
| `multi_with_breakout` | N (computed, usually fewer than `multi_no_breakout` for the same leaf count) | reduced by fanout per pod | 2 (HA) | on |

Each candidate has its own `valid: boolean`, `warnings: SolverWarning[]`, `summary` (totals across pods), and BOM impact (extra spines + IPN routers + spine↔IPN cabling).

**Pod sizing.** For multi-pod candidates: `max_leaves_per_pod = (spine_ports_per_pod × spines_per_pod) / uplinks_per_leaf`. `pods_needed = CEIL(total_leaves / max_leaves_per_pod)`. Leaves split across pods as evenly as possible (e.g. 111 leaves into 2 pods → 56+55).

**IPN port budget.** Each spine reserves some of its primary ports for IPN uplinks (typically 4–8 per spine, per Cisco DC reference designs). The solver subtracts these from each spine's available leaf-facing port count, recomputes pod sizing under the smaller budget. New warning `IPN_PORTS_INSUFFICIENT` fires when a spine model can't spare ports for both leaves AND IPN uplinks at the chosen counts.

**License gating.** ACI Multi-Pod requires Cisco "Premier" tier or higher (informational warning `MULTIPOD_LICENSE_BLOCKED` when `requirements.constraints.license_tier` is below that). Solver still computes the multi-pod candidates so the user can see the comparison; primary picker just won't pick a license-blocked candidate.

**Schema deltas (Phase 2b).**
- `requirements.yaml.fabric.aci_multipod_allowed: boolean` (default derived from `license_tier` — Premier+ true, else false)
- `design.yaml.candidates: DesignCandidate[]` — full per-candidate compute
- `design.yaml.primary_candidate_id: string` — solver-picked simplest valid
- `design.yaml.committed_candidate_id: string` — user override (defaults to primary)
- The "active" design used by Rack View / Links / Topology is the committed candidate's `summary` + `rack_layout`.

**IPN router library.** Open question for Phase 2b interview: extend `switches.yaml` `role` enum to include `'ipn'` (so IPNs sit in the same library as switches) vs. ship a separate `seed/ipn_routers.yaml` (cleaner conceptually since IPNs are L3 routers, not L2 switches). Curated list of qualifying Cisco models also TBD — typical candidates are Nexus 9300 with appropriate licensing or Nexus 7000/9500 with the right line cards. See JOURNAL Open Items for tracking.

**Regenerate-aware editing implication.** When the user commits a different candidate (e.g. flips from `single_with_breakout` to `multi_no_breakout`), `rack_layout` + `cable_links.yaml` + `topology_layout.yaml` all reference different device sets. The drift-detection pass already on the JOURNAL roadmap (across rack_mapping / cable_links / topology_layout) extends naturally — committed-candidate change is just another trigger that may invalidate fork files.

---

## UI map

### Splash screen (app launch)

- List of projects in workspace (most-recent first), each with name + last-edited + customer
- **Create New Project** button → new project wizard
- **Import Existing Design** button → file/folder picker; copies into `projects/` or opens in-place (asks)
- Settings gear → workspace path, theme

### Sidebar (workspace-scoped, shown after project is opened)

- **Home** (back to splash / project list)
- **Library** — Switches / Servers / Optics tabs; CCW Imports staging
- **Settings** — theme, default workspace, cable tray default

### Per project — top-tab navigation (matches the colleague's tool)

- **Rack View** — visual U-slot layout per rack, sidebar for rack settings (name, location, U-size, PDU budget, tags), Add Device modal
- **Topology View** — react-flow interactive node graph; per-port handles, edge routing for cables, click to select, drag to rearrange
- **Summary View** — design summary, device counts, BOM totals, power totals, oversub, validation status
- **Requirements** — multi-step form mirroring WIP `Sizing` / Application / Software / Growth sections
- **Design** — input-mode toggle (aggregate / per-leaf) → Generate Design button (regenerates `design.yaml`, `cable_links.yaml`, `rack_layout`)
- **Links** (manager modal) — table of cable links + New Link form (device A port ↔ device B port + speed + optic + label)
- **Export** — Generate PDF button, recent exports list

### Add Device modal (Rack View)

Tabs: **Switch** / **Server** / **CCW-Switch** / **CCW-Server** / **Blank Panels**
- Filterable list of devices from the relevant library file
- Fields: Label/Hostname, Start U, Quantity
- "CCW-*" tabs source from `library/ccw_imports/` staging area until promoted

### Cable Links manager

- Modal/drawer over Topology View
- Table of existing links + filter
- "New Link" form: select Device A (dropdown of devices in workspace) → port dropdown (from device's library entry, marks used ports); same for Device B; speed dropdown; optic dropdown (filtered by speed compatibility); auto-generated label
- Import from CSV option

---

## Topology rendering

**In-app (interactive):** `react-flow`. Custom node types for spine / leaf / server, each rendering per-port handles along its bottom/top edge. Edges are routed cables labeled with port pairs + speed. Pan/zoom/select/drag built-in. Custom auto-layout via `elkjs` (layered) for first render; manual positioning persisted in `design.yaml.topology.positions`.

**PDF export (read-only):** Hand-rolled SVG generated from the same `design.yaml.topology` data. Layered layout (spines top, leaves middle, servers bottom). No interactivity. Smaller, prints cleanly. This is the same approach we'd originally planned for the whole app — repurposed just for the PDF.

---

## PDF export

Library: **`@react-pdf/renderer`** for v1 — fully offline, embeds SVG natively. Electron's `webContents.printToPDF()` as a fallback.

Sections: Cover (project + customer + date) → Requirements summary → Design summary → BOM (switches + optics + cables with lengths from Cable Tray) → Rack layout diagrams → Topology SVG → Optics scenario notes → Warnings.

---

## CCW import (v1 scope)

Supported formats v1: **CSV / TSV / XML**. (Excel and PDF deferred to a later phase.)

Pipeline:
1. User picks a CCW estimate export file.
2. Parser maps rows to candidate `switches.yaml` / `servers.yaml` entries — best-effort field mapping by SKU pattern.
3. Parsed entries land in `library/ccw_imports/<timestamp>/extracted.yaml`. Original file preserved as `source.<ext>`.
4. User reviews in the CCW Imports staging UI and either promotes entries into the main library or discards.
5. In the Add Device modal, CCW-staged entries appear under the **CCW-Switch** / **CCW-Server** tabs with the import timestamp as the badge.

CSV/TSV schema is column-mapping-driven (user assigns column → field on first import; saved as preset per format).

---

## Tech stack

| Layer | Choice |
|---|---|
| Shell | Electron 33+ (current LTS) |
| Language | TypeScript 5.x |
| UI framework | React 19 |
| Styling | Tailwind 4 (fallback Tailwind 3.x if 4 unstable) |
| Components | shadcn/ui (Radix primitives, copy-paste) |
| Build | Vite (via `electron-vite`) |
| Topology canvas | `react-flow` (`@xyflow/react`) + `elkjs` for layered auto-layout |
| YAML | `yaml` npm package |
| YAML validation | `zod` |
| CSV/TSV | `papaparse` |
| XML | `fast-xml-parser` |
| PDF | `@react-pdf/renderer` |
| Tests | `vitest` (solver + parser unit tests) |
| Packaging | Electron Forge |

---

## Phase Plan

| # | Phase | Status | Deliverable | Acceptance |
|---|---|---|---|---|
| 0 | Scaffold | done | `electron-vite` project with React + TS + Tailwind + shadcn, theme toggle (light + dark) wired up, sidebar shell | App opens, theme toggle works, empty screen renders |
| 1 | Workspace + library (switches + servers) + splash | done | First-run workspace picker dialog (default `~/DCN-Designer/`); splash screen with project list + Create / Import / Settings; `seed/switches.yaml` (manual transcription from `N9K.md`) and `seed/servers.yaml` (small starter set) copied into workspace on first run; library CRUD UI for switches and servers; Optics tab stubbed with "coming in phase 1b" message | Create + open + import a project; YAML round-trips through `zod`; can add/edit/delete a switch and a server |
| 1b | Optics importer | done | CSV upload UI per switch under Library → Optics; Cisco TMG CSV parser → `library/optics/<switch-id>.yaml`; deduplication of OS-variant rows into `os_support` lists; re-import "replace or keep" prompt; Optics CRUD on top of the imported lists | Upload `N9K-C9364D-GX2A-OPTICS.csv` (268 rows) and see the parsed optics listed under that switch; re-uploading prompts to replace; can hand-edit an optic entry after import |
| 2 | Domain solver (no UI) | done | Pure-TS solver in `src/domain/`: per-tier math, spine count, breakout, AI/HPC 1:1, uplink auto-pick, rack placement heuristic | Unit tests cover all v8 hard-rule cases; v8 default inputs reproduce v8 outputs; rack placement respects PDU budget |
| 2b | Multi-Pod ACI solver | pending | Extend the Phase 2 domain to compute the 4-way candidate matrix `{single-pod, multi-pod} × {no-breakout, with-breakout}`. New types: `DesignCandidate` (each carries its own SpineResult + RackPlacement + warnings + BOM), `MultiPodAnalysis` (pods_needed, leaves_per_pod, ipn_routers_needed, spine_to_ipn_links). New warning codes: `MULTIPOD_REQUIRED`, `MULTIPOD_RECOMMENDED`, `MULTIPOD_LICENSE_BLOCKED`, `IPN_PORTS_INSUFFICIENT`, `IPN_MODEL_NOT_SELECTED`. Schema additions: `DesignResult.candidates: DesignCandidate[]`, `DesignResult.primary_candidate_id`, `DesignResult.committed_candidate_id` (user override, defaults to primary). Requirements: `fabric.aci_multipod_allowed: boolean` (default derived from license tier). IPN router library — decide between extending `switches.yaml` `role` enum to include `ipn` vs. shipping `seed/ipn_routers.yaml` (open question Phase 2b interview). Solver picks primary as the simplest valid candidate (fewer pods, then no-breakout if tied). | Unit tests cover the 111-leaf example (2× 64-port GX2A spines insufficient → multi-pod with 4 spines / 2 pods / 2 IPN routers / 56+55 leaf split, valid); single-pod regression fixtures from Phase 2 still produce identical primary candidates (no behavior change for designs that fit single-pod no-breakout); a candidate that's invalid carries a specific blocker warning in its `warnings` list. |
| 3 | Requirements screen | done | Multi-step requirements form mirroring WIP `Sizing` sections; saves to `requirements.yaml` | Can fill end-to-end requirements for a sample project |
| 4 | Design screen | done | Aggregate / per-leaf toggle, Generate Design button, results panel | End-to-end: requirements → click generate → `design.yaml` + `rack_layout` written |
| 5 | Rack View | done | Visual 42U rack UI, U-slot device placement, Rack Settings sidebar, Add Device modal, PDU budget validation | Can add/remove/move devices in racks; over-budget rack shows warning |
| 6 | Cable Links manager | done | Port-naming templates in `switches.yaml`/`servers.yaml`, `cable_links.yaml` data model, New Link form with port dropdowns + double-booking check | Can add a port-to-port link; same port can't be reused; CSV import works |
| 7 | Topology View | done | react-flow canvas with custom spine/leaf/server nodes, per-port handles, edge routing, elkjs auto-layout, click-to-select | Generated design renders as interactive graph; manual drag persists in `topology_layout.yaml` (auto-fork pattern, mirrors Phases 5/6) |
| 8 | CCW Importer | pending | CSV/TSV/XML parsers, staging UI, promote-to-library flow | Importing a sample CCW CSV produces reviewable entries; promotion writes to main library files |
| 9 | PDF export + cable BOM | pending | `@react-pdf/renderer` pipeline; hand-rolled SVG renderer for topology; cable length BOM (uses Cable Tray distance) | Export opens cleanly in Preview; BOM lists cable lengths rounded to standard sizes |
| 9b | Multi-Pod UI extensions | pending | UI surface for the Phase 2b candidate matrix. **Design view:** candidate comparison cards (4 quadrants — single/multi × no-breakout/breakout) showing each candidate's port math, validity verdict, spine count, IPN count, BOM delta; "Commit this candidate" toggle that flips `design.yaml.committed_candidate_id`; primary highlighted with a badge; invalid candidates shown with their specific blocker. **Topology view:** render pod boundaries (visual grouping with a soft border/label per pod), IPN router nodes between pods (new `'ipn'` node type with custom renderer), spine↔IPN edges. **Rack view:** IPN routers occupy U-slots like switches (typically dedicated ToR or "spine rack"); solver suggests an IPN rack when multi-pod is committed. **Links view:** spine↔IPN cable links auto-seeded as part of `cable_links.yaml` when multi-pod is committed; user can edit the same way they edit fabric uplinks today. **Requirements:** `aci_multipod_allowed` toggle in the Fabric section, defaulted from license tier. | End-to-end: build a 111-leaf ACI design → Generate → Design view shows multi-pod-no-breakout as primary + 3 alternates; Topology renders 4 spines + 2 IPNs + 111 leaves grouped into 2 pods; Rack view shows IPN routers in their own rack; Links view contains spine↔IPN edges in addition to spine↔leaf; flipping committed candidate to multi-pod-with-breakout regenerates the auto-seed for cable_links + topology positions. |
| 10 | Summary View + Polish | pending | Summary screen (counts, BOM totals, validation status), validation banners, keyboard shortcuts, recent projects, settings persistence | All screens reachable from sidebar; theme persists; validation states surfaced consistently |

---

## Open risks (revisit before the affected phase)

1. **react-pdf SVG fidelity** *(phase 9)* — shadcn/Tailwind styles don't all translate to react-pdf SVG. Plan a small "PDF-safe" stylesheet for the embedded SVG.
2. **CCW format variation** *(phase 8)* — CCW estimate exports change shape over time and per-region. Validate against a real export early; expect column-mapping presets to be necessary.
3. **react-flow + PDF export divergence** *(phases 7 & 9)* — Two topology renderers share the same `design.yaml.topology` data. Cover with a snapshot test so both stay in sync.
4. **Per-leaf port-map UX at 64 ports** *(phase 4 & 6)* — one-cell-at-a-time is tedious. Build a bulk-assign mode ("set ports 1–48 to 25G") from the start.
5. **YAML schema evolution** *(phase 1)* — `schema_version` on every YAML file; write a small migration helper during phase 1.
6. **Attachments size** *(phase 1)* — if data-sheet PDFs accumulate, workspace bloats. Decide per-entry max or "link to external path" alternative.
7. **Port-naming-template parser** *(phase 6)* — `Eth1/{1..48}` style template needs a small expander; keep it simple (no nested ranges, no conditionals).
8. **IPN router library source** *(phase 2b)* — TBD whether IPN routers extend `switches.yaml` (new `role: 'ipn'`) or ship as a separate `seed/ipn_routers.yaml`. Also TBD: which Cisco models qualify (Nexus 9300 with specific licensing? Nexus 9500 with line cards? Third-party for cost?). Settle in the Phase 2b interview.
9. **Multi-pod candidate-switch UX** *(phase 9b)* — when the user commits a different candidate (e.g. single→multi), the existing fork files (`rack_mapping.yaml`, `cable_links.yaml`, `topology_layout.yaml`) reference devices that may no longer exist. Will fold into the unified regenerate-aware editing pass (JOURNAL Open Item).
10. **Multi-pod IPN port budget per spine model** *(phase 2b)* — Cisco DC reference designs reserve 4–8 spine ports per IPN connection. The exact number per spine model isn't in the current `switches.yaml` schema. Decide whether to add an `ipn_uplink_ports_default` field per spine or use a global solver constant.

---

## Source-of-truth references

- **Switch library source** (authoritative): `N9K.md` — categorized list of Nexus 9300/9500 spine/leaf models with capabilities, ASIC features, ACI mode notes, and roadmap availability. Seeds `switches.yaml` via one-time manual transcription. The v8 `Hardware_Ref` sheet was derived from this .md and will not be read again.
- v8 design rules: 13 hard rules listed in [CLAUDE.md](CLAUDE.md)
- WIP requirements gathering: `DCN Network Requirements WIP.xlsx`, sheet `Sizing` (seeds `requirements.yaml` schema)
- Original prompt that started the calculator series: `prompt 3.md`
- Reference app for rack + topology + CCW features: colleague's "Fabric Rack and Wiring Assistant" (screenshots in session 2)

---

## Session Log

Append a row per session. Date in ISO format. Keep "what's next" short — the source of truth for state is the Phase Plan table, not the log.

| Date | Phase | What was done | What's next | Notes / deviations |
|---|---|---|---|---|
| 2026-05-11 | — | Plan finalized; CLAUDE.md and PROJECT_PLAN.md committed. Decisions interview captured. | Start phase 0 (scaffold) in next session. | — |
| 2026-05-11 | — | Scope expanded after seeing colleague's Fabric Rack and Wiring Assistant screenshots: added rack view, port-level cable links, CCW import, multi-rack solver, splash screen, server library, cable length BOM, PDU budget validation. Topology renderer changed to react-flow + SVG hybrid. Theme changed back to light + dark with toggle. Phase plan expanded from 6 to 11 phases. | Phase 0 unchanged — start scaffold in next session. | All decisions table updated; switches.yaml replaces hardware.yaml in library; servers.yaml added. |
| 2026-05-11 | 0 | Installed Node 26 via Homebrew. Scaffolded Electron + Vite + React 19 + TS 5 + Tailwind 4 + shadcn at repo root. Theme provider with CSS-variable tokens (light + dark), persisted to localStorage with system-preference fallback. Sidebar shell (Home / Library / Settings), header with theme toggle, placeholder content panel. `npm run typecheck` + `npm run build` both clean. `npm run dev` boots Electron window; renderer verified end-to-end via browser preview — theme toggle switches dark↔light, zero console errors. | Phase 1 (workspace + library + splash + YAML seed from v8 `Hardware_Ref`). | **Deviation:** plan says Electron Forge for packaging; used `electron-vite` + `electron-builder` for cleaner dev ergonomics. Only matters at packaging time (phase ≥10) — revisit then. Added `@radix-ui/react-slot` (shadcn Button dependency) and `tw-animate-css` to deps; not in original tech-stack table. `npm audit` shows 12 vulns (10 high) — all transitive in build chain; deferred. |
| 2026-05-12 | — | Repo initialized as DCN Designer **v1** (not v8). `git init` + initial commit `b1b6d44` on `main`; pushed to private GitHub at [github.com/ihave0billion/dcn-designer](https://github.com/ihave0billion/dcn-designer). Legacy `*.xlsx` and `Deliverables/` excluded via `.gitignore`. Confirmed `N9K-C9364D-GX2A-OPTICS.csv` (268 rows) is on disk for Phase 1b acceptance test. JOURNAL.md "git init?" open item moved to Resolved. | Phase 1b (optics importer) in a fresh session. | User drives all git operations from here on; I nudge with copy-pasteable commands at phase boundaries / doc edits / pre-destructive changes (captured in feedback memory). |
| 2026-05-12 | 1 | **Decisions captured before implementation** (one-question-at-a-time interview): workspace picker on first run; servers seed = small starter set; **switches seed source = `N9K.md`, NOT v8 `Hardware_Ref`** (user clarified the .xlsx will not be read again); manual transcription chosen over a parser; **per-switch optics** (`library/optics/<switch-id>.yaml`) replaces single `optics.yaml` — populated by Cisco TMG CSV upload, deferred to new phase 1b; "any updates to switches?" prompt at workflow start. PROJECT_PLAN.md updated to reflect these. **Implementation:** transcribed 25 switches from `N9K.md` into `seed/switches.yaml` (5 spine, 12 leaf, 8 both-role; covers 100G/400G/800G/ToR/PoE/Ultra-Low-Latency); seeded 7 UCS servers into `seed/servers.yaml` (C220-M7/M8, C240-M7/M8, C245-M8, C845A-M8, C885A-M8 per user request). Added `yaml`, `zod`, `react-hook-form`, `@hookform/resolvers`, and Radix Dialog/AlertDialog/Select/Tabs/Label/Checkbox. Defined zod schemas for switches, servers, project, settings. Added IPC bridge in main process (`dcn:*` handlers for workspace bootstrap, YAML I/O, project list/create/import, dialog pickers) exposed via preload as `window.dcn`. Added 10 shadcn UI components by hand (Card, Input, Textarea, Label, Checkbox, Tabs, Table, Dialog, AlertDialog, Select). Implemented WorkspaceContext (localStorage-backed workspace path + current project), WorkspacePicker (first-run dialog), SplashView (project list + Create/Import), CreateProjectDialog, ProjectView (placeholder for phases 3-9), LibraryView with SwitchesPanel/ServersPanel/OpticsPanelStub, full Switch + Server edit dialogs (12-capability checkboxes for switches; multi-port-group + GPU toggle for servers), plus AlertDialog-based delete confirmation. Workspace bootstrap copies seeds into `library/` on first run. Added a dev-only `installMockDcn()` (guarded by `import.meta.env.DEV`) so the renderer is testable in browser preview; verified Vite tree-shakes it out of production. **End-to-end verification (browser preview with mock):** WorkspacePicker → click → SplashView → Create dialog → fill name/customer → ProjectView opens with metadata; Library → Switches tab renders mock entries, Edit dialog pre-fills, save round-trips through zod (category change persisted); Servers tab renders mock entries; Optics tab shows phase-1b stub; zero console errors; `npm run typecheck` + `npm run build` both clean. | Phase 2 (pure-TS solver in `src/domain/`: per-tier math, spine count, breakout, AI/HPC 1:1, uplink auto-pick, rack placement). | **Deferred to phase 1b:** Cisco TMG optics CSV importer + per-switch optics CRUD + re-upload "replace or keep" prompt. **Open decision (not gating):** when exactly the "any updates to switches?" prompt fires — propose on project open with a "skip / review library" banner, revisit during phase 3. **Dev-only:** added `src/renderer/src/dev/install-mock-dcn.ts` — keeps a small inline switches/servers fixture for browser preview; production build excludes it. |
| 2026-05-12 | 1b | **Decisions captured** (interview): Optics tab = flat list of switches with optics imported (option a); upload uses **strict + pre-pick** switch from dropdown then verifies CSV's `Network Device Product ID` matches and silently skips non-matching rows; **leave `breakout_mode: null`** from CSV (TMG export does not include breakout); architectural follow-up: breakout reasoning belongs in a curated `seed/breakout_pairs.yaml` consumed by the solver (Phase 2) and Cable Links UI (Phase 6) — NOT in the per-switch optics YAML; file picker via native Electron dialog; malformed rows are skipped + counted + surfaced in the parse summary. **Implementation:** added `papaparse` + `@types/papaparse`; zod schema `optics.ts` (Optic with 22 fields incl. `os_support` list, `data_rate_g` numeric + `data_rate_raw` string, `eos` boolean, nullable `breakout_mode`); `OpticsFileSchema` for `library/optics/<switch_id>.yaml` (`schema_version`, `switch_id`, `source_csv`, `imported_at`, `optics[]`). Built `src/renderer/src/lib/optics-csv-parser.ts` (papaparse with `header: true`, `skipEmptyLines: 'greedy'`, per-row PID + switch-id filter, dedup by `(transceiver_pid, breakout_mode)` with OS variants accumulated into `os_support`, `Y/N → boolean` for EoS + DOM, max-of-numeric-prefix for "100/400 Gbps" → 400). Parse result includes counts (optic_count, rows_skipped_*) + warnings. Added 4 new IPC handlers: `dcn:show-csv-picker` (native file dialog with .csv/.tsv filters), `dcn:read-text-file`, `dcn:list-optics` (reads each `library/optics/*.yaml` and returns `{switch_id, source_csv, imported_at, optic_count}`), `dcn:delete-optics`. Extended `library-io.ts` with `libraryOpticsPath` + `loadOpticsFile` + `saveOpticsFile`. Built `OpticsPanel` (replaces `OpticsPanelStub`, deleted): empty-state card with upload CTA, table of switches w/ optics imported, click to drill in, trash to delete (AlertDialog confirm); `OpticsUploadDialog` (target-switch Select gated on library, native CSV picker, in-line parse summary card, "Import" button switches to "Replace existing…" when target already has an optics file → triggers AlertDialog confirm-replace); `OpticsDetailView` (back arrow, re-upload button, add optic button, header w/ source CSV + imported_at, filter input over `id/family/form_factor/media/standard/reach`, optics table with EoS badge + data-sheet external-link icon, Edit/Delete row actions); `OpticEditDialog` (full Optic form incl. dynamic `os_support` list with add/remove rows). Updated dev mock `install-mock-dcn.ts` with in-memory `opticsFiles` Map + mock CSV content + `showCsvPicker`/`readTextFile`/`listOptics`/`deleteOptics` handlers. **End-to-end verification (browser preview with mock):** Library → Optics shows empty state with upload CTA → click → dialog opens → Select switch from library dropdown → "Choose CSV…" → mock CSV parsed (3 unique optics from 6 rows; 1 row skipped because it targets a different switch; ACI + NX-OS variants merged into a single `os_support` list per PID) → Import → detail view shows table with PID/Family/Form-factor/Rate/Reach/Media/Connector/OS columns + EoS flag on `QDD-400G-SR4.2` → Edit row pre-fills all 20+ fields incl. OS support entries → cancel → re-upload triggers the "already has 3 optics" banner and "Replace existing…" confirm AlertDialog → cancel → back to All optics list shows 1 switch entry. Zero console errors; `npm run typecheck` + `npm run build` both clean; mock string not present in production bundle (tree-shaken). | Phase 2 (pure-TS solver in `src/domain/`: per-tier math, spine count, breakout, AI/HPC 1:1, uplink auto-pick, rack placement). | **Deferred to Phase 2:** add `seed/breakout_pairs.yaml` (initial entries: `QDD-400G-BD ↔ QSFP-100G-SR1.2` verified 1:1; `QDD-400G-SR4.2 → 4× QSFP-100G-SR1.2` verified breakout) — solver and Cable Links UI cross-reference this file to decide breakout viability instead of inferring from PID heuristics. **Deviation:** added `papaparse` + `@types/papaparse` to dependencies (was in tech-stack plan, formalized now). **Dev infra fix:** added `src/renderer/vite.config.ts` so browser preview resolves `@/*` alias correctly when running `vite` directly against `src/renderer` (the root `electron.vite.config.ts` uses electron-vite's nested format which plain Vite ignores); updated `.claude/launch.json` to drop the `--config electron.vite.config.ts` flag. |
| 2026-05-12 | 2 | **Decisions captured** (interview): `seed/breakout_pairs.yaml` ships with the two JOURNAL-flagged verified pairs + the user's connector-mismatch nuance (when spine/leaf connectors differ — MPO ↔ LC — solver emits a "patch panel required" warning; the dropdown for patch-panel selection itself is deferred to Phase 6's Cable Links UI); regression fixtures extracted from `DCN_Spine_Leaf_Calculator_v8.xlsx` (the prior spreadsheet artifact, kept on disk as reference material — user clarified mid-phase that v8 is NOT a one-shot seed source, it's reference material that's just excluded from git; the DCN Designer is its own first build, never "v8 anything"). Memory file `project_v8_vs_dcn_designer.md` updated accordingly. **Implementation:** `seed/breakout_pairs.yaml` with two entries (`QDD-400G-BD ↔ QSFP-100G-SR1.2`, fanout 1, no patch panel; `QDD-400G-SR4.2 → 4× QSFP-100G-SR1.2`, fanout 4, requires patch panel because MPO-12 ↔ LC). Added `vitest@4.1.6` + `vitest.config.ts` (node env, `@domain` + `@`/`@renderer` aliases) + `test` and `test:watch` npm scripts. Created `src/domain/` (zero UI deps, importable from renderer + main + tests): `types.ts` (interfaces for `SwitchSpec`, `TierRequest`, `FabricRequest`, `SolverRequirements`, `TierResult`, `SpineResult`, `BreakoutAnalysis`, `DesignResult`, `WarningCode` enum with 15 codes; zod schemas only for `BreakoutPair`/`BreakoutPairsFile` since those load from disk); `tier.ts` (per-row math: uplink auto-pick per v8 rule 13 picking higher per-port speed group, XOR check per v8 rule 8, override uplink speed clamping with `OVERRIDE_EXCEEDS_RATED` warning, leaves = `CEIL(endpoints / host_ports)` or `switch_count` directly); `spine.ts` (3-constraint MAX with HA floor of 2 per v8 rule 7: capacity = `CEIL(uplink_BW / (spine_ports × spine_speed))`, spine-touching = `uplinks_per_leaf / uplinks_per_spine` (null when non-divisible, emits `UPLINKS_NOT_DIVISIBLE_BY_PER_SPINE`), port-count = `CEIL(total_leaf_uplinks / spine_ports)`; breakout pass at fanout=4 recomputes port-count term with `spine_ports × 4`, flips_to_valid when base needs more uplinks than configured but breakout fits, looks up verified pair from `breakout_pairs` and surfaces patch-panel warning when connectors differ); `use-case.ts` (`requiresNonBlocking('ai'|'hpc') = true`, emits `AI_HPC_NOT_1TO1` when host_BW ≠ uplink_BW per active tier, `AI_HPC_NO_ROCEV2` when leaf/spine lacks the capability, plus `candidateLeavesFor` / `candidateSpinesFor` filters for the future Requirements UI); `rack.ts` (HA spread for spines via round-robin across racks, leaf pods of 2 kept together when rack fits, last-resort split with warning, PDU budget enforcement via per-device power_w sum with `DEFAULT_SWITCH_POWER_W=800` when library doesn't specify); `solver.ts` (`solve(requirements, context) → DesignResult` orchestrator: per-tier → spine + breakout → use-case → rack → summary rollup; validity = no blocking errors unless only blocker is `EXTRA_UPLINKS_NEEDED` AND breakout flips_to_valid, matching v8 Dashboard "VALID with breakout" semantics); `index.ts` re-exports. **Tests:** 46 tests across 5 files (`tier.test.ts`, `spine.test.ts`, `use-case.test.ts`, `rack.test.ts`, `solver.test.ts`). All 13 v8 hard rules covered. **Regression fixtures** (`solver.test.ts`) reproduce both v8 Dashboard default (50× N9348Y2C6D-SE1U @ 25G/100G override → 50 leaves, 200 leaf uplinks, spines_capacity=1, spines_touching=2, spines_port_count=4, spines_needed=4, oversub 3.00:1, EXTRA_UPLINKS_NEEDED flagged, breakout flips to valid with 2 spines) and v8 AI_HPC_NonBlocking default (1× N9K-C9364C-H1 @ 64×100G → 1 leaf, 64 uplinks, spines_needed=2 HA floor, oversub 1.00:1, valid, breakout not applicable). `npm run typecheck` + `npm test` + `npm run build` all clean. | Phase 3 (Requirements screen — multi-step form mirroring WIP `Sizing` sections, saves to `requirements.yaml`). | **Deviation from PROJECT_PLAN tech-stack table:** electron-builder still in use for packaging (phase 0 open item carries forward). **Open item closed:** `seed/breakout_pairs.yaml` schema + initial entries — see JOURNAL Resolved. **New open item:** patch-panel dropdown UX (Phase 6 / Cable Links manager) — when solver flags `BREAKOUT_PATCH_PANEL_NEEDED`, the user needs to pick a panel SKU. May need a `seed/patch_panels.yaml` library file. **Bundle warning:** renderer bundle is 1.15MB (no domain imports yet in renderer; this is pre-existing). Address at packaging time. |
| 2026-05-12 | 3 | **Decisions captured** (interview, one question at a time): form layout mirrors PROJECT_PLAN abridged schema rather than the legacy WIP `Sizing` sheet (the .xlsx is reference material, excluded from git); "any updates to switches?" prompt fires as a Card-banner on the Requirements screen with **Review library · Skip** buttons and per-project localStorage dismissal; tier rows start with **1 empty row** plus an `+ Add tier` button (no auto-pre-populate); per-leaf overrides editor and aggregate/per-leaf input-mode toggle deferred to Phase 4 (where Generate Design lives). **Implementation:** extended `RequirementsFileSchema` in `src/renderer/src/schemas/project.ts` with the full PROJECT_PLAN abridged shape — sub-schemas for `CurrentNetwork`, `Constraints`, `RackInventoryRow`, `TierRow`, `Fabric`, `UseCase` / `InputMode` / `DeploymentType` / `LicenseTier` enums; all optional sub-objects carry zod `.default()` calls so legacy minimal `{schema_version, project}` files (Phase 1 writes) hydrate cleanly; helper `emptyRequirements(project)` produces a fresh form state. `ProjectView` rebuilt with a 7-tab Radix Tabs strip (Requirements active, Design / Rack View / Links / Topology / Summary / Export disabled as phase stubs), back-button + project metadata in a sticky header. Legacy-shape fallback: if the file fails schema validation but has a recognizable `project` block, ProjectView synthesizes a full requirements doc via `emptyRequirements()` rather than blocking the user. New `RequirementsView` (`src/renderer/src/views/project/RequirementsView.tsx`) renders nine sections as scroll-anchored `Card`s — Project info, Current network, Use case, Tiers, Fabric, Constraints, Racks, Cable tray, Target oversub — plus a sticky left-side section nav (IntersectionObserver-driven active-section highlight + click-to-scroll). Tier table has live XOR validation per v8 rule 8 (rows flash destructive-tinted and a footer list surfaces specific row issues); fabric section shows live `spines_per_leaf = uplinks_per_leaf / uplinks_per_spine` with non-divisible warning; library Selects auto-filter by role (leaf vs spine) from `loadSwitchesFile`. Sticky save bar at the bottom: live dirty/saved indicator (deep-compares JSON), `Save requirements` button disabled when clean, transient emerald "Saved" badge after success. Library-review banner uses a CustomEvent (`dcn-designer:nav`) handled in `App.tsx` to navigate the sidebar to Library, with dismissal stored under `dcn-designer.review_library_dismissed.<project-path>`. Mock DCN extended for browser preview: `requirementsFiles` Map keyed by absolute path with round-trip read/write; `createProject` now seeds a minimal requirements.yaml so listProjects reflects fresh entries; `listProjects` re-reads `last_edited` / `customer` from the stored requirements file (matches the production main-process handler's behavior). **End-to-end verification (browser preview, 1440×900):** SplashView → Create → "Phase3 Test" / "Acme Inc" → ProjectView opens with 7-tab strip + 9-section form. Filled topology + endpoints, added a tier ("25G", 50 endpoints, 100G override), set fabric uplinks (4/leaf, 2/spine), added a rack, set cable_tray_m=12.5, oversub=3. Save → footer flips to "All changes saved" + Saved badge + button disabled; YAML round-tripped through mock and matched all fields. Re-tested with a fresh project after page reload: Save → "All projects" → splash shows updated last_edited → click project → form re-hydrates tier label/count and fabric defaults; XOR warning surfaces when both endpoint_count and switch_count are set on the same row; library-review banner dismisses with persisted localStorage key. Zero console errors. `npm run typecheck` + `npm test` (46/46 pass) + `npm run build` all clean. | Phase 4 (Design screen — aggregate/per-leaf toggle, Generate Design button, results panel — wires the Phase 2 solver into the UI). | **Open item closed:** "any updates to switches?" prompt location (default-park accepted). **New open item:** per-leaf input-mode editor UX — Phase 4 owns the toggle + bulk-assign mode for 64-port leaves (Open Risk #4 carries forward). **Deferred:** "Load v8 example" pre-fill button — not added; if useful later, ~30 LOC. **Note on solver wiring:** `RequirementsView` saves the requirements.yaml shape but does NOT yet call `src/domain/solver.ts` — that's Phase 4's Generate Design responsibility. Phase 3 strictly captures data. |
| 2026-05-13 | 6 | **Decisions captured** (interview, one question at a time): (Q1) Cable Links lives as a **full-tab view** (enable the existing disabled Links tab) — does not depend on Phase 7's Topology canvas. (Q2) Auto-seed on Generate Design, **fabric uplinks only** (leaf↔spine); server↔leaf wiring stays implicit. Server ports never appear in the New Link form's device dropdowns. (Q3) Ship `seed/patch_panels.yaml` with a small curated set + synthetic-SKU fallback (e.g. `PP-MPO12-LC`) for unlisted connector pairs. (Q4) Fixed-schema CSV round-trip (the app produces + consumes the same shape); rows referencing unknown devices are skipped + counted; append-or-replace prompt when existing links present. Fork pattern mirrors Phase 5: `cable_links.yaml` flips from `source: solver` → `source: user` on first edit, Reset deletes the file, next Generate re-seeds. **Implementation:** new `seed/patch_panels.yaml` (4 curated entries: Panduit/Corning MPO-12↔LC OM4 + SMF cassettes, Cisco MPO-12↔4×LC module, Panduit MPO-8↔4×LC). New schemas — `patch-panels.ts` (PatchPanel / PatchPanelsFile), `cable-links.ts` (CableEndpoint / CableLink / CableLinksFile w/ `source: 'solver'|'user'`, `seeded_at`, `forked_at`). Pure-TS helpers in `src/renderer/src/lib/`: **`port-template.ts`** (expands `Eth1/{1..48}` into a port list; throws on multiple brace spans per JOURNAL Open Risk #7; companion `expandPortTemplateCount`); **`patch-panel-resolver.ts`** (`connectorSlug` strips UPC/APC/whitespace, `resolvePatchPanel` matches curated panels in either connector order, falls back to `PP-<a>-<b>` synthetic ID, `syntheticPatchPanel` builds a placeholder record for dropdown display); **`cable-links-seeder.ts`** (devicesFromLayout walks rack_layout for spine+leaf roles with fallback when no racks defined; spine ports get sub-port suffixes `Eth1/<n>/<sub>` under breakout fanout; spine assignment uses `spineIdx = (li * spinesPerLeaf + Math.floor(portIdx / uplinks_per_spine)) % spineCount` so leaves stripe across spines; emits notes when divisibility fails / leaf has fewer ports than uplinks_per_leaf / spine ports overflow); **`cable-links-csv.ts`** (`serializeCableLinksCsv` writes 13-column header, escapes commas/quotes/newlines via RFC-4180-ish doubled quotes; `parseCableLinksCsv` validates header for 5 required cols, drops malformed/unknown-device rows with counted summary, synthesises IDs from a `startSerial` when missing). Library-io extended with `libraryPatchPanelsPath`/`loadPatchPanels`/`cableLinksPath`/`loadCableLinks`/`saveCableLinks`/`deleteCableLinks`. Main process: `ensureWorkspace` seed-copy list gains `patch_panels.yaml`; two new IPC handlers `dcn:write-text-file` (CSV export) + `dcn:show-save-csv-picker` (native save dialog with .csv filter); preload + types updated; preload exposes `window.dcn.writeTextFile` + `window.dcn.showSaveCsvPicker`. DesignView: `handleGenerate` now also auto-seeds `cable_links.yaml` when no fork exists — guarded by `loadCableLinks()` returning `null || source === 'solver'`, wraps seed in try/catch so seed failure doesn't block the design save (logs to console). ProjectView: Links tab enabled, renders `<LinksView />` with onGoToDesign callback. **LinksView** (`src/renderer/src/views/project/LinksView.tsx`, ~390 LOC): action bar w/ ForkStatusPill (`Solver-seeded (N links)` ↔ `Forked — your edits`), Export CSV / Import CSV / Reset / New link buttons; loading + design-missing empty states; table w/ filter input matching id/label/device/port/optic/patch_panel_id, rows show spine + leaf endpoints stacked w/ port in mono font, Edit + Trash icons; CSV import dialog with parse summary card (parsed / total / malformed / unknown-device counts + first-20-warnings list) and append/replace radio when existing links present; Reset confirms via AlertDialog and deletes the file. **NewLinkDialog** (`src/renderer/src/views/project/NewLinkDialog.tsx`, ~370 LOC): spine + leaf device dropdowns from design; port dropdowns auto-built from each switch's `naming_template` via `expandPortTemplate`, with used ports disabled and marked `(used)` per the existing-links set; auto-load per-switch optics via lazy callback (caches in LinksView); leaf-side port toggle when leaf model has a secondary uplink; speed-G input filters optics by `data_rate_g`; patch panel dropdown appends a synthetic placeholder built from the chosen optic's `connector_type`; auto-builds the label as `<spineId>:<port> ↔ <leafId>:<port>` while still letting the user override; rejects submit when chosen port is already used by another link. Mock DCN extended: `cableLinksFiles` Map, `textFiles` Map, `patchPanels` constant; readYaml handles patch_panels.yaml + cable_links.yaml; writeYaml + deleteFile + fileExists wired; new mock handlers `writeTextFile` + `showSaveCsvPicker`. **Tests:** vitest.config.ts include glob extended with `src/renderer/src/lib/**/*.test.ts`; new test files `port-template.test.ts` (8 cases incl. inverted range + multi-brace rejection), `patch-panel-resolver.test.ts` (12 cases incl. connector-order independence, synthetic fallback, slug normalisation), `cable-links-csv.test.ts` (10 cases for round-trip, comma/quote escaping, unknown-device skipping, missing required cols, ID synthesis), `cable-links-seeder.test.ts` (6 cases for non-breakout, breakout w/ MPO↔LC sub-ports, no-divisibility skip, curated-panel match, patch_panel_id propagation). Total: **76 tests passing** (was 46, +30). **End-to-end verification (browser preview, 1440×900, mock):** Created Phase6 Test project → seeded full requirements.yaml (use_case=dcn, 1 tier 25G/96 endpoints/N9K-C93400LD-H1, spine N9K-C9364D-GX2A, uplinks 4/leaf 2/spine, 2 racks @ 8 kW PDU, 100G uplink override, target_oversub 3, license_tier advantage). Switched to Design tab → Generate design → 2 leaves × 4 uplinks = 8 cable links auto-written to `cable_links.yaml` with `source: 'solver'`, `seeded_at` stamped. Walked the table contents: leaf-1 uses Eth1/49–50 to spine-1 then Eth1/51–52 to spine-2 (stripe math correct), leaf-2 continues spine-1 on Eth1/3–4 and spine-2 on Eth1/3–4; speed_g=100 (override applied); optic_id + patch_panel_id null (no breakout in this design). Status pill shows `Solver-seeded (8 links)`. Opened New Link dialog → all 7 fields rendered (Spine device, Spine port, Leaf device, Leaf port w/ uplink choice toggle stub, Speed, Optic gated on speed, Patch panel, Length, Label) → cancelled. Deleted link-0001 via trash icon + AlertDialog confirm → status pill flipped to `Forked — your edits (7 links)`, `cable_links.yaml` source: 'user', forked_at stamped, links: 7. Reset to solver layout → AlertDialog confirm → file deleted, pill back to `No links yet`. Re-clicked Generate design → file re-seeded with 8 links and `source: 'solver'`. Export round-trip: `window.dcn.showSaveCsvPicker` returns `/mock-export/test-export.csv` → serialized CSV stored via writeTextFile → readTextFile produced 10 lines (1 header + 8 data rows + trailing newline) with the expected 13-column shape. Zero console errors / warnings. `npm run typecheck` clean (after dropping unused `requirements` destructure + dead `UsedPort` type from initial pass). `npm test` → 76 passed. `npm run build` clean; renderer bundle 1.38 MB (+70 KB from Phase 5: LinksView + NewLinkDialog + helpers + cable-links seeder); mock string absent from production bundle. | Phase 7 (Topology View — react-flow canvas with custom spine/leaf/server nodes, per-port handles, edge routing for cables, elkjs auto-layout, click-to-select, manual-drag persistence). | **Open item closed (Phase 6):** patch-panel dropdown UX — see JOURNAL Resolved. **Carries forward (Phase 7+):** solver-regen drift detection now also applies to `cable_links.yaml` — same auto-fork pattern, will fold into the unified "regenerate-aware editing" pass per JOURNAL. **New open item (Phase 6 polish):** New Link form Radix Select dropdowns are difficult to drive via browser-preview eval (portal-rendered options); covered by unit tests on the underlying helpers + manual sanity in the UI. **Deviation:** vitest.config.ts include glob extended to cover `src/renderer/src/lib/**/*.test.ts` — first time tests live outside `src/domain/`. Domain stays UI-free; the four Phase 6 helpers depend on the renderer's zod schemas, so they stay in `src/renderer/src/lib/` and the test config follows them. |
| 2026-05-13 | 5 | **Decisions captured** (interview, one question at a time): (Q1) Auto-fork on first edit — view shows solver output editable; first change silently writes `rack_mapping.yaml` and it becomes the source of truth; **Reset to solver layout** button always present and deletes the fork file. (Q2) Single rack at a time + sidebar rack list with device count + over-budget badge. (Q3) Click device → right-side properties panel (Label / Start U / Model swap / Remove); drag-drop deferred to Phase 10 polish. (Q4) Full rack inventory CRUD from Rack View (+ Add rack, rename, delete, edit size/PDU/location/tags); writes back to `requirements.yaml.racks` as the single source of truth. **Implementation:** New schema `src/renderer/src/schemas/rack-mapping.ts` (RackMappingFile / RackMappingRack / RackMappingDevice — `role: spine\|leaf\|server\|blank`, nullable `model_id` for blanks, `start_u` 1-indexed from rack bottom, library-derived `ru`+`power_w` lookups at render time so the fork stays canonical). New IPC handler `dcn:delete-file` (generic, used here for fork-reset) — exposed via `window.dcn.deleteFile`, mirrored in `DcnApi`. New library-io helpers `rackMappingPath` / `loadRackMapping` / `saveRackMapping` / `deleteRackMapping` (zod-validated, returns `null` when no fork exists). Built `src/renderer/src/views/project/RackView.tsx` (~720 LOC): 3-column layout — sidebar rack list with "+ Add rack" and over-budget destructive-tinted card border; main canvas with 42U absolutely-positioned device blocks (U-row guides 18px each, devices colored by role: violet=spine, sky=leaf, emerald=server, dashed-gray=blank panel; click selects); right-side panel that toggles between **Rack Settings** (commit-on-blur for text, commit-on-change for numbers, atomic rename that migrates `rack_mapping.yaml.racks[].rack_id`) and **Device Properties** (Label, Start U, Model swap via Radix Select, Remove from rack). Action bar fork-status pill (`Solver layout (read-through)` ↔ `Forked — your edits`), Reset confirm via AlertDialog. Empty-state Card when no racks defined. Built `src/renderer/src/views/project/AddDeviceDialog.tsx` (~280 LOC): Radix Tabs for **Switch** / **Server** / **CCW-Switch** (stub) / **CCW-Server** (stub) / **Blank Panel** (1/2/4/6/10 U preset buttons); filterable library list per tab (id, model_display, category, role for switches; id, ports summary, GPU for servers); shared Label/Start U/Quantity inputs; quantity stacks devices upward from Start U with auto-generated unique device_ids walking the existing-IDs set. ProjectView tab strip enabled `<TabsTrigger value="rack">Rack View</TabsTrigger>` and renders RackView with `onGoToDesign` callback. Extended dev mock: `rackMappingFiles` Map + read/write/exists/delete handlers (mirrors the production main-process paths). **Bugfix during verification:** initial mount-effect re-fired on `requirements.racks.length` change and yanked `selectedRackId` back to the first entry every time the user clicked "+ Add rack". Split the effect into two — one bound to project/workspace identity (mount-only data load), one that syncs `selectedRackId` against the rack inventory but **only** clears/falls-back when the selected rack actually disappeared. **End-to-end verification (browser preview, 1440×900, mock):** Created project → seeded requirements (1 tier 25G @ 96 endpoints, N9K-C93400LD-H1 leaves, N9K-C9364D-GX2A spine, 2 racks @ 8 kW each, PDU=8) → Design tab → Generate design → Rack View pill = "Solver layout (read-through)"; sidebar shows "Rack A 3 devices · 3/42 U" + "Rack B 1 devices · 1/42 U"; canvas renders 42 U-slots top-down (U42→U01) with violet spine and sky leaf blocks at U1-U3 of Rack A → click Spine 1 device → right panel shows Device Properties (Label / Start U / Model swap dropdown / library-derived Model ID / Role / Primary ports / RU / Power / Remove) → edit Label to "My Custom Spine" + blur → pill flips to "Forked — your edits" + `rack_mapping.yaml` written with renamed device. Add device dialog → Switch tab → pick N9K-C93400LD-H1 → Start U=10, Quantity=8 → Add → 8 leaves stack at U10-U17 → Rack A power 9.60 kW / 8 kW budget → over-budget pill in sidebar, over-budget destructive-tinted banner in canvas ("Over PDU budget by 1.60 kW"). Reset to solver layout → AlertDialog confirms → `rack_mapping.yaml` deleted, pill back to "Solver layout", devices restored to solver output. "+ Add rack" creates "New rack" auto-selected + visible in right panel; rename to "Pod 3 ToR" via blur commits to `requirements.yaml.racks` + sidebar updates; Delete rack via AlertDialog removes it from both files. Zero console errors. `npm run typecheck` + `npm test` (46/46) + `npm run build` clean; renderer bundle 1.31 MB (+50 KB from Phase 4: RackView + AddDeviceDialog); mock string absent from production bundle. | Phase 6 (Cable Links manager — port-naming templates in switches.yaml/servers.yaml, `cable_links.yaml` data model, New Link form with port dropdowns + double-booking check, CSV import). | **Deviation:** RackView mount-effect was originally keyed on `requirements.racks.length` (matching prior phases' pattern) — caused the selection-bounce bug; refactored mid-phase to split into mount-only load + selection-sync effect (see Errors section in JOURNAL). **Open item (carries forward):** drift detection when solver regenerates after a fork (e.g. requirements gain a tier so design.yaml has new devices the fork doesn't reference). Phase 5 currently does NOT surface this — user has to Reset to pick up new devices. Tracked in JOURNAL. **Open item (Phase 10 polish):** drag-and-drop reordering within a rack (Q3 picked click-to-edit for v1). |
| 2026-05-13 | 5b + plan | **Phase 5b — Rack defaults polish (shipped):** schema `RackInventoryRow.size_u` default 42 → 44 (industry-standard data-center cabinet); solver `pushDevice` in `src/domain/rack.ts` flipped from bottom-up packing (`start_u = used_u + 1`) to top-down (`start_u = rack.size_u - used_u - d.ru + 1`) so spines + leaves auto-place at the top of the rack; RackView's `+ Add rack` inline default 42 → 44 (the U-grid was already `size_u`-aware from Phase 5); AddDeviceDialog's Start U defaults to `rackSizeU` on open (top-of-rack), quantity now stacks **downward** (cursor `-= ru`) instead of upward, with two new bounds-validations (top device fits in-rack + downward stack stays above U1) and updated description copy ("stacks devices downward from there"). Existing project requirements + rack_mapping files keep their stored 42 unless the user edits — only new projects + new racks default to 44. **Plan-only addition for Multi-Pod ACI** (no implementation this session): captured the 4-way candidate-matrix design (`{single-pod, multi-pod} × {no-breakout, with-breakout}`), auto-promote-simplest-valid-as-primary policy, schema deltas (`design.candidates[]`, `primary_candidate_id`, `committed_candidate_id`, `requirements.fabric.aci_multipod_allowed`), pod sizing formula, IPN port budget concept, license gating, and the regenerate-aware-editing implication when users commit a different candidate. Added Phase 2b row (solver math + IPN library) and Phase 9b row (Design candidate cards + Topology pod boundaries + IPN nodes + Rack/Links extensions) to Phase Plan. Added 2 Decisions table rows (rack defaults + multi-pod policy + IPN routers), new "Multi-Pod ACI" subsection under Solver, and 3 new Open Risks (IPN library source, candidate-switch UX, IPN port-budget-per-spine-model). **End-to-end verification (browser preview, 1440×900, mock):** schema default 44 verified via writeYaml→readYaml→zod parse round-trip; solver Generate produced placements at U44 (spine-1), U43 (spine-2), U42 (leaf-1), U41 (leaf-2) for a 4-device design in a 44U rack; Rack View canvas rendered the U44 → U01 grid with all switches at the top; AddDeviceDialog opened with Start U = 44 + new description copy; adding 3× 1U leaves with default settings produced devices at U44, U43, U42 (downward stack); typing Start U=2 + Quantity=5 fired the new bounds error "Stacking 5× 1U devices downward from U2 would extend below U1." All 90 tests still pass; typecheck + build clean. | Phase 8 (CCW Importer) is the next "pending" phase for implementation. Phase 2b (multi-pod solver) is now also "pending" and could be picked up before Phase 8 if the user prioritizes it. | **Plan-only deviation:** Phase Plan grew by two rows (2b + 9b) without any code change in this session — captured per the "add to plan, implement later" pattern. **Carries forward to Phase 2b:** IPN router library source decision (extend `switches.yaml` vs new `ipn_routers.yaml`), curated IPN-eligible model list, IPN port-budget-per-spine field, multi-pod license-tier rule, candidate-matrix data flow into UI. **Closed:** "racks should be 44U + switches default to top of rack" — see Decisions table additions and this row's verification block. **Note on existing Phase 5 verification text:** the prior Phase 5 session-log row still says "42 U-slots top-down (U42→U01)" — that was accurate for that session; new projects from this point forward render U44 → U01 instead. Not retroactively updated. |
| 2026-05-13 | 7 | **Decisions captured** (interview, one question at a time): (Q1) Topology shows **spines + leaves only** — Phase 6 cable_links.yaml is fabric-uplink-only, so server nodes would carry implicit/visually-misleading edges. (Q2) Drag positions persist to a new **`topology_layout.yaml` fork file** (mirrors Phase 5/6 auto-fork pattern) instead of the original Phase Plan's `design.yaml.topology.positions` — overrides the Phase Plan's literal acceptance text in favor of architectural consistency. (Q3) Click-to-select opens a **right-side properties panel** (mirrors RackView), read-only — node panel shows model/role/rack/RU/used-ports + jump links to Rack View + Links; edge panel shows endpoint pair/speed/optic/patch panel/length + Edit-in-Links link. (Q4) Per-port handles render **only for ports actually used in cable_links.yaml** — naturally scales with the wiring (4–8 handles per node in typical small designs, more only as cable_links grows), avoids the 64-port-spine wall. **Implementation:** added `@xyflow/react@12.10.2` + `elkjs@0.11.1` to deps. New schema `src/renderer/src/schemas/topology-layout.ts` (`TopologyLayoutFile`: `schema_version`, `source: 'auto'|'user'`, `seeded_at`, `forked_at`, `positions[]` of `{device_id, x, y}`). Library-io extended with `topologyLayoutPath` / `loadTopologyLayout` / `saveTopologyLayout` / `deleteTopologyLayout`. New pure-TS helper `src/renderer/src/lib/topology-extractor.ts` (`extractTopology(design, cableLinks) → TopologyGraph`): walks `design.rack_layout` for spine + leaf devices (drops servers per Q1), walks cable_links to compute per-device `usedPorts` (orphans — devices referenced by links but absent from rack_layout — get a synthetic node so edges aren't dropped silently), orients edges with spine as source even when `cable_links.yaml` has spine on side B, falls back to summary-derived devices when rack_layout is empty (mirrors `cable-links-seeder.ts`); companion `comparePortNames` natural sort handles `Eth1/2 < Eth1/10 < Eth1/49/1`. New `src/renderer/src/lib/topology-elk-layout.ts`: elkjs layered DOWN with `LayerConstraint: FIRST` for spines and `LAST` for leaves (without these hints elk sometimes interleaves on sparse graphs), `BRANDES_KOEPF` placement, `nodeDimensions(node)` widens nodes as their `usedPorts` count grows. New `src/renderer/src/views/project/TopologyView.tsx` (~620 LOC): `<ReactFlowProvider>` wrapper around the canvas; custom `SpineNodeRenderer` / `LeafNodeRenderer` (shared `PortNodeRenderer`) renders one Handle pair (`out:<port>` source + `in:<port>` target, distributed evenly along the bottom-of-spine / top-of-leaf edge), tag, model_id, rack, port-count footer, port-name labels under handles when ≤16 ports; `smoothstep` edges with `MarkerType.ArrowClosed`, inline `<speed>G` label; action bar `ForkStatusPill` (`Auto-layout (elkjs)` ↔ `Forked — your layout`) + node/link counts + orphan badge + Fit view + Auto-layout (re-runs elk and persists as user fork — for users iterating from a fork) + Reset to auto-layout (forked-only, AlertDialog confirm, deletes file → re-runs elk in-memory); right-side properties panel toggles between `NodePropertiesPanel` (shows orphan banner when `model_id === 'unknown'`, KV rows for model/role/rack/RU + used-port chips + Rack View / Links jump buttons), `EdgePropertiesPanel` (KV rows for from/to/speed/optic/patch panel/length + label + Edit-in-Links button), and `EmptySelectionPanel` (instructional copy). On-mount loads design + cable_links + topology_layout in parallel; in the layout effect, if `topology_layout.yaml` exists uses stored positions, otherwise runs elk in-memory (no auto-write — file only created on first user drag, mirroring Phase 5/6); `onNodeDragStop` persists the entire current node-position snapshot as `source: 'user'` + `forked_at` via a `nodesRef` to capture post-move state. ProjectView wired: enabled the Topology tab and renders `<TopologyView />` with `onGoToDesign` / `onGoToRack` / `onGoToLinks` callbacks (jumps via controlled-tabs setActiveTab). Mock DCN extended: `topologyLayoutFiles` Map with read/write/exists/delete handlers. **Tests:** `topology-extractor.test.ts` (8 cases: spines+leaves only / servers dropped, used ports natural-sorted, edge orientation, orphan synthesis, empty-layout fallback, no-link case + 2 sort tests), `topology-elk-layout.test.ts` (6 cases: empty graph, spines-above-leaves invariant for DOWN direction, positive bounds, one-position-per-node, node-dimensions sizing). Total: **90 tests passing** (was 76, +14). **End-to-end verification (browser preview, 1440×900, mock):** Created Phase7 Test project → seeded full requirements (use_case=dcn, tier 25G/96 endpoints/N9K-C93400LD-H1, spine N9K-C9364D-GX2A, uplinks 4/leaf 2/spine, 2 racks @ 8 kW PDU, 100G uplink override) → Design tab → Generate design → 2 spines + 2 leaves + 8 cable links auto-written. Switched to Topology tab via Radix arrow-key navigation (preview_click on tab triggers don't drive Radix tabs — same shape as the Phase 6 Radix Select issue) → react-flow canvas rendered with **4 nodes** (spine-1/spine-2 violet on top, leaf-1/leaf-2 sky on bottom), **8 edges** with smooth-step routing + `100G` labels + arrow markers, **32 port handles** (4 used ports per node × 4 nodes), pill = `Auto-layout (elkjs)`. Clicked spine-1 (via dispatched pointer chain on the .react-flow__node element) → properties panel populated with model `N9K-C9364D-GX2A`, role spine, Rack A, RU 1, used-ports chips Eth1/1–4. Clicked link-0001 path → edge panel showed Spine 1 Eth1/1 → Leaf 1 Eth1/49, 100G, optic — patch panel —. Drag persistence verified by direct file write (react-flow internal d3-drag doesn't accept dispatched pointer events): wrote `topology_layout.yaml` with source: 'user' + 4 fixed positions (999/50, 1199/50, 999/600, 1199/600) → re-mounted view via tab navigation → all 4 nodes re-anchored to the stored coordinates, pill flipped to `Forked — your layout`, `Reset to auto-layout` action button appeared. Reset → AlertDialog confirm → file deleted → pill back to `Auto-layout (elkjs)`, nodes restored to elkjs DOWN-layered output (spines y=12, leaves y=342). `Auto-layout` button (forked-iteration) → re-ran elk + wrote file with source: 'user'. Orphan path verified: appended `link-orphan` referencing nonexistent `leaf-99` → re-mount → 5 nodes (leaf-99 synthesised with dashed border, model 'unknown', "1 port in use"), action bar shows `5 nodes · 9 links · 1 orphan`. Zero console errors. `npm run typecheck` + `npm test` (90/90 pass) + `npm run build` all clean; renderer bundle 5.04 MB (was 1.38 MB; +3.66 MB from elkjs which is heavy + react-flow + their deps); mock string absent from production bundle (verified by grep on built JS). | Phase 8 (CCW Importer — CSV/TSV/XML parsers, staging UI, promote-to-library flow). | **Open item closed (Phase 7):** none specifically — Phase 7's Q2 decision overrides the original Phase Plan acceptance line ("manual drag persists in `design.yaml`") in favor of the auto-fork file pattern, captured in Phase Plan table edit. **Carries forward (Phase 7+):** solver-regen drift detection now also applies to `topology_layout.yaml` — same auto-fork shape as rack_mapping + cable_links, all three fold into the unified "regenerate-aware editing" pass per JOURNAL Open Items. **New open item (Phase 7 polish):** react-flow internal drag handling can't be driven by dispatched pointer events in browser-preview eval (d3-drag pointer-capture filters); covered by direct-file-write round-trip + manual sanity in real browser. Mirrors the Phase 6 Radix Select preview limitation. **New open item (Phase 9/10):** renderer bundle hit 5 MB (3.66 MB jump from elkjs + react-flow). Lazy-load TopologyView via `React.lazy` and split elkjs into its own chunk before packaging. Tracked in JOURNAL. **Deviation:** Phase Plan acceptance line said "manual drag persists in `design.yaml`" — overridden via Q2 to use the established auto-fork file pattern. Phase Plan table updated to reflect the new acceptance. |
| 2026-05-12 | 4 | **Decisions captured** (interview, one question at a time): (Q1) per-leaf editor scope — **toggle-only stub** this phase; aggregate is the only working solver path; per-leaf editor + solver extension deferred to a follow-up "Phase 4b". (Q2) results panel scope — **inline rich** breakdown on the Design tab (summary card, warnings table, per-tier table, spine sizing card, breakout analysis card, optics BOM hint, rack layout list); later phases (5/7/10) can slim sections as dedicated tabs come online. (Q3) iteration model — **view + generate only**; Design tab is a read-only mirror of `requirements.yaml`, only the input-mode toggle is live-editable; an **Edit requirements** button jumps back to the Requirements tab. (Q4) breakout pairs plumbing — **extend `ensureWorkspace`** to copy `seed/breakout_pairs.yaml` to `workspace/library/breakout_pairs.yaml` on first run; renderer reads via existing `dcn.readYaml` (no new IPC), and a silent fallback to `[]` covers older workspaces predating this bootstrap. **Implementation:** Extended `src/main/index.ts` `ensureWorkspace` seed-copy list to include `breakout_pairs.yaml`. Added `libraryBreakoutPairsPath` / `loadBreakoutPairs` to `src/renderer/src/lib/library-io.ts` (guards with `fileExists` first, validates with `BreakoutPairsFileSchema` from `@domain`). New TS path mapping `"@domain": ["src/domain/index.ts"]` in `tsconfig.web.json` so bare `import { ... } from '@domain'` resolves at typecheck time (Vite's resolver already handled this at bundle time). Built `src/renderer/src/lib/solver-bridge.ts`: `switchToSpec(Switch) → SwitchSpec` projects the renderer's full library Switch down to the narrower domain shape (drops naming_template, vendor/category/availability, ACI notes, attachments); `requirementsToSolverInput(RequirementsFile) → SolverRequirements` lifts `use_case` + `input_mode` from top-level into `fabric` (matching `FabricRequest` shape) and projects rack inventory rows to `RackInventoryEntry`; `runSolver(...) → DesignResult` orchestrates and calls `solve()` from `@domain`. Built `src/renderer/src/views/project/DesignView.tsx` (~540 LOC): action bar with input-mode Select + Edit-requirements button + Generate/Regenerate button (shows "Last design saved · N leaves · N spines" once results are loaded); amber stub Card when `input_mode === 'per_leaf'`; amber "Requirements incomplete" Card listing missing pieces (tiers without leaf model / no spine model selected); read-only "Inputs from requirements" Card mirroring use case / input mode / uplinks / spine model / racks count and a tiers table; results panel renders only after a generate: **summary card** (emerald-tinted when valid, destructive when invalid; status pill; breakout-required CardDescription when applicable; 8 KV stats including total leaves/spines/oversub/BW); **warnings card** (filtered counts in title; severity badges with icons); **per-tier results table** (label / leaf model / leaves / endpoints supported / host BW / uplink BW with override note / uplink choice / xor status badge); **spine sizing card** (8 KV stats — model, totals, three terms, spines_needed highlighted emerald, required uplinks/leaf, divisibility note); **breakout analysis card** (6 KV stats — verified pair, fanout, with_breakout count, reduces_spine_count, flips_to_valid, patch_panel_needed); **optics BOM hint table** (only when present, with "Cable Links UI will refine" note); **rack layout list** with per-rack devices rendered as role-colored pills (violet=spine, sky=leaf, muted=server) and `over_budget` highlighting. Mount-time effect loads `library/switches.yaml` and any existing `design.yaml` so re-entry to the tab shows the last results; mock `fileExists` is now path-aware (true for switches/servers/breakout_pairs, true for requirements/design only when written, true for optics only when uploaded) so the loader behaves correctly. Wired `ProjectView.tsx` to controlled Tabs (`value={activeTab}`/`onValueChange`), enabled the Design tab, and renders `<DesignView />` with an `onEditRequirements` callback that flips `activeTab` back to `requirements`. **Dev mock extended** (`install-mock-dcn.ts`): added `designFiles` Map for design.yaml round-trip; added `breakoutPairs` mirror constant (same two verified pairs as the seed file); readYaml handles `breakout_pairs.yaml` + `design.yaml`. **End-to-end verification (browser preview, 1440×900, mock):** Create project → fill Requirements (tier 25G/50 endpoints/N9K-C93400LD-H1/100G uplink override; spine N9K-C9364D-GX2A; uplinks 4/leaf 2/spine) → save → switch to Design tab → inputs summary cards mirror the saved values → click Generate → **Design valid** badge + summary card shows 2 leaves / 2 spines / 4800G host / 800G uplink / 6.00:1 oversub → per-tier table shows 25G · N9K-C93400LD-H1 · 2 leaves · 96 endpoints supported · "primary · 4× 100G" uplink choice · ok status → spine sizing card shows capacity=1 / touching=2 / port-count=1 → MAX → spines_needed=2 (HA floor honored) · required uplinks/leaf = 4 → breakout card surfaces verified pair `QDD-400G-SR4.2 → QSFP-100G-SR1.2` (fanout 4) and `patch_panel_needed=yes — connector mismatch` → rack layout card states no racks defined → header strip updates to "Last design saved · 2 leaves · 2 spines" and button text becomes **Regenerate design**. Per-leaf stub verified: switching input mode to `per_leaf` flips the combobox label, disables the Generate button, and reveals the amber "Per-leaf overrides editor coming in Phase 4b" Card; switching back to Aggregate re-enables Generate. Edit-requirements button jumps the active tab back to Requirements. Zero console errors. `npm run typecheck` + `npm test` (46/46 pass) + `npm run build` all clean; renderer bundle 1.26MB (up from 1.15MB — solver-bridge + DesignView + domain imports). Mock-string sweep of production renderer bundle returns 0 occurrences (tree-shaken). | Phase 5 (Rack View — visual 42U rack UI, U-slot device placement, Add Device modal, PDU budget validation banners). | **New open item (Phase 4b):** per-leaf input-mode editor — bulk-assign UI (`set ports 1–48 to 25G, 49–64 to 100G`), `per_leaf_overrides` field on `TierRequest`/`requirements.yaml`, solver extension to consume per-port input. Carries forward Open Risk #4. **Open item closed:** per-leaf input-mode editor UX target phase (now scoped to Phase 4b instead of Phase 4 — see JOURNAL). **Deviation:** added `"@domain": ["src/domain/index.ts"]` bare-specifier path in `tsconfig.web.json` — Vite's alias already resolved bare-specifier imports of the index but the TS resolver needed the explicit mapping. `tsconfig.node.json` doesn't include the renderer or domain, so the node typecheck path was unaffected. **Schema note:** `design.yaml` is written as the raw `DesignResult` shape (no zod validation on write); mount-time read does a bare cast. A formal `DesignFileSchema` is deferred to Phase 5 where Rack View will be the first consumer that needs strict round-trip guarantees. |
