import { describe, expect, it } from 'vitest'
import { resolveModel, masterNameFor } from './resolve-model'
import type { VisioIndex } from './master-store'

const index: VisioIndex = {
  schema_version: 1,
  generated_at: '2026-09-26T00:00:00Z',
  packs: [],
  masters: {
    'N9K-C9364D-GX2A Front': { slug: 'a', width_in: 19, height_in: 3.4, media: ['image69.emf'] },
    'N9K-C93180YC-FX Front': { slug: 'b', width_in: 19, height_in: 1.7, media: ['image1.emf'] },
    'N9K-93600CD-GX Front': { slug: 'c', width_in: 19, height_in: 1.7, media: ['image2.emf'] }
  },
  aliases: { 'N9K-C93180YC-FX3': 'N9K-C93180YC-FX Front' },
  images: { 'N9348Y2C6D-SE1U': 'images/N9348Y2C6D-SE1U.png' }
}

describe('resolveModel', () => {
  it('prefers the exact master and carries no note', () => {
    const r = resolveModel('N9K-C9364D-GX2A', null, index)
    expect(r).toEqual({ kind: 'master', masterName: masterNameFor('N9K-C9364D-GX2A'), exact: true, note: null })
  })

  it('matches a pack name that spells the family prefix differently', () => {
    const r = resolveModel('N9K-C93600CD-GX', null, index)
    expect(r).toEqual({ kind: 'master', masterName: 'N9K-93600CD-GX Front', exact: true, note: null })
    expect(resolveModel('9348GC-FX3', null, { ...index, masters: { 'N9K-C9348GC-FX3 Front': index.masters['N9K-C93180YC-FX Front'] } })).toMatchObject({ kind: 'master', masterName: 'N9K-C9348GC-FX3 Front' })
  })

  it('falls back to the alias table with a note', () => {
    const r = resolveModel('N9K-C93180YC-FX3', null, index)
    expect(r.kind).toBe('master')
    if (r.kind === 'master') {
      expect(r.masterName).toBe('N9K-C93180YC-FX Front')
      expect(r.exact).toBe(false)
      expect(r.note).toMatch(/same port layout/)
    }
  })

  it('uses the product photo when there is no master', () => {
    const r = resolveModel('N9348Y2C6D-SE1U', null, index)
    expect(r).toMatchObject({ kind: 'image', imagePath: 'images/N9348Y2C6D-SE1U.png' })
  })

  it('draws a schematic when nothing matches, and says why', () => {
    expect(resolveModel('N9K-C9316D-GX', null, index)).toMatchObject({ kind: 'schematic' })
    expect(resolveModel('N9K-C9364D-GX2A', null, null).note).toMatch(/no stencil bundle/)
  })

  it('honours a library master override, and reports a stale one', () => {
    const ok = resolveModel('N9K-C9316D-GX', { master: 'N9K-C9364D-GX2A Front' }, index)
    expect(ok).toMatchObject({ kind: 'master', masterName: 'N9K-C9364D-GX2A Front', exact: false })
    const stale = resolveModel('N9K-C9316D-GX', { master: 'Nope Front' }, index)
    expect(stale.kind).toBe('schematic')
    expect(stale.note).toMatch(/not in the stencil bundle/)
  })

  it('library image override beats the bundled photo', () => {
    const r = resolveModel('N9348Y2C6D-SE1U', { image: 'images/custom.png' }, index)
    expect(r).toMatchObject({ kind: 'image', imagePath: 'images/custom.png' })
  })
})

describe('compact-key match (Phase 14 servers)', () => {
  it('finds the UCS pack master for a servers.yaml id', async () => {
    const { compactKey, findMasterName } = await import('./resolve-model')
    expect(compactKey('UCS-C220-M7')).toBe('C220M7')
    expect(compactKey('C220 M7 Front')).toBe('C220M7')
    expect(compactKey('UCSC-C240-M7 Front')).toBe('C240M7')
    const index = { masters: { 'C220 M7 Front': {}, 'C220 M7 Bezel': {}, 'N9K-C9364D-GX2A Front': {} }, aliases: {}, images: {} } as unknown as Parameters<typeof findMasterName>[1]
    expect(findMasterName('UCS-C220-M7', index)).toBe('C220 M7 Front')
    expect(findMasterName('UCS-C240-M8', index)).toBeNull()
  })
})
