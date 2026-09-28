# Deploying DCN Designer

The app has two targets from one codebase:

- **Desktop** — the original Electron build (`npm run dev`, `npm run build`). Unchanged.
- **Web** — a self-hosted server + browser build, so the app is reachable from any
  laptop on the network without installing anything. This is what runs on the NAS.

## Where it runs today

| | |
|---|---|
| URL (LAN) | **<http://192.0.2.121/>** (port 80) |
| URL (anywhere) | **<https://dcn-designer.your-tailnet.ts.net/>** — Tailscale Funnel, no VPN client needed |
| Host | Unraid NAS (`ssh nas`), container on the `br0` macvlan |
| Container | `dcn-designer`, `--restart unless-stopped` |
| Workspace | `/mnt/user/appdata/dcn-designer` → `/data` in the container |
| Auth | Login page + server-side session (`DCN_AUTH_PASSWORD`); session cookie dies with the browser, 30 min idle / 12 h max by default; **Lock** in the top bar ends it now |

### Why a dedicated IP

It has to be a **low port**: the work MacBook's security software blocks outbound to high
ports. But the NAS host's own low ports are already spoken for — 80 and 443 are the Unraid
webGUI (nginx), and another service holds `192.0.2.83:443`.

So the container joins the `br0` macvlan and takes its own LAN address, `192.0.2.121`,
where port 80 is free. This is the same pattern the Hermes containers already use
(`.117`–`.120`).

Two consequences worth knowing:

- **The NAS host cannot reach `192.0.2.121`.** That's an inherent macvlan restriction, not
  a misconfiguration — a host can't talk to its own macvlan children. Health checks run from
  a laptop instead. Other machines on the LAN are unaffected.
### DHCP reservation

Reserve the address on the router so nothing else is ever handed it:

| | |
|---|---|
| IP | `192.0.2.121` |
| MAC | `02:42:xx:xx:xx:xx` |

The MAC is pinned explicitly by the deploy script (`--mac-address`), so it survives
redeploys and container recreates. Docker's macvlan driver would derive the same value
from the IP anyway (`02:42` + the IP in hex), but that's undocumented behaviour and the
reservation shouldn't depend on it. **If you change `DCN_LAN_IP`, keep `DCN_LAN_MAC` as
is — or update the router reservation to match.**

## Redeploying after a change

```bash
scripts/deploy-nas.sh
```

Builds the image locally, ships it over SSH, and restarts the container. The image is
deliberately **not** built on the NAS — a docker build there is enough load to wedge the
box, and Unraid has no `docker compose`, so the container runs via plain `docker run`.

## Public access — Tailscale Funnel

Since 2026-09-25 the app is also reachable from the internet at
**<https://dcn-designer.your-tailnet.ts.net/>** without a Tailscale client, the same
way SilverBullet is at `another-host.your-tailnet.ts.net`. The pieces:

| | |
|---|---|
| Sidecar | container `tailscale-dcn` (`tailscale/tailscale:latest`), `--restart unless-stopped`, on `br0` at `192.0.2.122`, `TS_USERSPACE=true`, state in the named volume `tailscale-dcn-state` |
| Tailnet node | `dcn-designer` (owner owner@) |
| Funnel | `tailscale funnel --bg http://192.0.2.121:80` — proxies to the app's LAN address; the config persists in the node state |

Why a second sidecar instead of adding to `tailscale-hermes`: Funnel only listens on
443/8443/10000 and the existing node's 443 is SilverBullet. A path prefix would break the
app's absolute `/assets` URLs, and 8443 is exactly the kind of high port the work laptop
blocks. A dedicated node gets its own hostname on 443.

Operate it from the NAS (or anything with its `docker.sock`):

```bash
docker exec tailscale-dcn tailscale funnel status          # what's exposed
docker exec tailscale-dcn tailscale funnel --https=443 off  # take it offline
docker exec tailscale-dcn tailscale funnel --bg http://192.0.2.121:80   # bring it back
```

If the container is ever recreated it needs to re-join: `docker exec tailscale-dcn tailscale login`
prints a URL; approve it in the admin console, then `tailscale set --hostname=dcn-designer`
and re-run the funnel command. Because the LAN-only assumption no longer holds, **always
deploy with `DCN_AUTH_PASSWORD` set** (below); the password lives only in the container's
environment (`docker inspect dcn-designer`).

## The workspace

Everything the app owns — the switch/server/optics library and every project — lives in
the bind-mounted workspace, in the same layout the desktop app uses on disk:

```
/mnt/user/appdata/dcn-designer/
├── library/          # switches.yaml, servers.yaml, optics/, …
│   └── visio/        # Phase 13 — extracted Cisco stencil masters + PNGs for the Visio export
├── projects/<name>/  # requirements.yaml, design.yaml, …
└── .uploads/         # scratch for browser uploads; safe to delete
```

