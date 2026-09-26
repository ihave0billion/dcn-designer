import { randomBytes, timingSafeEqual } from 'node:crypto'

// Server-side login sessions for the self-hosted web target (v1.2.1).
//
// Replaces HTTP Basic auth. Basic auth has no logout and no timer: once a
// browser has sent the password it re-sends it on every request until the
// browser process exits, and password managers sync those credentials
// between machines — which is how the app "just opened" on a second laptop.
//
// A session is a random token in an HttpOnly cookie with NO Max-Age, so the
// browser drops it when it closes, plus two server-side clocks:
//   idle     — no request for this long → session gone (default 30 min)
//   absolute — session older than this → gone regardless (default 12 h)
// Restarting the server clears every session.
//
// Pure module: the clock is injectable so the behaviour is unit-testable.

export interface SessionOptions {
  idleMs: number
  absoluteMs: number
  now?: () => number
}

interface Session {
  createdAt: number
  lastSeenAt: number
}

export interface LoginAttemptOptions {
  maxFailures: number
  lockoutMs: number
}

// Plain fields rather than constructor parameter properties: the server runs
// on Node's strip-only TypeScript mode, which rejects the latter.
export class SessionStore {
  private readonly sessions = new Map<string, Session>()
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>()
  private readonly now: () => number
  private readonly opts: SessionOptions
  private readonly attempts: LoginAttemptOptions

  constructor(
    opts: SessionOptions,
    attempts: LoginAttemptOptions = { maxFailures: 5, lockoutMs: 60_000 }
  ) {
    this.opts = opts
    this.attempts = attempts
    this.now = opts.now ?? (() => Date.now())
  }

  create(): string {
    const token = randomBytes(32).toString('hex')
    const t = this.now()
    this.sessions.set(token, { createdAt: t, lastSeenAt: t })
    return token
  }

  /** True if the token is live; touching it extends the idle window. */
  validate(token: string | null | undefined): boolean {
    if (!token) return false
    const s = this.sessions.get(token)
    if (!s) return false
    const t = this.now()
    if (t - s.lastSeenAt > this.opts.idleMs || t - s.createdAt > this.opts.absoluteMs) {
      this.sessions.delete(token)
      return false
    }
    s.lastSeenAt = t
    return true
  }

  revoke(token: string | null | undefined): void {
    if (token) this.sessions.delete(token)
  }

  /** Seconds until this session dies if nothing else happens (idle or absolute, whichever first). */
  remainingSeconds(token: string | null | undefined): number {
    if (!token) return 0
    const s = this.sessions.get(token)
    if (!s) return 0
    const t = this.now()
    const idleLeft = this.opts.idleMs - (t - s.lastSeenAt)
    const absLeft = this.opts.absoluteMs - (t - s.createdAt)
    return Math.max(0, Math.floor(Math.min(idleLeft, absLeft) / 1000))
  }

  /** Drop expired sessions (called opportunistically; validate() also expires lazily). */
  sweep(): void {
    const t = this.now()
    for (const [token, s] of this.sessions) {
      if (t - s.lastSeenAt > this.opts.idleMs || t - s.createdAt > this.opts.absoluteMs) {
        this.sessions.delete(token)
      }
    }
  }

  get size(): number {
    return this.sessions.size
  }

  // ── Login attempt throttling (per client key, e.g. IP) ──────────────

  isLocked(key: string): boolean {
    const f = this.failures.get(key)
    if (!f) return false
    if (f.lockedUntil > this.now()) return true
    if (f.lockedUntil) this.failures.delete(key)
    return false
  }

  recordFailure(key: string): void {
    const f = this.failures.get(key) ?? { count: 0, lockedUntil: 0 }
    f.count += 1
    if (f.count >= this.attempts.maxFailures) {
      f.lockedUntil = this.now() + this.attempts.lockoutMs
      f.count = 0
    }
    this.failures.set(key, f)
  }

  recordSuccess(key: string): void {
    this.failures.delete(key)
  }
}

/** Constant-time password compare so the shared password can't be probed by timing. */
export function passwordMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Read one cookie from a Cookie header. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export const SESSION_COOKIE = 'dcn_session'

/** Set-Cookie value for a live session. No Max-Age → dies with the browser. */
export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}

export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`
}
