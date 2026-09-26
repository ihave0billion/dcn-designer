import { describe, it, expect } from 'vitest'
import {
  SessionStore,
  clearedSessionCookie,
  passwordMatches,
  readCookie,
  sessionCookie
} from './sessions.ts'

function store(idleMin = 30, absHours = 12) {
  let t = 1_000_000
  const s = new SessionStore(
    { idleMs: idleMin * 60_000, absoluteMs: absHours * 3_600_000, now: () => t },
    { maxFailures: 3, lockoutMs: 60_000 }
  )
  return { s, tick: (ms: number) => (t += ms) }
}

describe('SessionStore', () => {
  it('validates a fresh token and rejects unknown ones', () => {
    const { s } = store()
    const tok = s.create()
    expect(tok).toHaveLength(64)
    expect(s.validate(tok)).toBe(true)
    expect(s.validate('nope')).toBe(false)
    expect(s.validate(null)).toBe(false)
  })

  it('expires after the idle window, but activity extends it', () => {
    const { s, tick } = store(30)
    const tok = s.create()
    tick(29 * 60_000)
    expect(s.validate(tok)).toBe(true) // touched at t+29m
    tick(29 * 60_000)
    expect(s.validate(tok)).toBe(true) // still within 30m of last touch
    tick(31 * 60_000)
    expect(s.validate(tok)).toBe(false)
    expect(s.size).toBe(0)
  })

  it('expires at the absolute limit even with constant activity', () => {
    const { s, tick } = store(30, 1)
    const tok = s.create()
    for (let i = 0; i < 5; i++) {
      tick(10 * 60_000)
      expect(s.validate(tok)).toBe(true)
    }
    tick(11 * 60_000) // 61 min since creation
    expect(s.validate(tok)).toBe(false)
  })

  it('reports remaining seconds as the nearer of idle and absolute', () => {
    const { s, tick } = store(30, 1)
    const tok = s.create()
    expect(s.remainingSeconds(tok)).toBe(30 * 60)
    tick(20 * 60_000)
    s.validate(tok)
    tick(20 * 60_000)
    s.validate(tok) // 40 min old, touched just now
    expect(s.remainingSeconds(tok)).toBe(20 * 60) // absolute cap (60 min) is closer than idle (30)
    expect(s.remainingSeconds('x')).toBe(0)
  })

  it('revoke and sweep drop sessions', () => {
    const { s, tick } = store(1)
    const a = s.create()
    const b = s.create()
    s.revoke(a)
    expect(s.validate(a)).toBe(false)
    tick(2 * 60_000)
    s.sweep()
    expect(s.size).toBe(0)
    expect(s.validate(b)).toBe(false)
  })

  it('locks a client after repeated failures, then releases', () => {
    const { s, tick } = store()
    expect(s.isLocked('1.2.3.4')).toBe(false)
    s.recordFailure('1.2.3.4')
    s.recordFailure('1.2.3.4')
    expect(s.isLocked('1.2.3.4')).toBe(false)
    s.recordFailure('1.2.3.4')
    expect(s.isLocked('1.2.3.4')).toBe(true)
    expect(s.isLocked('5.6.7.8')).toBe(false)
    tick(61_000)
    expect(s.isLocked('1.2.3.4')).toBe(false)
    s.recordFailure('1.2.3.4')
    s.recordSuccess('1.2.3.4')
    s.recordFailure('1.2.3.4')
    s.recordFailure('1.2.3.4')
    expect(s.isLocked('1.2.3.4')).toBe(false) // success reset the counter
  })
})

describe('helpers', () => {
  it('passwordMatches is exact', () => {
    expect(passwordMatches('abc', 'abc')).toBe(true)
    expect(passwordMatches('abc', 'abd')).toBe(false)
    expect(passwordMatches('ab', 'abc')).toBe(false)
    expect(passwordMatches('', '')).toBe(true)
  })

  it('readCookie picks one cookie out of a header', () => {
    expect(readCookie('a=1; dcn_session=tok%3D; b=2', 'dcn_session')).toBe('tok=')
    expect(readCookie('a=1', 'dcn_session')).toBeNull()
    expect(readCookie(undefined, 'x')).toBeNull()
  })

  it('cookies are HttpOnly, SameSite=Strict, session-scoped, Secure only over https', () => {
    expect(sessionCookie('t', false)).toBe('dcn_session=t; Path=/; HttpOnly; SameSite=Strict')
    expect(sessionCookie('t', true)).toMatch(/; Secure$/)
    expect(sessionCookie('t', true)).not.toMatch(/Max-Age|Expires/)
    expect(clearedSessionCookie(false)).toMatch(/Max-Age=0/)
  })
})