Because the layout matches, a workspace is portable between desktop and web — copy the
folder either direction. **Back up this directory**; the image carries no state.

### Visio stencil assets (`library/visio/`)

The Visio export draws switches with official Cisco stencil masters. Those packs are
Cisco-copyrighted and 90+ MB each, so they are **not** in git or the image — only the
masters the library needs are extracted, offline, into the workspace:

```bash
# on the laptop (or any box with docker): downloads the Nexus 9000 pack, extracts the
# masters for every SKU in seed/switches.yaml + seed/ipn_routers.yaml, rasterises the
# EMF panels to PNG with LibreOffice, writes <out>/library/visio/
scripts/visio/fetch-stencils.sh ~/cisco-stencils            # → ~/cisco-stencils/nexus9000/*.vssx
scripts/visio/extract-in-docker.sh ~/cisco-stencils seed - /tmp/visio-out --clean
rsync -a /tmp/visio-out/library/visio/ nas:/mnt/user/appdata/dcn-designer/library/visio/
```

(`<stencil dir> <seed dir> <images dir|-> <out dir>`; pass a folder of `<sku>.png` product
photos as the third argument to bundle them.) `extract-masters.py` runs on plain python3 too
(PNGs need `soffice` on PATH).

**Server symbols (v1.4).** The Topology "Show servers" symbol and both exports use the UCS
pack's masters when the library server id matches one (`UCS-C220-M7` ≡ `UCS C220 M7
Front`, compact-key match); otherwise a generic grey server box is drawn and listed as a
substitution. cisco.com answers **403 to scripted downloads** of the UCS pack, so fetch
`unified-computing-system-hyperflex-systems.zip` from the Visio stencil listing in a browser,
unzip it next to the Nexus pack, and pass the seed dir as before — `extract-masters.py` also
reads `seed/servers.yaml` (`--servers`) when you run it by hand. Re-run when
Cisco publishes a new pack or a model is added to the library. Without the bundle the
export still works — every device is drawn as a schematic front panel and the Export tab
says so. Per-model overrides (`visio.master` / `visio.image`) live in the switch editor.

## Desktop vs. web differences

The renderer is identical; only the four native file dialogs have no browser equivalent:

| Desktop | Web |
|---|---|
| Pick any workspace folder | Server owns one workspace, shared by all browsers |
| Import project from a folder | Upload a **.zip** of the project folder |
| Pick a CSV to import | Ordinary file upload |
| Save CSV to a chosen path | Browser download |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DCN_WORKSPACE` | `~/DCN-Designer` | Workspace root. Every request path is jailed under it. |
| `PORT` | `8788` | Listen port. The NAS deployment sets it to `80`. |
| `DCN_LAN_IP` | `192.0.2.121` | Deploy script only — the container's macvlan address. |
| `DCN_AUTH_PASSWORD` | _(unset)_ | If set, browsers get a login page and a session cookie. HTTP Basic is no longer accepted. |
| `DCN_SESSION_IDLE_MIN` | 30 | Minutes without a request before the session is locked. |
| `DCN_SESSION_MAX_HOURS` | 12 | Absolute session lifetime regardless of activity. |
| `DCN_MAX_UPLOAD_BYTES` | 64 MiB | Upload size cap. |

### Auth is mandatory now

The app is internet-facing through the Funnel, so every redeploy must carry the shared
password or the new container comes up open. The deploy script only passes it through
when it is in the environment:

```bash
DCN_AUTH_PASSWORD="$(docker -H ssh://nas inspect dcn-designer --format '{{range .Config.Env}}{{println .}}{{end}}' | grep ^DCN_AUTH_PASSWORD= | cut -d= -f2-)" \
  scripts/deploy-nas.sh
```

(or just export the known password first).

### How the lock behaves (v1.2.1)

Sessions are server-side: a random token in an `HttpOnly; SameSite=Strict` cookie (plus
`Secure` behind the Funnel) with no expiry date, so the browser discards it when it closes.
The server also enforces an idle timeout and an absolute lifetime, and restarting the
container drops every session. Five wrong passwords lock that client out for a minute.

Two caveats worth knowing:

- Chrome's *"Continue where you left off"* startup option restores session cookies across a
  browser restart. The idle timeout still applies, so the window is at most
  `DCN_SESSION_IDLE_MIN` minutes.
- Basic auth was removed on purpose. Browsers replay Basic credentials silently for the
  rest of the browser session, and password managers sync them between machines — that is
  why the app once opened on a second laptop without asking. Scripts that need the API can
  `POST /api/login` with `{"password": "…"}` and reuse the returned cookie.

## Running the web target locally

```bash
npm run web          # build the bundle + serve on :8788
# or, with hot reload:
npm run dev:web:server    # API on :8788
npm run dev:web:client    # Vite on :5174, proxies /api
```
