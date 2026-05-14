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

### 2026-05-13 — Solver-regen drift detection for forked rack layouts AND forked cable links (Phases 5 + 6 follow-up)
- **Context:** Both Phase 5 (`rack_mapping.yaml`) and Phase 6 (`cable_links.yaml`)
  implement auto-fork on first edit — the file becomes the source of truth, solver-regen
  leaves it alone. When the user later changes requirements and re-Generates the design,
  the new `design.yaml` may contain devices / ports the fork doesn't have (e.g. user added
  a tier → 3 new leaves), or have lost devices/ports the fork still references. Today
  both views show only what's in their fork; the user must click **Reset to solver
  layout** to wholesale discard their edits and pick up the new devices. No "merge in
  3 new devices" affordance exists for either file.
- **What's likely needed:** on mount, compute set differences between fork and current
  design output:
  - Rack View: `mapping.racks[*].devices[*].device_id` vs.
    `design.yaml.rack_layout[*].devices[*].device_id`
  - Links View: spines/leaves referenced in `cable_links.yaml.links[*].device_a/b.device_id`
    vs. the spines + leaves the new design produces
  Surface a banner with the diff (e.g. "Solver has 3 new devices since you forked: leaf-7,
  leaf-8, leaf-9. [Add them] [Reset to solver layout] [Dismiss]"). Add-them route drops
  them into the rack/link slot the solver picked, but flags conflicts when start_u or
  ports are taken.
- **Why open:** real but not blocking — single-user workflow usually iterates one direction
  (requirements → solver → racks/links → done). The drift case mostly bites when revisiting
  an older project.
- **Revisit:** after Phase 7 ships (Topology will hit the same shape); fold all three into
  a unified "regenerate-aware editing" pass.

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
