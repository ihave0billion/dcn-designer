# DCN Spine-Leaf Calculator — working with Claude Code

This folder holds the Cisco Data Center spine-leaf design calculator built across multiple sessions in Cowork. This README explains how to continue the work in **Claude Code** (the terminal-first CLI agent) instead of Cowork.

The two surfaces share the same tools and plugin/skill ecosystem, so anything Cowork built here, Claude Code can extend.

---

## Folder map

```
claude-spine-leaf-calculator/
├── DCN_Spine_Leaf_Calculator.xlsx              # original draft (frozen)
├── DCN_Spine_Leaf_Calculator_v2.xlsx           # frozen
├── DCN_Spine_Leaf_Calculator_v3.xlsx           # frozen baseline used for v4
├── DRAFT DCN Spine-Leaf Calculator.xlsx        # 25-switch Hardware_Ref source
├── Spine Port Calculator - LMCO Deer Creek...  # earlier customer-specific calc
├── promp1.md                                   # the original prompt that started v4
├── README.md                                   # this file
└── Deliverables/
    ├── DCN_Spine_Leaf_Calculator_v4.xlsx       # frozen
    ├── DCN_Spine_Leaf_Calculator_v5.xlsx       # frozen
    ├── DCN_Spine_Leaf_Calculator_v6.xlsx       # active — uplink auto-pick + Excel-clean
    └── PROMPT_IMPROVEMENT_FEEDBACK.md          # v4 -> v5 -> v6 deltas + carry-over prompt for v7
```

The build scripts that produced v5/v6 (`v5_build.py`, `v5_dashboard.py`, `v5_calc_tabs.py`, `v5_ru_rack.py`, `v6_build.py`, `v6_finalize2.py`, etc.) are NOT yet checked in here — they currently live in the Cowork session's temporary outputs folder. First task in Claude Code should be to copy them over and `git init` so the work is versioned.

---

## 1. Install Claude Code

Pick whichever fits your setup:

```bash
# macOS (homebrew)
brew install anthropic/claude/claude-code

# or via npm
npm install -g @anthropic-ai/claude-code

# or download installer
# see https://docs.claude.com/en/docs/claude-code/setup
```

Then authenticate once:

```bash
claude login
```

If your Cisco SSO is set up as the auth method, follow the prompts. Otherwise you'll get an API-key flow.

---

## 2. Point Claude Code at this folder

```bash
cd "~/Library/CloudStorage/OneDrive-Cisco/Documents/Development/claude-spine-leaf-calculator"
claude
```

That drops you into an interactive Claude Code session anchored on this directory. Everything in the folder is accessible to the agent (same as the workspace folder concept in Cowork).

If you want it to track git, run this first:

```bash
git init
git add .
git commit -m "import calculator artifacts from cowork"
```

Then each version becomes a tagged commit:

```bash
git tag v4
git tag v5
git tag v6
```

---

## 3. Install the skills you need

The xlsx work depends on the `anthropic-skills` plugin marketplace. From inside Claude Code:

```
/plugin marketplace add anthropic-skills
/plugin install xlsx@anthropic-skills
```

Optional but recommended for related work:

```
/plugin install pdf@anthropic-skills
/plugin install docx@anthropic-skills
/plugin install pptx@anthropic-skills
```

Verify with `/plugin list` — you should see `xlsx` (and any others) marked installed.

The skill provides:
- Best-practice guidance the agent reads when it sees a `.xlsx` task.
- `scripts/recalc.py` — runs LibreOffice headless to compute formulas + report errors. **This is what we use to validate every build.**
- `scripts/office/soffice.py` — handles LibreOffice setup on first run.

---

## 4. The build pattern (carried from v6)

This is the workflow that produced v6. Every future version should follow the same shape:

```text
1. Modify Hardware_Ref / Lists / per-tab formulas via openpyxl Python script.
2. Save the .xlsx.
3. Run scripts/recalc.py to populate cached values + flag any formula errors.
4. Post-process the .xlsx zip to strip LibreOffice metadata
   (so Excel doesn't show the "we found a problem with some content" dialog).
5. Verify zip structure: all XML well-formed, no orphan refs, no loext namespace.
6. Commit. Update PROMPT_IMPROVEMENT_FEEDBACK.md with delta + next-version prompt.
```

The Excel-cleanliness post-processing is the non-obvious step. The fix is in `outputs/v6_finalize2.py` from the Cowork session — once you copy that file into this folder, you can re-run it directly:

