# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Active work: DCN Designer (GUI app)

The successor to the v8 calculator is being built as a desktop GUI app — **read [PROJECT_PLAN.md](PROJECT_PLAN.md) first** at the start of any new session. It is the source of truth for decisions, the phased build plan, and the session log.

The project is intentionally split across multiple sessions to avoid context rot. One phase per session. Find the first `pending` phase in PROJECT_PLAN.md's Phase Plan table, work only that phase to its acceptance criteria, then update the status and append a session-log entry before stopping.

The v8 spreadsheet calculator (described below) is the source of seed data (`Hardware_Ref` → `hardware.yaml`) and rule provenance (the 13 hard rules carry forward into the solver). The spreadsheet itself is frozen — the app replaces it.

## What this is (v8 spreadsheet — legacy / seed data)

A Cisco Data Center spine-leaf design calculator built as an Excel workbook. The "code" is Python (openpyxl) build scripts that emit `.xlsx` files; the artifact handed to Cisco SEs and customers is the workbook itself. There is no application — every formula, validation, and tab is authored from Python.

Versions are frozen and ship as `DCN_Spine_Leaf_Calculator_v{N}.xlsx`. The active build is **v8** at the repo root. The `Deliverables/` folder is where new versions are written. The README still references v4–v6 + per-version build scripts (`v5_build.py`, `v6_finalize2.py`, etc.) — those originated in a Cowork session and **have not been imported here yet**. Confirm with the user before assuming any script exists; offer to recreate it from the current `.xlsx` if needed.

This is not a git repo yet. Before any non-trivial change, ask whether to `git init` and tag the existing v8 as a baseline.

## The xlsx build workflow (load-bearing)

The skill `anthropic-skills:xlsx` is the right tool any time a `.xlsx` is the input or output — trigger it explicitly. Every version follows the same shape:

1. **Build/modify** `Hardware_Ref`, `Lists`, and per-tab formulas via an openpyxl Python script. Save as `DCN_Spine_Leaf_Calculator_v{N}.xlsx` in `Deliverables/`.
2. **Recalc** with the xlsx skill's `scripts/recalc.py` (runs LibreOffice headless). This populates cached formula values and **must report zero errors**. If formulas error, fix them before continuing.
3. **Finalize** by post-processing the `.xlsx` zip to strip LibreOffice metadata that triggers Excel's "we found a problem with some content" dialog:
   - Remove `docProps/custom.xml` part.
   - Strip the matching `<Override>` in `[Content_Types].xml`.
   - Strip the matching `<Relationship>` in `_rels/.rels`.
   - Strip `<extLst>` blocks and the `xmlns:loext` namespace from `xl/workbook.xml`.
   - Remove empty `<workbookProtection/>`.
   - Re-verify all XML parses.
4. **Sanity-open** in Excel (or describe to the user how to verify) — the cleanliness pass is the step that's easy to skip and breaks the deliverable.

The finalize step is non-obvious and is the most common regression. Treat it as part of every build, not as an afterthought.

## Hard rules (carry-over from PROMPT_IMPROVEMENT_FEEDBACK.md)

These constraints are non-negotiable unless the user explicitly overrides them:

1. Use **every** switch in `Hardware_Ref`. Do not add models without instruction.
2. Defaults must produce **DESIGN VALID** on first open of every tab — ship a working example, no empty-cell error states.
3. `recalc.py` must report 0 errors.
4. Run the Excel-cleanliness finalize after every recalc.
5. Visible tabs ≤ 10. `Lists` stays hidden. (Current v8 tabs: Instructions, Hardware_Ref, Dashboard, AI_HPC_NonBlocking, Capacity_Estimator, Spine_Calc, Optics, Validation, RU_Rack, Lists.)
6. Color legend: yellow + blue text = input; gray = formula; green = key result; peach = warning.
7. Spines NEEDED = `MAX(2, calculated)`. HA minimum is non-negotiable.
8. **XOR rule:** Endpoint Count and Switch Count cannot both be filled on the same row.
9. Oversubscription is **computed**, never a user input. The user adjusts inputs until the computed value matches their target.
10. 1:1 oversub design lives only on the `AI_HPC_NonBlocking` tab.
11. Optic SKUs are flagged "verify against current Cisco data sheet" except for verified pairs (currently `QDD-400G-BD ↔ QSFP-100G-SR1.2`).
12. File naming: `DCN_Spine_Leaf_Calculator_v{N}.xlsx`. **Never modify a prior version** — they are frozen.
13. Uplink auto-pick: when a leaf has both primary and secondary uplinks, use whichever group has higher per-port speed and show the choice in a "Uplink Type" column on each design tab.

## Step 0 — clarifying questions

Before starting any new version or substantial change, ask up to 4 clarifying questions covering anything that could block completion (target tabs, hardware additions, customer-specific deltas, naming). The original task prompt explicitly requires this — do not skip it.

## Domain quick-reference

- **Hardware_Ref columns**: Model, Primary Ports, Port Speed (G), Uplink Ports, Uplink Speed (G), Sec Uplink Ports, Sec Uplink Speed (G), RU, Role (Leaf/Spine/Both), Category, Optic Type Hint, Notes.
- **Dashboard** is the standard / oversubscribed fabric design tab. `AI_HPC_NonBlocking` enforces 1:1.
- **Spine count** is `MAX(2, capacity-driven, spine-touching-driven, port-count-driven)` — three independent constraints, then HA floor.
- **Uplinks per leaf** and **uplinks per spine** are user inputs; `Unique Spines per Leaf = uplinks_per_leaf / uplinks_per_spine` (must divide evenly or the design is flagged BAD).
- **Optics tab** covers three scenarios: S1 400G↔400G (1:1), S2 400G↔100G direct (1:1, only for verified optic pairs), S3 400G→4×100G breakout (4:1, reduces spine count).
- **Breakout-valid indicator** on Dashboard: when a non-breakout design fails but breakout cables would make it valid, surface that.

## Common commands

```bash
# inside Claude Code, install the xlsx skill once per environment
/plugin marketplace add anthropic-skills
/plugin install xlsx@anthropic-skills

# typical inspection of the active workbook
python3 -c "import openpyxl; wb=openpyxl.load_workbook('DCN_Spine_Leaf_Calculator_v8.xlsx', data_only=False); print(wb.sheetnames)"

# recalc + error-check (path comes from the installed xlsx skill)
python3 ~/.claude/plugins/anthropic-skills/xlsx/scripts/recalc.py Deliverables/DCN_Spine_Leaf_Calculator_v9.xlsx
```

There is no test suite, lint, or build system beyond the build script for the current version. "Tests" = `recalc.py` reports zero errors + Excel opens the file without the recovery dialog.

## Customer forks

For customer-specific calculators, branch from a tagged version (e.g. `git checkout -b customer/<name> v8`) so the master baseline stays clean. The legacy `Spine Port Calculator - LMCO Deer Creek...` workbook (referenced in the README but currently absent from the directory) is the template pattern for a per-customer review sheet.
