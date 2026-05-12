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

### 2026-05-12 — Patch-panel dropdown when breakout pairs have connector mismatch
- **Context:** Phase 2 solver emits `BREAKOUT_PATCH_PANEL_NEEDED` when the verified breakout
  pair's spine_connector ≠ leaf_connector (e.g. `QDD-400G-SR4.2` MPO-12 ↔ `QSFP-100G-SR1.2`
  LC). User explicitly asked for a dropdown to pick the patch panel SKU at this point. The
  warning surfaces in the solver output today; the UI piece is deferred to Cable Links.
- **What's likely needed:** a `seed/patch_panels.yaml` library file with curated MPO↔LC
  cassette / breakout-module SKUs, plus a "Patch Panel" dropdown in the Cable Links manager's
  New Link form whenever the chosen spine + leaf optics imply a connector change. The dropdown
  should default to a sensible cassette and persist into `cable_links.yaml`.
- **Why open:** the dropdown UI doesn't exist yet (Cable Links manager arrives in Phase 6).
- **Revisit:** Phase 6 (Cable Links manager) — design `patch_panels.yaml` and the dropdown
  together.

### 2026-05-12 — When does the "any updates to switches?" prompt fire?
- **Context:** User asked the app to prompt for switch library updates "near the beginning of the
  user's workflow." Default-parked at: banner on project-open with skip / "review library"
  buttons.
- **Why open:** UI location isn't built yet; touches Requirements screen flow.
- **Revisit:** Phase 3 (Requirements screen).

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
