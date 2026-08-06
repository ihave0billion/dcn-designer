import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useWorkspace } from '@/state/WorkspaceContext'
import { IS_WEB_BUILD } from '@/lib/runtime-target'

export function SettingsView() {
  const { workspacePath, setWorkspacePath } = useWorkspace()
  const [busy, setBusy] = useState(false)

  async function changeWorkspace() {
    setBusy(true)
    try {
      const def = await window.dcn.defaultWorkspacePath()
      const chosen = await window.dcn.showWorkspacePicker(workspacePath ?? def)
      if (chosen) await setWorkspacePath(chosen)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-auto p-8">
      <div className="max-w-3xl mx-auto space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Workspace folder</CardTitle>
            <CardDescription>
              Holds your library (switches, servers, optics) and all projects.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm">
              Current:{' '}
              <code className="px-1 py-0.5 rounded bg-muted text-foreground">
                {workspacePath || '(none)'}
              </code>
            </div>
            {IS_WEB_BUILD ? (
              <p className="text-sm text-muted-foreground">
                This workspace lives on the server and is shared by every browser that
                connects, so it can't be changed from here. Point the server at a
                different folder with the <code className="text-foreground">DCN_WORKSPACE</code>{' '}
                environment variable.
              </p>
            ) : (
              <Button onClick={changeWorkspace} disabled={busy} variant="outline">
                <FolderOpen />
                {busy ? 'Choosing…' : 'Change workspace folder'}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
