# DCN Designer — Journal

Running log of progress notes that don't fit cleanly into [PROJECT_PLAN.md](PROJECT_PLAN.md)'s
session log:

- **Open items / deferred decisions** — flagged for later, not yet resolved
- **Errors / failures** — symptom, root cause, fix, lesson
- **Lessons / patterns** — reusable knowledge to remember next time

PROJECT_PLAN.md remains the source of truth for the phase plan, decisions table, and per-session
work log. This file is for the orthogonal axis: what's open, what bit us, what to remember the
next time we hit a similar shape of problem.

**Conventions**

- Add new entries at the top of each section.
- Date in ISO format (`YYYY-MM-DD`).
- When an open item is resolved, move it to **Resolved (recent)** with a one-line note pointing at
  where the resolution lives (PROJECT_PLAN.md row, commit, etc.). Prune Resolved to the last
  ~10 entries periodically — historical context lives in git history.
- Don't duplicate the PROJECT_PLAN.md session log. If a fact is captured there, just reference it.

---

## Open items / deferred decisions

### 2026-06-03 — Phase 9b Multi-Pod UI shipped without browser/GUI verification
- **Context:** Phase 9b (candidate cards + commit toggle, IPN nodes + pod
  boundaries on Topology, IPN rack on Rack View, spine↔IPN seeding on Links,
  Requirements toggle) was built and verified at the **logic layer only** —
  `npm run typecheck` + `npm test` (121/121) + `npm run build` all clean, with
  new unit tests covering domain IPN placement/pod tagging, the
  candidate-projection helper, the spine↔IPN seeder, and the IPN topology
  extractor. **No browser-automation tool was available in this headless VM**
  this session (the prior phases' "browser preview" capability wasn't present),
  so the rendered UI (candidate cards, pod-boundary backdrops, IPN node
  renderer, IPN rack swatch, commit-switch AlertDialog) has **not** been
  eyeballed.
- **What's needed:** a manual sanity pass in Electron (`npm run dev:linux`):
  build the 111-leaf ACI design → Generate → confirm 4 candidate cards →
  Commit a multi-pod candidate → confirm Topology shows IPN nodes + 2 pod
  boundaries + spine↔IPN edges, Rack View shows the amber IPN rack, Links lists
  spine↔IPN rows. Watch for: pod-boundary node z-order/pointer-events (set
  `zIndex:-1` + `pointer-events:none`, untested visually), and spine↔IPN edge
  routing (both spine + IPN handles face "down" — edges will draw but may curve
  awkwardly; acceptable for v1, revisit if ugly).
- **Why open:** environment limitation, not a code defect. Mirrors the existing
  react-flow / Radix preview limitations already logged below.
- **Update 2026-06-03 (follow-up session):** closed the one *code-level* gap that
  would have made the browser-preview path itself wrong — the dev mock
  (`install-mock-dcn.ts`) did **not** serve `ipn_routers.yaml`, so in browser
  preview the Requirements IPN-router picker was empty and the multi-pod solver
  had no router to pick (`pickIpnRouter` → null → `IPN_MODEL_NOT_SELECTED`).
  Added an `ipnRouters` mirror (3 entries; the two 400G ones match the mock
  switches) wired into the mock's `readYaml` + `fileExists`, plus a new
  mock-backed test `src/renderer/src/lib/library-io-ipn.test.ts` (stubs
  `globalThis.window`, installs the mock, asserts `loadIpnRouters` returns
  non-empty schema-valid routers that project to `IpnRouterSpec`). Suite now
  124/124 (was 121); typecheck + build clean; mock strings tree-shaken from the
  prod bundle (0 occurrences). The seed→workspace copy was already wired
  (`ensureWorkspace` seed list includes `ipn_routers.yaml`), so Electron was
  unaffected — this was browser-preview parity only.
