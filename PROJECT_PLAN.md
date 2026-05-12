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
| 1b | Optics importer | pending | CSV upload UI per switch under Library → Optics; Cisco TMG CSV parser → `library/optics/<switch-id>.yaml`; deduplication of OS-variant rows into `os_support` lists; re-import "replace or keep" prompt; Optics CRUD on top of the imported lists | Upload `N9K-C9364D-GX2A-OPTICS.csv` (268 rows) and see the parsed optics listed under that switch; re-uploading prompts to replace; can hand-edit an optic entry after import |
| 2 | Domain solver (no UI) | pending | Pure-TS solver in `src/domain/`: per-tier math, spine count, breakout, AI/HPC 1:1, uplink auto-pick, rack placement heuristic | Unit tests cover all v8 hard-rule cases; v8 default inputs reproduce v8 outputs; rack placement respects PDU budget |
| 3 | Requirements screen | pending | Multi-step requirements form mirroring WIP `Sizing` sections; saves to `requirements.yaml` | Can fill end-to-end requirements for a sample project |
| 4 | Design screen | pending | Aggregate / per-leaf toggle, Generate Design button, results panel | End-to-end: requirements → click generate → `design.yaml` + `rack_layout` written |
| 5 | Rack View | pending | Visual 42U rack UI, U-slot device placement, Rack Settings sidebar, Add Device modal, PDU budget validation | Can add/remove/move devices in racks; over-budget rack shows warning |
| 6 | Cable Links manager | pending | Port-naming templates in `switches.yaml`/`servers.yaml`, `cable_links.yaml` data model, New Link form with port dropdowns + double-booking check | Can add a port-to-port link; same port can't be reused; CSV import works |
| 7 | Topology View | pending | react-flow canvas with custom spine/leaf/server nodes, per-port handles, edge routing, elkjs auto-layout, click-to-select | Generated design renders as interactive graph; manual drag persists in `design.yaml` |
| 8 | CCW Importer | pending | CSV/TSV/XML parsers, staging UI, promote-to-library flow | Importing a sample CCW CSV produces reviewable entries; promotion writes to main library files |
| 9 | PDF export + cable BOM | pending | `@react-pdf/renderer` pipeline; hand-rolled SVG renderer for topology; cable length BOM (uses Cable Tray distance) | Export opens cleanly in Preview; BOM lists cable lengths rounded to standard sizes |
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
