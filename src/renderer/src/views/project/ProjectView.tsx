import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/state/WorkspaceContext'
import { RequirementsFileSchema, type RequirementsFile } from '@/schemas/project'

export function ProjectView() {
  const { currentProjectPath, openProject } = useWorkspace()
  const [req, setReq] = useState<RequirementsFile | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!currentProjectPath) return
    const path = `${currentProjectPath}/requirements.yaml`
    window.dcn
      .readYaml(path)
      .then((raw) => {
        const parsed = RequirementsFileSchema.safeParse(raw)
        if (parsed.success) setReq(parsed.data)
        else setErr('requirements.yaml failed schema validation: ' + parsed.error.message)
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [currentProjectPath])

  if (!currentProjectPath) return null

  return (
    <div className="h-full overflow-auto p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => openProject(null)}>
            <ArrowLeft />
            All projects
          </Button>
        </div>
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            {req?.project.name ?? '…'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {req?.project.customer || 'No customer'}
            {req?.project.last_edited && ` · last edited ${formatDate(req.project.last_edited)}`}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            <code>{currentProjectPath}</code>
          </p>
        </header>
        {err && <div className="text-sm text-destructive">{err}</div>}
        <section className="rounded-md border bg-muted/30 p-6">
          <h2 className="text-sm font-medium">Coming in later phases</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Requirements form, design generation, rack view, topology, cable links, and PDF export
            land in phases 3–9. For now this project view confirms the create / open / import
            lifecycle works.
          </p>
        </section>
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}