- **RESOLVED 2026-06-03 (same follow-up session):** `xvfb` was installed
  (`sudo apt-get install -y xvfb`) and the full Phase 9b UI was driven headless
  via the Chrome DevTools Protocol (Electron launched with a dev-gated
  `--remote-debugging-port`; a zero-dep Node CDP harness using Node 22's built-in
  `WebSocket` screenshotted + clicked through the app). End-to-end pass: create
  project → write 111-leaf ACI requirements → Design tab → **4 candidate cards
  render correctly** (Multi-Pod/No-breakout = green Valid + Primary, the other 3
  Invalid with specific blockers, IPN counts + spine↔IPN cable totals all right)
  → Topology / Links inspected. **The GUI pass found a real integration bug**
  (multi-pod views ignored the committed candidate when no rack inventory was
  defined) — see Errors section "2026-06-03 — Multi-pod Topology/Links render a
  flat 2-spine fabric…". Fixed + re-verified: Topology now renders 8 spines + 111
  leaves + 2 IPN nodes + 4 pod boundaries (121 nodes), Links has 508 links incl.
  64 spine↔IPN, 0 console errors throughout.
- **Follow-up logged:** spine↔leaf wiring is still pod-agnostic — see new open
  item "2026-06-03 — Multi-pod spine↔leaf wiring is not pod-local".

### 2026-06-03 — Multi-pod spine↔leaf wiring is not pod-local
- **Context:** the cable-links seeder (`cable-links-seeder.ts`) round-robins each
  leaf's uplinks across **all** spines in the fabric, ignoring ACI pod membership.
  In a multi-pod design this wires leaves to spines in other pods (e.g. with the
  111-leaf fix in place, `leaf-2` — pod 0 — connects to `spine-3/4`, which are in
  pod 1). The device counts, IPN nodes, pod boundaries, and spine↔IPN links are
  all correct now; only the spine↔leaf *edge endpoints* cross pods.
- **Correct behavior:** a leaf must connect only to the spines in its own pod
  (`spine pod_index === leaf pod_index`). Each pod is an independent spine-leaf
  fabric; cross-pod traffic rides the IPN, never a direct leaf→foreign-spine link.
- **What's needed:** make the seeder's spine selection pod-aware — bucket spines
  by `pod_index` (now present on every device in `rack_layout`) and round-robin
  each leaf only within its pod's spine bucket. The data is already there; it's a
  change to the spine-picking loop + a test asserting no cross-pod spine↔leaf link.
- **Why open:** pre-existing (the round-robin was never pod-aware); surfaced by the
  2026-06-03 GUI verification once the full 8-spine device set started rendering.
  Out of scope for that session's approved fix (which was "make the committed
  multi-pod candidate render at all without rack inventory").
- **Revisit:** Phase 10, or a dedicated multi-pod-wiring fix session.

### 2026-05-13 — Multi-Pod ACI: IPN port budget per spine model (Phase 2b)
- **Context:** Each spine in a multi-pod design reserves some primary ports for
  IPN uplinks (typically 4–8 per spine, per Cisco DC reference designs). The
  exact number isn't a property of the spine model itself — it's a deployment
  choice. But the solver needs a default per spine model to compute pod-level
  spine port budgets correctly.
- **What's likely needed:**
  1. Add `ipn_uplink_ports_default: number` to `switches.yaml` for spine-role
     entries (defaults to 4 if unset).
  2. Or use a global solver constant like `DEFAULT_IPN_UPLINKS_PER_SPINE = 4`,
     overridden per-design via a new `requirements.fabric.ipn_uplinks_per_spine`
     field.
- **Why open:** decide during Phase 2b interview.
- **Revisit:** Phase 2b.

### 2026-05-13 — Multi-pod commit-candidate: regenerate-aware editing extension (Phase 9b)
- **Context:** Phase 2b will introduce `design.yaml.candidates[]` + a
  `committed_candidate_id`. When the user flips the committed candidate from
  e.g. `single_with_breakout` to `multi_no_breakout`, the active rack_layout
  changes (multi-pod has more devices: extra spines + IPN routers + possibly
  more racks). Existing fork files (`rack_mapping.yaml`, `cable_links.yaml`,
  `topology_layout.yaml`) reference the OLD candidate's device set.
- **What's needed:** the unified regenerate-aware editing pass (already on the
  roadmap below) needs to handle "user committed a different candidate" as one
  more trigger that may require fork-vs-design diff + merge. Same shape as
  the requirements-changed trigger, just sourced differently.
