import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useWorkspace } from '@/state/WorkspaceContext'

export function WorkspacePicker() {
  const { setWorkspacePath } = useWorkspace()
  const [defaultPath, setDefaultPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const isElectron = typeof window !== 'undefined' && Boolean(window.dcn)

  useEffect(() => {
    if (!isElectron) return
    window.dcn.defaultWorkspacePath().then(setDefaultPath).catch(() => {})
  }, [isElectron])

  async function pick() {
    if (!isElectron) {
      setErr('Workspace picker requires the desktop app — not available in browser preview.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const chosen = await window.dcn.showWorkspacePicker(defaultPath)
      if (!chosen) {
        setBusy(false)
        return
      }
      await setWorkspacePath(chosen)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="h-full flex items-center justify-center p-8">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Welcome to DCN Designer</CardTitle>
          <CardDescription>
            Choose a workspace folder. It will hold your library (switches, servers, optics)
            and all of your projects. You can change this later from Settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Suggested location:{' '}
            <code className="px-1 py-0.5 rounded bg-muted text-foreground">{defaultPath || '…'}</code>
          </div>
          <Button onClick={pick} disabled={busy}>
            <FolderOpen />
            {busy ? 'Choosing…' : 'Choose workspace folder'}
          </Button>
          {err && <div className="text-sm text-destructive">{err}</div>}
        </CardContent>
      </Card>
    </div>
  )
}
