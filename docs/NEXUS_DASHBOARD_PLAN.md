# Phase 17 — Nexus Dashboard cluster (BUILT — v1.7.0, 2026-09-28)

User request (2026-09-28, verbatim intent): *"add a place in the Requirements tab
to add ND-CLUSTER-G5S or ND-CLUSTER-G5L to a design, and show that ND cluster in
the topology by default when selected. Show the ND cluster connected with data
links to leaf switches, and management links to the OOB-management network; if
the design does not have OOB switches in it, draw it to a cloud instead. The SITE-B
project is the one that gets the cluster."*

Built without an interview (the request was specific); every choice below that the
user did not state is marked **assumption** and listed in the session recap.

## Facts the design rests on (Cisco ND 4.x deployment guide, hardware guide)

| | ND-CLUSTER-G5S | ND-CLUSTER-G5L |
|---|---|---|
| Node PID | ND-NODE-G5S (UCS C225 M8 base) | ND-NODE-G5L |
| Nodes per cluster PID | 3 (a 1-node cluster is also supported) | 3 |
| Data network | 2 of the VIC's 4 × 10/25/50G ports: `fabric0` + `fabric1`, Linux bond0 **active-standby**, best practice one cable to each leaf of a pair | same |
| Management network | `mgmt0` + `mgmt1` (mLOM), bond1 active-standby, **1G or 10G, both the same** | same |
| RU | 1 | 2 (**assumption**: NetBox device type lists 2U; hardware guide gives no figure) |

Sources: cisco.com ND 4.1.x "Deploying as a physical appliance" (port combinations
Port-1/Port-3 … for fabric0/fabric1; "connect each of the interfaces to a different
switch"; bonds active-standby), ND hardware setup guide for ND-NODE-G5S, NetBox
device-type library (RU), TravTeks comparison (cluster PIDs).

## Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | **Where it lives** | Requirements → new **Nexus Dashboard** card: cluster PID (none / ND-CLUSTER-G5S / ND-CLUSTER-G5L), node count (3 default, 1 allowed), data link speed (10 / **25** / 50G), management link speed (1 / **10**G), leaf pair to attach to (auto = first vPC pair of the first data tier). Saved as `requirements.nexus_dashboard`. |
| 2 | **Catalogue, not library** | The two cluster PIDs are a code catalogue (`src/domain/nexus-dashboard.ts`), not `servers.yaml` entries: they must not appear in the tier server-model dropdown, and existing workspaces never re-copy seeds. RU / node PID / port names come from the catalogue. |
| 3 | **What "OOB switches" means** | New per-tier checkbox **OOB mgmt** (`tiers[].oob_management`, default off). A tier ticked OOB is the out-of-band management network: the ND `mgmt0/mgmt1` cables land on the first pair (or first two leaves) of that tier. **No tier ticked → the management links go to an "OOB management network" cloud** (device id `oob-mgmt`). **Assumption:** the SITE-B 1G FX3 tier is NOT ticked by default — the user decides. |
| 4 | **Data links** | Per node: `fabric0` → leaf A, `fabric1` → leaf B of the attach pair (a single leaf takes both when the tier has no pair). Leaf side = first free host (primary-group) ports. Seeded as `cable_links[].kind: 'nd-data'` at the chosen data speed; a note is raised when the leaf's host speed differs. |
| 5 | **Management links** | Per node: `mgmt0` → OOB leaf A, `mgmt1` → OOB leaf B (`kind: 'nd-mgmt'`, mgmt speed), or to the `oob-mgmt` cloud endpoint (port `OOB`) when no OOB tier exists. Cloud links still exist as cable links so the BOM lists the cables (uncosted: no far rack). |
| 6 | **Rack placement** | The nodes (`nd-1..N`, role `nd`) go into the rack of the attach pair's first leaf, top-of-rack packed after the leaves, falling back to any rack with room. Placement happens inside `placeRacks` so every candidate (single / multi-pod, breakout) carries them. |
| 7 | **Topology** | Shown **always** (no toggle) when a cluster is selected: at *All fabrics* the nodes fold into the fabric globe and the cloud is an external tile; at *fabric* level a stacked **Nexus Dashboard** tile; at *devices* level one tile per node in a row under the leaves (tier 3, below the server slot), the cloud under them (tier 4), a labelled cluster bracket around the nodes. Data lines cyan (fabric link colour), management lines dashed muted. Node details panel = the normal device panel; cloud panel explains how to land the links on switches. |
| 8 | **Exports** | Same scene → PDF Topology page (node chassis rectangles in a teal role colour, cloud drawn as an ellipse, dashed management lines, bracket) and Visio (`server-box` panel for a node, a new `cloud` panel, dashed management lines, cluster bracket, legend rows). Design summary and Summary tab get a "Nexus Dashboard" stat. BOM: node rows (`nd`, `ND-NODE-G5x` × N, RU) with a footnote naming the cluster PID; ND cables and their transceivers on the cable/optics BOM (`Nexus Dashboard` side, SFP28 / SFP+ hints). |
| 9 | **Links tab** | ND links are listed with their own kind chips and are read-only like peer-links (their ports follow the Nexus Dashboard card); media/optic PIDs can still be set through the CSV round-trip. |
| 10 | **Hostnames** | Auto nickname `g5s-nd1` / `g5l-nd2` (same scheme as `gx2a-spine1`); the cloud is `OOB management network`. |

## Touch points

- **Domain:** `types.ts` (`NexusDashboardRequest`, `NexusDashboardResult`, `TierRequest.oob_management`, `TierResult.oob_management`, role `'nd'`, warning `ND_ATTACH_LEAVES_NOT_FOUND`), new `nexus-dashboard.ts` (catalogue + `planNexusDashboard`), `rack.ts` (`placeRacks(..., nd)`), `multipod.ts` (thread `nd` into every `placeRacks` call), `solver.ts`, `index.ts`.
- **Schemas:** `project.ts` (`NexusDashboardSchema`, `tiers[].oob_management`), `cable-links.ts` (`nd-data`, `nd-mgmt`), `rack-mapping.ts` (`nd`).
- **Seeder:** `cable-links-seeder.ts` — ND data + management links after the peer-links.
- **Topology:** `topology-extractor.ts` (role `nd`, synthetic `oob` cloud node, `OOB_MGMT_DEVICE_ID`), `topology-hierarchy.ts` (fabric `ndIds`, ND group tile, cloud tile, edge kinds, cluster bracket, layout tiers 3/4), `device-nickname.ts`, `TopologyView.tsx` (glyphs, edge styles, legend, cloud details).
- **BOM:** `device-bom.ts` (nd rows, cluster PID), `cable-bom.ts` + `optics-bom.ts` (kinds, `nd` side, hints, cloud ends skipped), `cable-links-csv.ts` (nd kinds + `oob-mgmt` endpoint).
- **Exports:** `pdf/topology-scene.ts`, `pdf/DesignReport.tsx`, `pdf/styles.ts`, `visio/export-visio.ts`, `visio/topology-visio.ts`.
- **UI:** `RequirementsView.tsx` (card + tier checkbox + nav entry), `LinksView.tsx`, `RackView.tsx`, `SummaryView.tsx`, `ExportView.tsx` (RU for ND models).
- **Tests:** domain plan/placement, seeder (pair / no-pair / cloud / OOB tier), extractor, hierarchy (three levels + layout), PDF scene, BOMs, CSV.

## Out of scope

ND virtual (vND) deployments, ND service sizing, the ND cluster's own L3 details
(VLANs, gateways), per-node CIMC cabling, a fourth standby node.
