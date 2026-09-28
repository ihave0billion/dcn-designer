import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, utimesSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DownloadStage, TTL_MS, downloadMime, safeDownloadName } from './downloads.ts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dcn-downloads-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('DownloadStage', () => {
  it('stages bytes under a token and resolves them back byte for byte', async () => {
    const stage = new DownloadStage(dir)
    const bytes = new Uint8Array([1, 2, 3, 250])
    const { token, name } = await stage.stage(bytes, 'site-a-topology-2026-09-28.vsdx')
    expect(name).toBe('site-a-topology-2026-09-28.vsdx')
    const abs = stage.resolve(token, name)
    expect(abs).not.toBeNull()
    expect(new Uint8Array(readFileSync(abs!))).toEqual(bytes)
  })

  it('strips directory components from the requested name', async () => {
    const stage = new DownloadStage(dir)
    const { name } = await stage.stage(new Uint8Array([0]), '../../etc/passwd')
    expect(name).toBe('passwd')
    expect(safeDownloadName('a/b/../c d.pdf', 'x')).toBe('c d.pdf')
    expect(safeDownloadName('', 'x')).toBe('x')
    expect(safeDownloadName('..', 'x')).toBe('x')
  })

  it('refuses unknown tokens, malformed tokens and mismatched names', async () => {
    const stage = new DownloadStage(dir)
    const { token, name } = await stage.stage(new Uint8Array([0]), 'design.pdf')
    expect(stage.resolve('not-a-token', name)).toBeNull()
    expect(stage.resolve('../' + token, name)).toBeNull()
    expect(stage.resolve(token, 'other.pdf')).toBeNull()
    expect(stage.resolve(token, '')).toBeNull()
    expect(stage.resolve(token, '..')).toBeNull()
    expect(stage.resolve(token, '.')).toBeNull()
  })

  it('sweeps folders older than the TTL and keeps fresh ones', async () => {
    const stage = new DownloadStage(dir)
    const old = await stage.stage(new Uint8Array([0]), 'old.pdf')
    const fresh = await stage.stage(new Uint8Array([0]), 'fresh.pdf')
    const past = (Date.now() - TTL_MS - 60_000) / 1000
    utimesSync(join(dir, old.token), past, past)
    expect(await stage.sweep()).toBe(1)
    expect(existsSync(join(dir, old.token))).toBe(false)
    expect(stage.resolve(fresh.token, fresh.name)).not.toBeNull()
  })

  it('reports nothing to sweep when the directory does not exist yet', async () => {
    expect(await new DownloadStage(join(dir, 'missing')).sweep()).toBe(0)
  })
})

describe('downloadMime', () => {
  it('maps the three export types and falls back to octet-stream', () => {
    expect(downloadMime('x.pdf')).toBe('application/pdf')
    expect(downloadMime('x.VSDX')).toBe('application/vnd.ms-visio.drawing')
    expect(downloadMime('x.csv')).toBe('text/csv; charset=utf-8')
    expect(downloadMime('x.bin')).toBe('application/octet-stream')
  })
})
