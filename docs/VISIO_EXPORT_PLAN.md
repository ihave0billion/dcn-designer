# Phase 13 — Native Visio export of the expanded topology (+ PDF topology rework)

Written 2026-09-26. Source evaluation: `ihave0billion/claude-visio-diagrams` (the
Visio skill). Companion rows: PROJECT_PLAN.md phase table (13) and session log.

## Goal

The Export tab gains **Export Visio topology**: a native, editable `.vsdx` of the
fully expanded (device-level) topology as drawn on the Topology tab — every spine,
leaf and IPN router at its on-screen position (auto layout or the user's saved
drag positions), every link, port labels, nickname hostnames — using official
Cisco stencil masters where one exists and a generated schematic front panel
where none does. No AI in the loop; everything is deterministic from
`design.yaml` + `cable_links.yaml` + `topology_layout.yaml` + the library.

The PDF report's Topology page is reworked to draw from the **same scene
geometry**, so the PDF and the Visio can never disagree (closes the v1.1
"rework the PDF SVG, then delete `topology-elk-layout.ts`" item).

## Decisions (with the evidence)

| Decision | Why |
|---|---|
| **Port the Python builder to TypeScript, client-side** (option B) rather than a Python sidecar | Keeps the single export code path that serves web + Electron; matches the app's canvas; no runtime deps. The Python builder is 510 stdlib lines of OPC/XML templating — the value is the Visio-compat lessons, not the language. |
| **No LibreOffice in the app image** | Measured 2026-09-26 in `alpine:3.21`: 885 MiB installed; `.vsdx→pdf` 3 s cold / 2 s warm; `emf→png` 1 s. It works, but the image ships laptop→NAS over SSH on every deploy, headless soffice needs serialised calls (profile lock), and it buys nothing under option B (PDF already comes from react-pdf). |
| **LibreOffice IS used offline, once per stencil pack**, to rasterise EMF masters to PNG | It is the only thing that can render EMF. The PNGs feed the PDF topology page and any in-app preview. Runs on the laptop or in a throw-away Docker container (`scripts/visio/extract-in-docker.sh`). |
| **Stencil assets live in the workspace, not in git or the image** | Cisco publishes the packs free but keeps copyright; the Nexus pack alone is 90 MB. Only the masters the library uses are extracted (8 Nexus masters = 28.6 MB raw, 2.7 MB deflated; a `.vsdx` is a zip so they stay small in the output). Folder: `<workspace>/library/visio/`. |
| **Per-model resolution order** | explicit `visio.master` → exact `"<id> Front"` in the index → alias table (`93180YC-FX3 → 93180YC-FX`, same port layout) → product photo PNG (`visio.image` or `images/<id>.png`) → **generated schematic panel**. Every non-exact hit is logged and shown in the Export tab. |
| **Schematic panel = native Visio group shape** built from the library's port groups | Covers the 9 library SKUs with no master (SE1U, 93108TC-FX3, 9348D-GX2A, 93600CD-GX, 9316D-GX, 9336C-SE1, 9396Y12C-SE1, 9396T12C-SE1, 9364E-SG2) and any future model. No copyright, editable, same look in PDF. |
| Units | Page at **1:12 drawing scale on 17×11 in paper** (landscape tabloid). Geometry in drawing inches, origin bottom-left, `x,y` = shape centre pin. Font sizes and line weights are **paper points** (verified against the Cisco masters' ShapeSheets: `Size F='12PT*User.AntiScale*10'`). A 1RU switch is 19 in wide. |
| Scene → drawing scale | `IN_PER_PX = 0.25` (tile 124 px → 31 in; a 19 in chassis fits with 6 in margins; tier gap 150 px → 37.5 in). Positions come from the same map the Topology tab uses (auto `layoutScene` overridden by `topology_layout.yaml` scene positions). |
| One Visio page per fabric/pod at the device level, plus an overview page when there is more than one fabric | Mirrors the Topology tab drill-down levels. Single-fabric designs get one page. |

## Asset bundle — `<workspace>/library/visio/`

Produced by `scripts/visio/extract-masters.py` (Python 3 stdlib; optional
`soffice` + ImageMagick for PNGs). Re-run when Cisco ships a new pack
(`scripts/visio/fetch-stencils.sh`, ported from the skill).

```
library/visio/
  index.json
  masters/<slug>/entry.xml        # the <Master …> element from masters.xml (ID is re-assigned at build time)
  masters/<slug>/master.xml       # masterN.xml part, verbatim
  masters/<slug>/master.xml.rels  # its rels part, verbatim (targets rewritten at build time)
  masters/<slug>/media/<file>     # image69.emf, … (original names)
  masters/<slug>/front.png        # rasterised + trimmed (only when soffice was available)
  images/<sku>.png                # product photos (from the skill's reference/images)
```

`index.json` (schema_version 1):

```json
{
  "schema_version": 1,
  "generated_at": "2026-09-26T…Z",
  "packs": [{ "family": "nexus9000", "file": "Switches - Cisco Nexus 9000.vssx", "sha256": "…" }],
  "masters": {
    "N9K-C9364D-GX2A Front": {
      "slug": "n9k-c9364d-gx2a-front",
      "width_in": 19.0, "height_in": 3.45,
      "media": ["image69.emf"],
      "png": "masters/n9k-c9364d-gx2a-front/front.png"
    }
  },
  "aliases": { "N9K-C93180YC-FX3": "N9K-C93180YC-FX Front" },
  "images": { "N9348Y2C6D-SE1U": "images/N9348Y2C6D-SE1U.png" }
}
```

Slug = master name lower-cased, non-alphanumerics → `-`.

## Code layout

```
src/renderer/src/lib/visio/
  vsdx-writer.ts        port of visio_builder.py: Diagram/Page, drop/box/line/text/image, save() → Uint8Array (fflate)
  master-store.ts       loads index.json + master parts through window.dcn (readTextFile / readBinaryFile), caches
  resolve-model.ts      resolution order above → { kind: 'master'|'image'|'schematic', … , note }
  schematic-panel.ts    port-group data → Visio group shape (chassis + port grid), also the PDF glyph geometry
  topology-visio.ts     PURE: TopologyVisioInput → drawing ops (unit-tested, no I/O)
  export-visio.ts       orchestration: load → resolve → build → { bytes, substitutions[] }
src/renderer/src/lib/topology-scene-positions.ts   shared: resolveScenePositions(scene, layoutFile, orientation) — extracted from TopologyView
src/renderer/src/lib/pdf/topology-scene-svg.ts     replaces topology-svg.ts: scene geometry → SVG boxes/PNG panels for react-pdf
scripts/visio/extract-masters.py, fetch-stencils.sh, extract-in-docker.sh
```

`TopologyVisioInput` (the contract between the UI and the pure mapper):

```ts
interface TopologyVisioInput {
  projectName: string; customer: string; generatedAt: string
  pages: Array<{
    title: string                       // "Fabric 1 — devices" / "All fabrics"
    nodes: Array<{ id: string; label: string; sublabel: string | null; role: 'spine'|'leaf'|'ipn'|null;
                   x: number; y: number  // scene px (tile top-left, TILE_W × TILE_H)
                   panel: ResolvedPanel  // master | image | schematic
                   smart: boolean }>
    edges: Array<{ id: string; source: string; target: string; count: number; speeds: number[]; label: string;
                   ports: Array<{ a: string; b: string }> }>  // per cable link, for port labels
    orientation: 'vertical' | 'horizontal'
  }>
}
```

## Adapter change (all four)

`readBinaryFile(filePath): Promise<Uint8Array>` — server `GET /api/read-binary?path=`
(jailed by `resolveInRoot`, same shape as `PUT /api/write-binary`), `http-dcn.ts`,
Electron `main`/`preload`, dev mock. Text parts (`index.json`, `*.xml`) go through
the existing `readTextFile`.

## Library schema change

`SwitchSchema` gains `visio: { master: string | null, image: string | null }`
(default both null; also on `ipn_routers.yaml` entries). Library UI: two optional
fields on the switch editor with the current resolution shown read-only
("Exact stencil master" / "Alias of …" / "Product photo" / "Schematic panel").

## Drawing rules (from the skill's design system, applied to the tile scene)

- Device = front panel (master/photo/schematic) centred on the tile position, 19 in
  wide for 1RU; label pill **above** spines/IPNs and **below** leaves (as on screen).
- Links: straight lines device-edge to device-edge, fabric colour `#0070C0`,
  weight 0.014 (1 pt); IPN links dashed (`LinePattern 2`). Count/speed label at the
  line's midpoint offset, port labels at the endpoints (never mid-line).
- Colours/legend/title block: title, project, customer, date, generator note
  ("DCN Designer vX — positions from Topology tab") on every page; a legend box;
  substitutions listed in a notes box bottom-right.
- Never draw servers. No customer-identifying data beyond what the project holds.
- Validation before save: every link endpoint touches a panel rectangle; no
  panel/label bounding-box overlaps (report, don't silently ship).

## Verification

1. Unit tests: writer package structure (content types, rels, docProps, windows.xml,
   page units `U='IN'`, no empty `<Text/>`), `topology-visio` geometry, schematic
   panel port counts, resolver order, PDF scene layout. Target ≥ 20 new tests.
2. Structural check: `python3 <skill>/scripts/vsdx_scene.py` + `preview_svg.py`
   parse the output; overlap report empty.
3. LibreOffice render in Docker (`scripts/visio/render-check.sh`) → PDF + PNG,
   eyeballed.
4. **Real Visio on the work MacBook** — the only true compatibility test. If it
   fails, bisect with a shrinking file set (the skill's `visio_open_bisect.py`).
5. GUI pass: export from the running web build, open the `.vsdx` from `exports/`.

## Work split

- **A — assets:** `extract-masters.py` + docker wrapper; run it → `library/visio/`
  for the current library (8 Nexus masters, alias table, product photos).
- **B — builder:** `vsdx-writer.ts`, `schematic-panel.ts`, `topology-visio.ts` +
  tests + a Node smoke script that writes a real file from the asset dir.
- **C — plumbing:** `readBinaryFile` on four adapters, `visio` schema field +
  Library UI, `resolveScenePositions` extraction, `master-store`/`resolve-model`/
  `export-visio`, Export tab button + substitutions panel, `ensureWorkspace` creates
  `library/visio/`.
- **D — PDF rework:** Topology page on the scene geometry with PNG panels;
  delete `topology-svg.ts` and `topology-elk-layout.ts`.

## Out of scope (later, if wanted)

- The skill's draw.io-style **Physical** (spines left/right, leaf column) and
  **Logical** pages as extra Visio pages (`fabric_layout.py` port).
- Rack elevation page (Cisco `R42610 Front` master).
- A Visio-faithful PDF (would need a separate LibreOffice render sidecar).
