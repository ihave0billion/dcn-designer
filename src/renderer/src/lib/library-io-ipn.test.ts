import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { IpnRoutersFileSchema } from '@domain'
import { installMockDcn } from '../dev/install-mock-dcn'
import { ipnRouterSpecFromFileEntry, libraryIpnRoutersPath, loadIpnRouters } from './library-io'

// Phase 9b follow-up: the browser-preview mock must serve ipn_routers.yaml
// (previously absent), or the Requirements IPN-router picker is empty and the
// multi-pod solver can't pick a router in preview. installMockDcn only needs a
// `window` object, so we stub globalThis.window (no jsdom required in this node
// vitest env).
describe('mock window.dcn serves ipn_routers.yaml', () => {
  const WS = '/mock-workspace'

  beforeAll(() => {
    ;(globalThis as unknown as { window: Record<string, unknown> }).window = {}
    installMockDcn()
  })

  afterAll(() => {
    delete (globalThis as unknown as { window?: unknown }).window
  })

  it('reports the file as existing under the workspace library', async () => {
    const exists = await window.dcn.fileExists(libraryIpnRoutersPath(WS))
    expect(exists).toBe(true)
  })

  it('loadIpnRouters returns the seeded routers (non-empty, schema-valid)', async () => {
    const routers = await loadIpnRouters(WS)
    expect(routers.length).toBeGreaterThan(0)
    // The raw payload must satisfy the same schema the loader enforces.
    const raw = await window.dcn.readYaml(libraryIpnRoutersPath(WS))
    expect(IpnRoutersFileSchema.safeParse(raw).success).toBe(true)
  })

  it('every entry projects cleanly to an IpnRouterSpec', async () => {
    const specs = (await loadIpnRouters(WS)).map(ipnRouterSpecFromFileEntry)
    expect(specs.every((s) => s.id.length > 0 && s.primary.ports > 0 && s.primary.speed_g > 0)).toBe(
      true
    )
    expect(specs.every((s) => s.capabilities.multipod === true)).toBe(true)
  })
})
