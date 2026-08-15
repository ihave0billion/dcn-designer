import { useCallback, useEffect, useState } from 'react'
import { FolderInput, FolderPlus, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useWorkspace } from '@/state/WorkspaceContext'
import type { DcnProjectListEntry } from '../../../../preload/types'
import { CreateProjectDialog } from './CreateProjectDialog'

export function SplashView() {
  const { workspacePath, openProject } = useWorkspace()
  const [projects, setProjects] = useState<DcnProjectListEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspacePath) return
    setLoading(true)
    try {
      const list = await window.dcn.listProjects(workspacePath)
      // Most-recent first (PROJECT_PLAN splash spec); never-edited projects sink.
      setProjects(
        [...list].sort((a, b) => (b.last_edited ?? '').localeCompare(a.last_edited ?? ''))
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function importProject() {
    if (!workspacePath) return
    setErr(null)
    try {
      const source = await window.dcn.showImportPicker()
      if (!source) return
      const dst = await window.dcn.importProject(workspacePath, source, true)
      await refresh()
      openProject(dst)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  if (!workspacePath) return null

  return (
    <div className="h-full overflow-auto p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Workspace:{' '}
              <code className="px-1 py-0.5 rounded bg-muted text-foreground">{workspacePath}</code>
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={importProject}>
              <FolderInput />
              Import
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <FolderPlus />
              Create
            </Button>
          </div>
        </header>

        {err && (
          <div className="text-sm text-destructive border border-destructive/40 rounded-md p-3 bg-destructive/10">
            {err}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading projects…</div>
        ) : projects.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 flex flex-col items-center text-center gap-3">
              <FileText className="size-10 text-muted-foreground" />
              <div>
                <div className="text-base font-medium">No projects yet</div>
                <div className="text-sm text-muted-foreground mt-1">
                  Create a new project or import an existing one to get started.
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <button
                key={p.path}
                onClick={() => openProject(p.path)}
                className="text-left cursor-pointer"
              >
                <Card className="hover:border-primary transition-colors h-full">
                  <CardHeader>
                    <CardTitle className="truncate">{p.name}</CardTitle>
                    <CardDescription className="truncate">
                      {p.customer || 'No customer'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    {p.last_edited ? `Last edited ${formatDate(p.last_edited)}` : '—'}
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        )}

        <CreateProjectDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          workspacePath={workspacePath}
          onCreated={async (path) => {
            await refresh()
            openProject(path)
          }}
        />
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
