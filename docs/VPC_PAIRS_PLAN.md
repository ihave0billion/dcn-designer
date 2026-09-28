# Phase 14 — vPC leaf pairs, peer-links, and server symbols (BUILT — v1.4.0, 2026-09-28)

Interviewed and approved 2026-09-28 (one question at a time); built the same day on
`feat/vpc-pairs`. Every decision below is the user's; do not re-ask.

**Built as planned, with two refinements found on the real SITE-A workspace:**

- **Decision 3, default peer-link group.** The SITE-A's second tier (9348GC-FX3: 2×100G
  uplinks + 4×25G secondary uplinks) cannot hold 2 spine uplinks *and* a 2-port
  peer-link in its 100G group — the literal rule zeroed its uplinks and invalidated
  the whole design. `peerLinkGroupFor()` therefore takes the fastest uplink group
  only when it still has room for the configured uplinks; otherwise a **non-smart**
  leaf's peer-link moves to its other uplink group (FX3 → Eth1/49-50 at 25G, both
  100G ports stay for the spines). **Smart switches never leave their 400G ports**
  (SE1U → Eth1/49-50 at 400G); if that costs uplinks the solver reduces them and
  warns, exactly as decision 5 says. The library `peer_link_ports` template still
  overrides everything.
- **Per-tier opt-out (user, 2026-09-28, after seeing the FX3 case): "the FX3 tier will
  not be vPC'd."** `tiers[].vpc_pairs: false` (Requirements → tier table → vPC checkbox)
  keeps a tier out of pairing altogether: no pairs, no odd-leaf warning, no peer-link
  reservation, per-leaf server symbols. The group fallback below stays as a safety net.
- **UCS masters (decision 10).** The resolver matches server ids by a compact key
  (`UCS-C220-M7` ≡ `UCS C220 M7 Front` ≡ `UCSC-C220-M7 Front`) and
  `extract-masters.py --servers seed/servers.yaml` extracts them. cisco.com answers
  403 to curl but serves the packs to a real browser: both packs were downloaded
  through the laptop's automation Chrome (v1.4.1) and the bundle was rebuilt with the
  UCS masters (C220 M7 / C240 M7 match; the M8 and AI servers have no master in the
  2025 pack and draw as the generic box, reported as a substitution).

## Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | **Fabric mode** | New project-wide field in **Requirements**: `fabric.mode` = `nxos-classic` \| `nxos-evpn` \| `aci`. Default **`nxos-evpn`**; existing projects (SITE-A) load as `nxos-evpn` with the peer-link ON. Semantics: classic → peer-link port-channel mandatory; EVPN → peer-link optional (default on), port-channel optional (default on); ACI → no peer-link, no port-channel, pairs are logical only. |
| 2 | **Pairing rule** | Pairs come from the solver's existing two-leaves-per-pair-index placement (`pod_index` in `src/domain/rack.ts`, two per rack). Pairs are **editable per pair** (re-pick members) from Rack View or Links. An odd leaf out is **flagged, not paired**. |
| 3 | **Peer-link ports** | New **per-model library field** on switches (`peer_link_ports`, e.g. `Eth1/{49..50}`). Default = the **first two ports of the uplink group** (best practice: spine uplinks are taken from the LAST uplink ports first). **Smart switches must use the first 400G ports, never the 100G ones** (SE1U: Eth1/49-50 of the 6×400G group, not the 2-port secondary group). |
| 4 | **Peer-link size** | **Adjustable per project, default 2** members (1–4) at the port's native speed. Port-channel mandatory in classic, optional (default on) in EVPN, absent in ACI. |
| 5 | **Uplink budget** | Solver **reduces uplinks per leaf** to what remains after the peer-link reservation, re-runs the spine math, and emits a **warning** that the peer-link consumed ports. |
| 6 | **Where peer-links appear** | **Everywhere, optics included:** Cable Links table with `kind: 'vpc-peer-link'`, distinct colour on the topology tab and in Visio/PDF (red `#B85450`, the skill's peer-link colour), rows in the cable BOM with their optics counted. |
| 7 | **Server symbol** | Topology-tab checkbox **"Show servers"**. Draws **one symbol per leaf** (single-attached) or **one per vPC pair** (dual-attached); mode follows the fabric setting. Never one tile per real server. |
| 8 | **Server label + links** | Symbol shows the tier's **server model and NIC speed** from the library; **one line per NIC** (two for dual-attached: one to each leaf of the pair); **no port labels** on server lines. |
| 9 | **Exports** | Servers and peer-links flow into **both the PDF Topology page and the Visio export** from the same scene. The checkbox state is **saved in `topology_layout.yaml`** so exports always match the screen. |
| 10 | **Visio server symbol** | **UCS stencil master when the library server model matches** one (UCS pack, 225 masters — extend `scripts/visio/extract-masters.py` to take `--servers seed/servers.yaml` + the UCS pack), **generic server box otherwise**; reported as a substitution like switches. |
| 11 | **ACI pairs** | **Pair bracket, no link:** leaves of a pair share a bracket / joint label on the topology and in exports; no line between them. |
| 12 | **vPC extras** | **None.** No keepalive note, no domain id, no orphan ports. Just pairing, peer-link, server symbol. |

## Touch points (for the implementing session)

- **Schemas:** `schemas/project.ts` `FabricSchema` gains `mode`, `peer_link_members` (default 2), `peer_link_port_channel` (default true; forced by mode). `schemas/switches.ts` gains `peer_link_ports: string | null` (port template). `schemas/cable-links.ts` gains `kind: 'uplink' | 'vpc-peer-link' | 'server'` (default `uplink` for old files). New per-project `leaf_pairs.yaml` fork file (same auto-fork pattern as rack_mapping / cable_links / topology_layout): `pairs[{ id, members: [leafA, leafB] }]`, `source: solver|user`. `schemas/topology-layout.ts` gains `show_servers: boolean`.
- **Domain:** `src/domain/rack.ts` pairing already exists (`pod_index = floor(i/2)`); expose it as pairs. Solver: reserve peer-link ports before computing uplinks per leaf (decision 5) — new warning code. ACI mode: no reservation.
- **Seeder:** `lib/cable-links-seeder.ts` also seeds peer-links per pair (members × native speed, ports from the library field / default rule) when mode ≠ aci.
- **Topology:** `lib/topology-extractor.ts` must stop assuming a spine on every edge (use `kind`); `lib/topology-hierarchy.ts` scene gains pair brackets, peer-link edges (red), server nodes (tier 3) when `show_servers`. TileRenderer: server glyph; pair bracket at devices level.
- **Exports:** `lib/pdf/topology-scene.ts` and `lib/visio/topology-visio.ts` consume the same scene: red peer-link lines, server symbols (UCS master / generic box), pair brackets. `resolve-model.ts` extended to servers (UCS masters land in the same `library/visio/` bundle).
- **BOM:** `lib/cable-bom.ts` counts peer-links (same-rack 3 m rule) and their optics.
- **Library UI:** `SwitchEditDialog` gets the peer-link ports field (placeholder = default rule).
- **Tests:** solver reservation + warning, seeder peer-links per mode, extractor with non-spine edges, scene brackets/servers, PDF/Visio geometry, BOM rows. Extend the fs-backed e2e (`export-visio.e2e.test.ts`) — SITE-A in EVPN mode must export 2×400G peer-links on Eth1/49-50 of every SE1U pair.

## Out of scope

Peer-keepalive, vPC domain ids, orphan ports, per-server tiles, port labels on server lines.
