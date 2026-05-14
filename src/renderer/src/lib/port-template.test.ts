import { describe, it, expect } from 'vitest'
import { expandPortTemplate, expandPortTemplateCount } from './port-template'

describe('expandPortTemplate', () => {
  it('expands a simple Eth1/{1..48} template', () => {
    const ports = expandPortTemplate('Eth1/{1..48}')
    expect(ports).toHaveLength(48)
    expect(ports[0]).toBe('Eth1/1')
    expect(ports[47]).toBe('Eth1/48')
  })

  it('handles 1-element ranges', () => {
    expect(expandPortTemplate('Mgmt/{1..1}')).toEqual(['Mgmt/1'])
  })

  it('handles uplink-style ranges like Eth1/{49..52}', () => {
    expect(expandPortTemplate('Eth1/{49..52}')).toEqual([
      'Eth1/49',
      'Eth1/50',
      'Eth1/51',
      'Eth1/52'
    ])
  })

  it('returns the template verbatim when no brace span is present', () => {
    expect(expandPortTemplate('MgmtA')).toEqual(['MgmtA'])
  })

  it('throws on multiple brace spans (out of scope for v1)', () => {
    expect(() => expandPortTemplate('Eth{1..2}/{1..4}')).toThrowError(
      /multiple brace spans/
    )
  })

  it('throws on inverted ranges', () => {
    expect(() => expandPortTemplate('Eth1/{10..1}')).toThrowError(/invalid range/)
  })
})

describe('expandPortTemplateCount', () => {
  it('counts without materialising', () => {
    expect(expandPortTemplateCount('Eth1/{1..64}')).toBe(64)
  })

  it('returns 1 for no-brace templates', () => {
    expect(expandPortTemplateCount('MgmtA')).toBe(1)
  })
})