- **Behavior decided (2026-06-01):** on commit-switch, **warn + let the user
  choose** — show what would be orphaned (devices gone) vs missing (new IPNs
  with no rack/links), then offer "Regenerate fresh" vs "Keep my edits".
  Non-destructive default; never silently discard hand-edits. (PROJECT_PLAN Open
  Risk #9 + 2026-06-01 session log row.)
- **Implemented 2026-06-03 (Phase 9b):** the *commit-switch* trigger is done in
  `DesignView` — `handleCommit` detects hand-edited forks (`cable_links` with
  `source: 'user'`, any `rack_mapping`, `topology_layout` with `source: 'user'`)
  and, when present, opens an AlertDialog offering **Regenerate fresh** (deletes
  rack_mapping + topology_layout, re-seeds cable_links) vs **Keep my edits**
  (leaves forks; re-seeds only solver-sourced cable_links). When no forks exist
  it re-seeds silently. Commit re-projects the committed candidate onto
  `design.yaml` top-level via `lib/design-projection.ts`.
- **Still open:** the *requirements-change* trigger (user edits requirements →
  re-Generate produces a different device set than the forks reference) is NOT
  handled — that's the broader unified regenerate-aware editing pass below.
- **Revisit:** the unified pass folds into Phase 10.

### 2026-05-13 — Solver-regen drift detection for forked rack layouts, cable links, AND topology layout (Phases 5 + 6 + 7 follow-up)
- **Context:** Phase 5 (`rack_mapping.yaml`), Phase 6 (`cable_links.yaml`), and Phase 7
  (`topology_layout.yaml`) all implement auto-fork on first edit — the file becomes the
  source of truth, solver-regen leaves it alone. When the user later changes
  requirements and re-Generates the design, the new `design.yaml` may contain devices
  the forks don't have (e.g. user added a tier → 3 new leaves), or have lost devices
  the forks still reference. Today all three views show only what's in their fork; the
  user must click **Reset** to wholesale discard their edits and pick up the new
  devices. Phase 7 partially mitigates the topology case via orphan-node synthesis (a
  link to a missing device still renders, with a dashed border and "unknown" model),
  but the user still has to manually fix it. No "merge in 3 new devices" affordance
  exists for any of the three files.
- **What's likely needed:** on mount, compute set differences between fork and current
  design output:
  - Rack View: `mapping.racks[*].devices[*].device_id` vs.
    `design.yaml.rack_layout[*].devices[*].device_id`
  - Links View: spines/leaves referenced in `cable_links.yaml.links[*].device_a/b.device_id`
    vs. the spines + leaves the new design produces
  - Topology View: `topology_layout.yaml.positions[*].device_id` vs. the device set
    extracted from rack_layout; orphan-node array already computed by
    `extractTopology()` is the seed for this
  Surface a banner with the diff (e.g. "Solver has 3 new devices since you forked: leaf-7,
  leaf-8, leaf-9. [Add them] [Reset] [Dismiss]"). Add-them route drops them into the
  rack/link/canvas slot the solver picked, but flags conflicts when start_u or ports are
  taken.
- **Why open:** real but not blocking — single-user workflow usually iterates one direction
  (requirements → solver → racks/links/topology → done). The drift case mostly bites when
  revisiting an older project.
- **Revisit:** Phase 10 (Polish) — fold all three into a unified "regenerate-aware
  editing" pass.

### 2026-05-13 — react-flow internal drag can't be driven by dispatched pointer events in browser-preview eval
- **Context:** Phase 7 verification of node-drag persistence couldn't fully exercise
  `onNodeDragStop` because react-flow uses an internal d3-drag implementation with
  pointer-capture filters that ignore programmatically dispatched `PointerEvent`
  sequences. Manual drag in a real browser works fine. Same shape as the Phase 6
  Radix Select preview limitation.
- **What's needed:** either accept that drag persistence is tested by direct file-write
  round-trip + Electron manual sanity, OR add an in-page test harness that exposes
  `persistPositions(nodes)` directly so end-to-end verification doesn't depend on
  react-flow's drag internals.
- **Why open:** the persistence helper round-trips cleanly (verified by writing a
  topology_layout.yaml with `source: 'user'` and confirming the next mount picks up the
  stored positions), the schema validates via zod, and the fork pattern is identical to
  Phase 5/6 which had similar limits. Not worth a custom harness right now.
- **Revisit:** Phase 10 if we add Playwright-driven smoke tests.

### 2026-05-13 — Renderer bundle hit 5 MB after Phase 7 (elkjs + react-flow)
- **Context:** Phase 7 added `@xyflow/react@12.10.2` + `elkjs@0.11.1`. Renderer bundle
  jumped from 1.38 MB → 5.04 MB (+3.66 MB). elkjs alone is ~3 MB (includes its own
  worker + the Eclipse layered layout algorithm). All other phases combined sit at
  ~1.4 MB.
- **What's likely needed:** lazy-load `TopologyView` via `React.lazy` so the elk +
  react-flow chunk doesn't ship in the initial bundle (project view tabs are cheap
  splits — most users open Requirements / Design before ever visiting Topology). Also
  consider `manualChunks` in vite config to put elkjs in its own vendor chunk for
  better caching.
- **Why open:** Electron app, so no over-the-wire cost; first-paint is hot-reload-driven
  in dev. Will bite at packaging time when Electron's installer balloons.
- **Revisit:** Phase 9 (PDF export will pull `@react-pdf/renderer`, so the bundle audit
  + chunk strategy makes sense to do once for both libraries) or Phase 10 polish.

### 2026-05-13 — New Link form Radix-Select dropdowns hard to drive via browser-preview eval
- **Context:** Phase 6 verification of the New Link dialog couldn't fully exercise the
  Radix Select dropdowns (spine device, spine port, leaf device, leaf port, optic, patch
  panel) because Radix portals the options outside the dialog DOM and only renders them
  when opened. Programmatic `.click()` doesn't open the listbox; pointer events fire but
  the portal contents aren't reachable via standard CSS selectors during eval. Manual
  click in a real browser works.
- **What's needed:** either accept that Selects are tested by unit tests on the underlying
  helpers (`expandPortTemplate`, `resolvePatchPanel`) + Electron manual sanity, OR add
  a thin in-page test harness that exposes the dialog's submit handler directly so
  end-to-end verification doesn't depend on Radix portal interaction.
- **Why open:** the helpers are well-covered by vitest (30 new tests in Phase 6) and the
  dialog's logic is straightforward; not worth a custom harness right now.
- **Revisit:** Phase 10 (Summary + Polish) if we add Playwright-driven smoke tests.

### 2026-05-13 — Drag-and-drop device reordering within a rack (Phase 10 polish)
- **Context:** Phase 5 Q3 picked click-to-select + side-panel form for editing device
  position. Reasonable for v1, but for rapid placement (e.g. moving 8 leaves around a
  pod), drag-and-drop is the natural interaction. PROJECT_PLAN Open Risk #4 (per-leaf
  port-map UX at 64 ports) is similar in spirit — both want bulk/spatial editing.
