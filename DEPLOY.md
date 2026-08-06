# Deploying DCN Designer

The app has two targets from one codebase:

- **Desktop** — the original Electron build (`npm run dev`, `npm run build`). Unchanged.
- **Web** — a self-hosted server + browser build, so the app is reachable from any
  laptop on the network without installing anything. This is what runs on the NAS.

## Where it runs today

| | |
|---|---|
| URL | <http://192.0.2.83:8789/> |
| Host | Unraid NAS (`ssh nas`) |
| Container | `dcn-designer`, `--restart unless-stopped` |
| Workspace | `/mnt/user/appdata/dcn-designer` → `/data` in the container |
| Auth | none — LAN only (see below) |

Port 8789 because 8788 is taken by `bookshelf-audio`.

## Redeploying after a change

```bash
scripts/deploy-nas.sh
```

Builds the image locally, ships it over SSH, and restarts the container. The image is
deliberately **not** built on the NAS — a docker build there is enough load to wedge the
box, and Unraid has no `docker compose`, so the container runs via plain `docker run`.

## The workspace

Everything the app owns — the switch/server/optics library and every project — lives in
the bind-mounted workspace, in the same layout the desktop app uses on disk:

```
/mnt/user/appdata/dcn-designer/
├── library/          # switches.yaml, servers.yaml, optics/, …
├── projects/<name>/  # requirements.yaml, design.yaml, …
└── .uploads/         # scratch for browser uploads; safe to delete
```

Because the layout matches, a workspace is portable between desktop and web — copy the
folder either direction. **Back up this directory**; the image carries no state.

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
| `PORT` | `8788` | Listen port inside the container. |
| `DCN_AUTH_PASSWORD` | _(unset)_ | If set, requires HTTP Basic auth (any username). |
| `DCN_MAX_UPLOAD_BYTES` | 64 MiB | Upload size cap. |

### Before exposing it beyond the LAN

The deployment is currently **unauthenticated**, which is fine for a trusted home
network and nothing more. Anyone who can reach the port can read and edit every design.
Set a password and redeploy before putting it on Tailscale or anything internet-facing:

```bash
DCN_AUTH_PASSWORD='something-long' scripts/deploy-nas.sh
```

## Running the web target locally

```bash
npm run web          # build the bundle + serve on :8788
# or, with hot reload:
npm run dev:web:server    # API on :8788
npm run dev:web:client    # Vite on :5174, proxies /api
```
