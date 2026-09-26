import { describe, it, expect } from 'vitest'
import {
  applyNicknames,
  defaultHostname,
  deviceIndex,
  displayName,
  isSmartModel,
  modelNickname
} from './device-nickname'
import type { TopologyGraph } from './topology-extractor'

describe('modelNickname', () => {
  it('keeps the family suffix and drops the Nexus prefix', () => {
    expect(modelNickname('N9K-C9364D-GX2A')).toBe('gx2a')
    expect(modelNickname('9348GC-FX3')).toBe('fx3')
    expect(modelNickname('N9K-C9332D-GX2B')).toBe('gx2b')
    expect(modelNickname('N9364E-SP2R-O')).toBe('sp2r-o')
    expect(modelNickname('N3K-C3548P-XL')).toBe('xl')
  })
  it('smart switches are always smart-sw', () => {
    expect(modelNickname('N9348Y2C6D-SE1U', true)).toBe('smart-sw')
    expect(modelNickname('N9348Y2C6D-SE1U')).toBe('se1u') // without the flag
  })
  it('falls back sensibly', () => {
    expect(modelNickname('unknown')).toBe('sw')
    expect(modelNickname('FOO')).toBe('foo')
  })
})

describe('isSmartModel', () => {
  it('uses the library flag first, then the SE1U pattern', () => {
    expect(isSmartModel('N9324C-SE1U')).toBe(true)
    expect(isSmartModel('N9K-C9364D-GX2A')).toBe(false)
    expect(isSmartModel('N9K-C9364D-GX2A', new Set(['N9K-C9364D-GX2A']))).toBe(true)
  })
})

describe('defaultHostname / deviceIndex', () => {
  it('builds <nick>-<role><n>', () => {
    expect(defaultHostname('leaf', 12, 'N9348Y2C6D-SE1U', true)).toBe('smart-sw-leaf12')
    expect(defaultHostname('spine', 1, 'N9K-C9364D-GX2A')).toBe('gx2a-spine1')
    expect(defaultHostname('ipn', 2, 'N9K-C9332D-GX2B')).toBe('gx2b-ipn2')
  })
  it('reads the ordinal from the id, else the label', () => {
    expect(deviceIndex('leaf-12')).toBe(12)
    expect(deviceIndex('spine-3', 'Spine 3')).toBe(3)
    expect(deviceIndex('ghost', 'Leaf 7 (X)')).toBe(7)
    expect(deviceIndex('ghost', null)).toBe(0)
  })
})

describe('displayName', () => {
  it('replaces solver auto-labels, keeps user hostnames', () => {
    expect(
      displayName({ id: 'leaf-1', label: 'Leaf 1 (N9348Y2C6D-SE1U)', role: 'leaf', model_id: 'N9348Y2C6D-SE1U' }, true)
    ).toEqual({ label: 'smart-sw-leaf1', source: 'auto' })
    expect(
      displayName({ id: 'leaf-1', label: 'dc1-tor-01', role: 'leaf', model_id: 'N9348Y2C6D-SE1U' }, true)
    ).toEqual({ label: 'dc1-tor-01', source: 'user' })
    expect(displayName({ id: 'spine-2', label: '', role: 'spine', model_id: 'N9K-C9364D-GX2A' })).toEqual({
      label: 'gx2a-spine2',
      source: 'auto'
    })
  })
  it('leaves orphans alone', () => {
    expect(displayName({ id: 'leaf-9', label: 'leaf-9', role: 'leaf', model_id: 'unknown' })).toEqual({
      label: 'leaf-9',
      source: 'auto'
    })
  })
})

describe('applyNicknames', () => {
  it('rewrites labels and tags smart switches on a copy of the graph', () => {
    const graph: TopologyGraph = {
      nodes: [
        { id: 'spine-1', role: 'spine', model_id: 'N9K-C9364D-GX2A', rack: null, label: 'Spine 1 (N9K-C9364D-GX2A)', ru: null, power_w: null, usedPorts: [] },
        { id: 'leaf-1', role: 'leaf', model_id: 'N9348Y2C6D-SE1U', rack: null, label: 'Leaf 1 (N9348Y2C6D-SE1U)', ru: null, power_w: null, usedPorts: [] },
        { id: 'leaf-2', role: 'leaf', model_id: '9348GC-FX3', rack: null, label: 'edge-sw-b', ru: null, power_w: null, usedPorts: [] }
      ],
      edges: [],
      orphanDeviceIds: []
    }
    const out = applyNicknames(graph, new Set(['N9348Y2C6D-SE1U']))
    expect(out.nodes.map((n) => [n.label, n.smart, n.hostname_source])).toEqual([
      ['gx2a-spine1', false, 'auto'],
      ['smart-sw-leaf1', true, 'auto'],
      ['edge-sw-b', false, 'user']
    ])
    expect(graph.nodes[0].label).toBe('Spine 1 (N9K-C9364D-GX2A)') // input untouched
  })
})
