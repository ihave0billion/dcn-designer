import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import type { SolverWarning } from '@domain'

// Phase 10 — the one place validation state renders from. DesignView and
// SummaryView both import these so the two screens can never disagree on
// what "valid" looks like.

export function StatusPill({ valid }: { valid: boolean }) {
  return valid ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200 text-xs font-medium px-2.5 py-1">
      <CheckCircle2 className="size-3.5" />
      Design valid
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 text-destructive text-xs font-medium px-2.5 py-1">
      <XCircle className="size-3.5" />
      Design invalid
    </span>
  )
}

export function SeverityBadge({ severity }: { severity: SolverWarning['severity'] }) {
  if (severity === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-destructive/10 text-destructive text-xs font-medium px-1.5 py-0.5">
        <XCircle className="size-3" />
        error
      </span>
    )
  }
  if (severity === 'warn') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 text-xs font-medium px-1.5 py-0.5">
        <AlertTriangle className="size-3" />
        warn
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-muted text-muted-foreground text-xs font-medium px-1.5 py-0.5">
      info
    </span>
  )
}

// A one-line banner for screens that reference a design without rendering
// the full warnings table (Rack / Links / Topology / Summary headers).
export function ValidationBanner({
  warnings,
  onShowDetails
}: {
  warnings: SolverWarning[]
  onShowDetails?: () => void
}) {
  const errors = warnings.filter((w) => w.severity === 'error').length
  const warns = warnings.filter((w) => w.severity === 'warn').length
  if (errors === 0 && warns === 0) return null
  const tone =
    errors > 0
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : 'border-amber-300/60 bg-amber-100/60 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200'
  return (
    <div
      className={`flex items-center gap-2 border rounded-md px-3 py-2 text-sm ${tone}`}
      role="status"
    >
      {errors > 0 ? <XCircle className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}
      <span className="flex-1">
        {errors > 0
          ? `${errors} blocking error${errors === 1 ? '' : 's'}${warns > 0 ? ` and ${warns} warning${warns === 1 ? '' : 's'}` : ''} in the committed design.`
          : `${warns} warning${warns === 1 ? '' : 's'} in the committed design.`}
      </span>
      {onShowDetails && (
        <button
          onClick={onShowDetails}
          className="underline underline-offset-2 text-xs font-medium cursor-pointer shrink-0"
        >
          Details
        </button>
      )}
    </div>
  )
}
