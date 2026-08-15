// Phase 10 — keyboard shortcuts.
//
// All shortcuts are single unmodified keys (Linear/GitHub style) so they
// never collide with browser or OS chords — important because the web build
// runs inside a browser that owns Ctrl/Cmd+digit, Ctrl+D, etc. The price is
// that they must never fire while the user is typing, hence the guard.

/** True when the event originates from something that accepts text input. */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target
  if (!(t instanceof HTMLElement)) return false
  if (t.isContentEditable) return true
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** True when the key press is a bare key we may claim as a shortcut. */
export function isPlainShortcutKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  return !isTypingTarget(e)
}

export interface ShortcutRow {
  keys: string
  action: string
}

export const GLOBAL_SHORTCUTS: ShortcutRow[] = [
  { keys: 'g', action: 'Go to Projects (home)' },
  { keys: 'l', action: 'Go to Library' },
  { keys: ',', action: 'Go to Settings' },
  { keys: 't', action: 'Toggle light / dark theme' },
  { keys: '?', action: 'Show this help' }
]

export const PROJECT_SHORTCUTS: ShortcutRow[] = [
  { keys: '1 – 7', action: 'Jump to a project tab (Requirements … Export)' },
  { keys: '[ / ]', action: 'Previous / next project tab' }
]