- **What's likely needed:** `@dnd-kit/core` integration, collision detection against
  existing devices (no overlap allowed), maybe a snap-grid at 1U increments. Keep
  click-to-select as the fallback for accessibility.
- **Why open:** non-trivial work that's only worth doing once we have realistic usage
  patterns. Phase 5 v1 is fully functional without it.
- **Revisit:** Phase 10 (Summary + Polish).

### 2026-05-12 — Per-leaf input-mode editor (Phase 4b)
- **Context:** Phase 4 shipped the aggregate-mode end-to-end path (`requirements →
  Generate → design.yaml`) plus an input-mode toggle stub. When the toggle flips to
  `per_leaf`, the Design tab shows a placeholder Card and disables Generate. Building
  the real per-leaf path needs both UI (bulk-assign + exceptions table for 64-port
  leaves — Open Risk #4) **and** solver work (`TierRequest` has no
  `per_leaf_overrides` field today; the Phase 2 solver only consumes aggregate inputs).
- **What's likely needed:**
  1. Schema: add `per_leaf_overrides: [{leaf_index, ports: [{port_index, speed_g}]}]`
     to `TierRow` in `src/renderer/src/schemas/project.ts` and a parallel
     `TierRequest.per_leaf_overrides` field in `src/domain/types.ts`.
  2. Solver: extend `computeTier` to honor per-port speeds (host BW becomes the sum of
     per-port speeds for that leaf rather than `host_ports × host_speed`).
  3. UI on the Design tab: bulk-assign form ("ports 1–48 → 25G, 49–64 → 100G"), per-port
     exceptions table, copy-leaf-config-to-other-leaves shortcut.
  4. Tests: extend `tier.test.ts` + `solver.test.ts` with mixed-port-speed cases.