```bash
python3 v6_finalize2.py
```

It does:
- Removes `docProps/custom.xml` part.
- Strips matching `<Override>` from `[Content_Types].xml`.
- Strips matching `<Relationship>` from `_rels/.rels`.
- Strips `<extLst>` blocks and `xmlns:loext` from `xl/workbook.xml`.
- Strips empty `<workbookProtection/>`.
- Verifies all XML still parses.

Treat this as a standard post-recalc step for every version.

---

## 5. Hard rules carried forward (from PROMPT_IMPROVEMENT_FEEDBACK.md)

When extending the calculator:

1. Use every switch from v6 `Hardware_Ref`. Don't add models without explicit instruction.
2. Defaults must produce DESIGN VALID at first open of every tab.
3. `scripts/recalc.py` must report 0 errors.
4. After recalc, run the Excel-cleanliness pipeline (step above).
5. Visible tabs ≤ 10. `Lists` stays hidden.
6. Color legend: yellow + blue text = input; gray = formula; green = key result; peach = warning.
7. Spines NEEDED = MAX(2, calculated). HA minimum non-negotiable.
8. XOR rule: Endpoint Count + Switch Count cannot both be filled per row.
9. Oversubscription is COMPUTED, never a target input.
10. 1:1 oversub design lives only on the AI_HPC_NonBlocking tab.
11. Optic SKUs must be flagged "verify against current Cisco data sheet" except verified pairs (currently `QDD-400G-BD ↔ QSFP-100G-SR1.2`).
12. File naming: `DCN_Spine_Leaf_Calculator_v{N}.xlsx`. Don't modify previous versions — treat them as frozen.
13. Uplink auto-pick: when a leaf has both primary and secondary uplinks, use whichever group has higher per-port speed. Show the choice in a "Uplink Type" column on each design tab.

---

## 6. Quick session-start prompt

When you start a new Claude Code session in this folder, paste this to anchor it on the existing work:

```text
Please read PROMPT_IMPROVEMENT_FEEDBACK.md and the latest version
(DCN_Spine_Leaf_Calculator_v6.xlsx) in the Deliverables folder. Use the
v7 carry-over prompt at the bottom of the feedback doc as the starting
point. The hard rules in the README must be honored. Before any work,
ask up to 4 clarifying questions per Step 0.
```

That gives the agent enough context to keep continuity with the Cowork sessions.

---

## 7. Day-to-day commands you'll use most

```bash
# start the agent in this folder
claude

# inside the session, useful slash commands:
/plugin list                         # show installed plugins/skills
/agents                              # list available agents (Plan, Explore, etc.)
/clear                               # reset context if it gets cluttered
/init                                # create a CLAUDE.md (project-level instructions)
/review                              # review pending changes before committing

# git from inside Claude Code (just regular shell)
git status
git diff Deliverables/
git tag v7 -m "uplink-bundle support, cabling BOM"
```

---

## 8. When to use Cowork vs. Claude Code for this project

| Situation | Better in |
|-----------|-----------|
| Iterating on a calculator while a customer is on Webex | **Cowork** (chat-first, fast turnarounds) |
| Versioning, branching, merging customer-specific forks | **Claude Code** (git-native) |
| Reviewing diffs in VS Code while editing | **Claude Code** (IDE integration) |
| Showing off the calculator with rendered widgets/visualizations | **Cowork** |
| Long automated runs (build, recalc, validate, commit, repeat) | **Claude Code** (better at multi-step CLI loops) |
| Quick file format conversions or one-off tasks | Either — pick the surface you have open |

Both surfaces share the same skill ecosystem. Anything you build in one transfers to the other — the artifacts are just `.xlsx` files in this folder.

---

## 9. Tips for your specific role (Cisco Cloud + AI Solutions Engineer)

- For customer-specific forks, branch from a tagged version (`git checkout -b customer/lmco-deer-creek v6`) so the master baseline stays clean.
- The `Spine Port Calculator - LMCO Deer Creek Sunnyvale Waterton.xlsx` already in this folder is a good template for "convert v6 into a per-customer worksheet for an account team review."
- AI-pod presets (256 / 1024 / 4096 GPU @ 400G non-blocking) are flagged as a v7 candidate in the feedback doc — that's likely the next high-value extension for AI infrastructure conversations.
- The `N9164E-NS4-O` (Spectrum-4) and 800G family are already in `Hardware_Ref` — when a customer asks "what about a Hyperfabric-based AI fabric?" the calculator can size it without any changes.
