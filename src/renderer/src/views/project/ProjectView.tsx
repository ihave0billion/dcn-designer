import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useWorkspace } from '@/state/WorkspaceContext'
import { RequirementsFileSchema, type RequirementsFile, emptyRequirements } from '@/schemas/project'
import { RequirementsView } from './RequirementsView'

export function ProjectView() {
  const { currentProjectPath, openProject } = useWorkspace()
  const [req, setReq] = useState<RequirementsFile | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!currentProjectPath) return
    setLoading(true)
    const path = `${currentProjectPath}/requirements.yaml`
    window.dcn
      .readYaml(path)
      .then((raw) => {
        if (cancelled) return
        const parsed = RequirementsFileSchema.safeParse(raw)
        if (parsed.success) {
          setReq(parsed.data)
        } else {
          // Legacy/minimal requirements.yaml — fill in defaults and treat it as
          // a fresh load. Phase 1 wrote only `{schema_version, project}`.
          const rawObj = raw as { project?: unknown } | null
          const baseProject = rawObj?.project as { name?: string } | undefined
          if (baseProject?.name) {
            const filled = RequirementsFileSchema.safeParse(
              emptyRequirements({
                name: baseProject.name,
                customer: (rawObj?.project as { customer?: string } | undefined)?.customer ?? '',
                site: (rawObj?.project as { site?: string } | undefined)?.site ?? '',
                created:
                  (rawObj?.project as { created?: string } | undefined)?.created ??
                  new Date().toISOString(),
                last_edited:
                  (rawObj?.project as { last_edited?: string } | undefined)?.last_edited ??
                  new Date().toISOString()
              })
            )
            if (filled.success) setReq(filled.data)
            else setErr('requirements.yaml failed schema validation: ' + filled.error.message)
          } else {
            setErr('requirements.yaml failed schema validation: ' + parsed.error.message)
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentProjectPath])

  if (!currentProjectPath) return null

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-4 pb-3 border-b space-y-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => openProject(null)}>
            <ArrowLeft />
            All projects
          </Button>
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {req?.project.name ?? (loading ? '…' : 'Project')}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {req?.project.customer || 'No customer'}
            {req?.project.last_edited && ` · last edited ${formatDate(req.project.last_edited)}`}
            <span className="ml-2 font-mono opacity-60">{currentProjectPath}</span>
          </p>
        </div>
      </div>

      <Tabs defaultValue="requirements" className="flex-1 flex flex-col min-h-0">
        <div className="px-6 pt-3 border-b">
          <TabsList>
            <TabsTrigger value="requirements">Requirements</TabsTrigger>
            <TabsTrigger value="design" disabled>
              Design
            </TabsTrigger>
            <TabsTrigger value="rack" disabled>
              Rack View
            </TabsTrigger>
            <TabsTrigger value="links" disabled>
              Links
            </TabsTrigger>
            <TabsTrigger value="topology" disabled>
              Topology
            </TabsTrigger>
            <TabsTrigger value="summary" disabled>
              Summary
            </TabsTrigger>
            <TabsTrigger value="export" disabled>
              Export
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="requirements" className="flex-1 min-h-0 m-0">
          {err && <div className="px-6 py-3 text-sm text-destructive border-b">{err}</div>}
          {loading || !req ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <RequirementsView
              initial={req}
              projectPath={currentProjectPath}
              onSaved={setReq}
            />
          )}
        </TabsContent>
      </Tabs>
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