- **Why open:** non-trivial UX work + solver extension; kept out of Phase 4 to preserve
  its clean boundary (Q1 interview answer 2026-05-12).
- **Revisit:** Phase 4b, scheduled after Phase 5 (Rack View) ships unless user re-prioritizes.

### 2026-05-11 — Electron Forge vs electron-builder for packaging
- **Context:** PROJECT_PLAN.md tech-stack table specifies Electron Forge. Phase 0 used
  `electron-vite` + `electron-builder` for cleaner dev ergonomics. Only matters at packaging time.
- **Why open:** Re-evaluating now would be premature; both can ship the same app.
- **Revisit:** Phase 10 (Polish + packaging) — confirm choice and migrate if needed.

### 2026-05-11 — npm audit reports 12 vulnerabilities (10 high)
- **Context:** All in transitive build-chain dependencies (electron-builder / electron-vite
  pulls). Not affecting runtime.
- **Revisit:** Before packaging phase, or when one upstream dep majors.

---

## Resolved (recent)

### 2026-06-01 — Multi-Pod ACI: IPN router library source + curated model list (Phase 2b) → resolved
Ship a **separate `seed/ipn_routers.yaml`** (not a `switches.yaml` `role: 'ipn'`
enum) — Phase 2b had already created the file with one seed model; the library
source is now confirmed and the file populated with the eight `role: both`
models from the 100G + 400G categories of `switches.yaml` (100G: 9364C-H1,
93600CD-GX, 9336C-SE1; 400G: 9364D-GX2A, 9348D-GX2A, 9332D-GX2B, 9332D-H2R,
9316D-GX), each duplicated under the IPN role with `capabilities.multipod`. The
9336C-SE1 is included despite lacking ACI-spine capability — an IPN runs NX-OS,
so ACI capability is not required of the IPN itself. IPN-specific routing/MTU
fields were NOT added; the slim `IpnRouterSchema` (id, primary, ru, power_w,
capabilities) is sufficient for the solver. Curated-model expansion happens via
the Library UI in Phase 9b. (PROJECT_PLAN Open Risk #8 + 2026-06-01 session log.)

### 2026-05-13 — Rack defaults: 44U + top-of-rack switch placement (Phase 5b polish) → resolved
Per user request after Phase 7 wrap-up. Schema `RackInventoryRow.size_u`
default flipped from 42 → 44 (industry-standard data-center cabinet). Solver
`pushDevice` in [src/domain/rack.ts](src/domain/rack.ts) flipped from bottom-up
packing (`start_u = used_u + 1`) to top-down (`start_u = rack.size_u - used_u
- d.ru + 1`) so spines + leaves auto-place at the top of the rack. RackView's
`+ Add rack` inline default updated. AddDeviceDialog's Start U defaults to
`rackSizeU` on open (top-of-rack), quantity stacks **downward** instead of
upward, with two new bounds-validations and updated description copy.
Existing project requirements + rack_mapping files keep their stored 42 unless
the user edits — only new projects + new racks default to 44. Verified
end-to-end (browser preview): 4-device 44U design produces placements at U44,
U43, U42, U41; AddDeviceDialog adds 3× 1U leaves at U44/U43/U42 (downward
stack); bounds error fires on Start U=2 + Quantity=5. 90/90 tests pass.

### 2026-05-13 — Patch-panel dropdown when breakout pairs have connector mismatch → resolved
Shipped in Phase 6. `seed/patch_panels.yaml` carries 4 curated cassettes (Panduit/Corning
MPO-12↔LC OM4 + SMF, Cisco MPO-12↔4×LC module, Panduit MPO-8↔4×LC). `patch-panel-resolver.ts`
matches curated panels in either connector order via `connectorSlug` (strips UPC/APC
parens + whitespace). When nothing matches, it returns a stable synthetic ID of the form
`PP-<a>-<b>` (e.g. `PP-MPO12-LC`) plus an on-the-fly `syntheticPatchPanel` record so the
dropdown can render a placeholder line. `cable-links-seeder.ts` calls the resolver when
the design's breakout analysis reports `patch_panel_needed`, persists the chosen ID on
every seeded link. `NewLinkDialog.tsx` builds the dropdown from curated panels + the
synthetic placeholder driven by the chosen optic's `connector_type`. Persists to
`cable_links.yaml.links[].patch_panel_id` (string-or-null).

### 2026-05-12 — `design.yaml` persistence + Design-tab UI scope → resolved
Phase 4 wrote `design.yaml` as the raw `DesignResult` shape (no zod schema yet — first
read-back consumer is Phase 5). DesignView is **view + generate only** per Q3
(2026-05-12): inputs come from `requirements.yaml`, only the input-mode toggle is
live-editable on the tab, and an **Edit requirements** button jumps back to the
Requirements tab via controlled Radix Tabs in `ProjectView.tsx`. Results panel is the
**inline rich** breakdown (summary + warnings + per-tier + spine sizing + breakout +
optics BOM hint + rack layout) per Q2 (2026-05-12). Implementation in
`src/renderer/src/views/project/DesignView.tsx`.

### 2026-05-12 — `breakout_pairs.yaml` workspace plumbing → resolved
Per Q4 (2026-05-12), extended `ensureWorkspace` in `src/main/index.ts` to copy
`seed/breakout_pairs.yaml` → `workspace/library/breakout_pairs.yaml` on first run.
Renderer loads via existing `dcn.readYaml` IPC through new helpers
`libraryBreakoutPairsPath` + `loadBreakoutPairs` in `src/renderer/src/lib/library-io.ts`;
both `fileExists`-guard and zod-validate, returning `[]` if the file is missing
(handles older workspaces predating Phase 4 bootstrap without crashing). No new IPC
surface was added.

### 2026-05-12 — "Any updates to switches?" prompt location → resolved
Banner lives at the top of the Requirements screen as a yellow-tinted Card with
**Review library** (dispatches `dcn-designer:nav` CustomEvent that App.tsx routes to the
Library sidebar entry) and **Skip** buttons. Dismissal persists in localStorage under
`dcn-designer.review_library_dismissed.<project-path>` so it's per-project — a new
project will see the prompt again. Implemented in Phase 3
(`src/renderer/src/views/project/RequirementsView.tsx`).

### 2026-05-12 — `seed/breakout_pairs.yaml` schema + initial entries → resolved
Shipped in Phase 2. Two entries: `QDD-400G-BD ↔ QSFP-100G-SR1.2` (fanout 1, both LC,
`requires_patch_panel: false`) and `QDD-400G-SR4.2 → 4× QSFP-100G-SR1.2` (fanout 4, MPO-12 ↔
LC, `requires_patch_panel: true`). Schema extended beyond JOURNAL's original proposal to
include `spine_connector`, `leaf_connector`, and `requires_patch_panel` per user request —
patch-panel dropdown for the UI side moved to its own open item (Phase 6). Solver
(`src/domain/spine.ts`) reads this file via `SolverContext.breakout_pairs` and surfaces
`BREAKOUT_PATCH_PANEL_NEEDED` warnings when connectors differ.

### 2026-05-12 — git init? → resolved
Repo initialized as DCN Designer **v1** (not v8 — user clarified the legacy spreadsheet is
not part of this repo's history). Initial commit `b1b6d44` on `main`. Remote:
[github.com/ihave0billion/dcn-designer](https://github.com/ihave0billion/dcn-designer) (private).
Legacy `*.xlsx` and `Deliverables/` excluded via `.gitignore`; `v8-baseline` tag from an
earlier interim commit was dropped before the recommit.

---

## Errors / failures and resolutions

### 2026-06-03 — Multi-pod Topology/Links render a flat 2-spine fabric when no rack inventory is defined
- **Symptom:** committing a multi-pod candidate (111-leaf ACI: 8 spines / 4 pods /
  2 IPNs) rendered correctly in the Design **candidate cards**, but Topology showed
  only **2 spines + 111 leaves, no IPN nodes, no pod boundaries** (113 nodes) and
  Links had **128 spine↔leaf links, zero spine↔IPN**. Found by the 2026-06-03
  headless GUI verification (CDP harness) — the logic-layer tests had all passed.
- **Root cause:** all multi-pod truth lives in `candidate.multipod`
  (`pods_needed`, `spines_per_pod`, `ipn_routers_needed`…) and
  `summary.total_spines`, but `projectCommittedCandidate` writes the candidate's
  **per-pod** spine result onto top-level `design.spine.spines_needed` (= 2), and
  the candidate's `rack_layout` was **empty** because `placeRacks` returns `[]`
  for empty rack inventory (and `annotateMultiPodLayout` early-returns on an empty
  layout, so no IPN rack either). Both downstream consumers —
  `cable-links-seeder.ts` `devicesFromLayout` and `topology-extractor.ts`
  `synthesiseDevicesFromSummary` — fall back to `design.spine.spines_needed` (2)
  and explicitly drop IPNs when `rack_layout` is empty. So without rack inventory
  the whole multi-pod structure vanished from every view except the cards.
- **Fix:** new `synthesizeLogicalLayout(spine, tiers, switches)` in `domain/rack.ts`
  builds a device-bearing (unracked) layout — every spine (`spines_needed` =
  fabric total) + every leaf, same `spine-N`/`leaf-N` id scheme as `placeRacks`.
  `buildMultiPodCandidate` uses it whenever `placeRacks` returns empty, then
  `annotateMultiPodLayout` pod-tags it and appends the IPN rack. Because the
  projection copies `c.rack_layout` to top-level and both consumers prefer
  `rack_layout` over their fallbacks, all four views now agree. Regression test
  added (`multipod.test.ts`: no-inventory candidate exposes 8 spines + 111 leaves
  + 2 IPNs, pod-tagged). **Re-verified in the GUI:** Topology 121 nodes (8 spines
  + 111 leaves + 2 IPN + 4 pod boundaries), Links 508 (444 spine↔leaf + 64
  spine↔IPN), 0 console errors.
- **Lesson:** unit tests fed the seeder/extractor hand-built `rack_layout`
  fixtures, so they never exercised the empty-inventory fallback that the real
  generate→project→seed→extract chain hits by default. Integration paths with
  "reasonable defaults" (here: a brand-new project has no racks) need a test at
  the seam, not just per-unit. The CDP GUI harness is what caught it.

### 2026-05-13 — RackView mount-effect yanked selection back to first rack on +Add rack
- **Symptom:** Clicking **+ Add rack** in the Rack View sidebar created a new rack
  successfully (file written), but the right-side panel kept showing the first rack's
  settings (Rack A) instead of switching to the new rack. The new rack appeared in the
  sidebar but couldn't be edited because it was never selected.
- **Root cause:** Initial implementation reused the Phase 4 pattern of keying the
  data-load `useEffect` on `[workspacePath, projectPath, requirements.racks.length]`.
  Each time a rack was added (length 2 → 3), the effect re-ran and reset
  `selectedRackId` to `requirements.racks[0].name`. The `setSelectedRackId(name)` call
  inside `handleAddRack` was racing with — and losing to — that effect.
- **Fix:** Split the mount-effect into two:
  1. A data-loading effect keyed only on `[workspacePath, projectPath]` — runs once per
     project open, loads switches/servers/design/mapping, never touches selection.
  2. A separate selection-sync effect keyed on `[requirements.racks, selectedRackId]`:
     - First mount with racks present and `selectedRackId == null` → pick the first.
     - Subsequent updates: only clear `selectedRackId` if the named rack disappeared
       (delete or rename without atomic sync). Adding a rack is a no-op here.
- **Lesson:** Don't tie heavy data loading to mutable inventory size — separate the
  "what data should be loaded for this entity" effect from the "keep derived UI state
  consistent with prop changes" effect. When in doubt, model each effect's input as
  precisely as possible.

### 2026-05-12 — `@/*` alias unresolved in renderer-only browser preview
- **Symptom:** After starting `vite --config electron.vite.config.ts --mode development src/renderer`,
  the dev server overlay showed `Failed to resolve import "@/components/ui/button" from
  "src/renderer/src/views/SettingsView.tsx"`.
- **Root cause:** `electron.vite.config.ts` uses electron-vite's nested format
  (`{ main: {…}, preload: {…}, renderer: { resolve: { alias: … } } }`). When invoked by plain
  Vite (instead of electron-vite's CLI), the top-level keys are unrecognized and dropped, so no
  alias is applied. This had appeared to work in phase 1 only because of a stale `.vite/` cache.
- **Fix:** Added `src/renderer/vite.config.ts` with a flat Vite config that mirrors the alias
  (`@`, `@renderer` → `src/renderer/src`), and updated `.claude/launch.json` to drop the
  `--config electron.vite.config.ts` flag. Production Electron build still uses the root
  `electron.vite.config.ts`.
- **Lesson:** Tools that share config files between different invocation paths (electron-vite
  CLI vs. plain Vite CLI) silently drop unknown keys — don't assume one config covers both.
  When verifying via browser preview, use a renderer-scoped Vite config.

### 2026-05-12 — Renderer blank in browser preview after phase 1
- **Symptom:** `localhost:5173` showed a blank page; React error boundary warnings: "An error
  occurred in the `<WorkspacePicker>` component."
- **Root cause:** `WorkspacePicker.useEffect` called `window.dcn.defaultWorkspacePath()`. In
  Electron, `window.dcn` is injected by preload; in a plain browser preview it's `undefined`,
  so the property access threw `TypeError` synchronously (before the `.catch()` could run).
- **Fix:** Added an `isElectron` guard in WorkspacePicker. Added a dev-only
  `installMockDcn()` ([src/renderer/src/dev/install-mock-dcn.ts](src/renderer/src/dev/install-mock-dcn.ts))
  gated by `import.meta.env.DEV` and dynamically imported in main.tsx. Vite tree-shakes the
  import in production builds (verified: zero mock-content occurrences in built JS).
- **Lesson:** see "Browser-mode dev mock pattern" below.

### 2026-05-11 — `tsc` cannot find `@tailwindcss/vite` types
- **Symptom:** `npm run typecheck` failed: "Cannot find module '@tailwindcss/vite' or its
  corresponding type declarations" pointing at `dist/index.d.mts`.
- **Root cause:** Base `@electron-toolkit/tsconfig/tsconfig.node.json` sets
  `moduleResolution: "node"` (legacy CommonJS resolver), which can't resolve `.mts` ESM-only
  type declarations.
- **Fix:** Overrode `moduleResolution: "bundler"` and `module: "esnext"` in
  [tsconfig.node.json](tsconfig.node.json).
- **Lesson:** When extending `@electron-toolkit/tsconfig`, expect to override resolution for
  any ESM-only deps.

---

## Lessons / patterns

### 2026-05-12 — Browser-mode dev mock pattern (for Electron apps)
For Electron apps where the renderer depends on preload-injected APIs (`window.dcn`,
`window.electron`, etc.), keep the renderer browser-runnable for fast iteration:

1. Where the renderer touches the preload API at component-entry boundaries, compute
   `const isElectron = typeof window !== 'undefined' && Boolean(window.dcn)` and short-circuit
   if false.
2. Provide a dev-only mock module that installs a stub on `window.dcn` if missing; import it
   from `main.tsx` inside `if (import.meta.env.DEV) { await import(...) }`. Vite drops the
   import entirely from production bundles.
3. After every prod build, `grep` the renderer bundle for an obvious marker from the mock
   (e.g. a placeholder workspace path) to confirm tree-shaking actually dropped it.

This lets browser preview tools (screenshot, click, eval) cover most of the UI, while the
real `window.dcn` from preload powers Electron — no production-time dead code.

### 2026-05-11 — Per-question interview style
User strongly prefers interviewing-style decisions one question at a time (captured in
auto-memory as `feedback_interview_one_question_at_a_time.md`). Each question should:

- Cover one decision only
- Offer 2–3 multiple-choice options
- Include a recommended default with brief reasoning

Batching 4 questions into a table — even with options — is wrong. Wait for each answer before
asking the next; later answers may change earlier ones.
