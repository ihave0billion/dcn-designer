import { useEffect, useState } from 'react'
import { Sidebar, type SidebarRoute } from './components/Sidebar'
import { ThemeToggle } from './components/ThemeToggle'
import { useTheme } from './components/ThemeProvider'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from './components/ui/dialog'
import { useWorkspace } from './state/WorkspaceContext'
import {
  GLOBAL_SHORTCUTS,
  PROJECT_SHORTCUTS,
  isPlainShortcutKey,
  type ShortcutRow
} from './lib/shortcuts'
import { WorkspacePicker } from './views/splash/WorkspacePicker'
import { SplashView } from './views/splash/SplashView'
import { ProjectView } from './views/project/ProjectView'
import { LibraryView } from './views/library/LibraryView'
import { SettingsView } from './views/SettingsView'

export function App() {
  const { ready, workspacePath, currentProjectPath } = useWorkspace()
  const { toggleTheme } = useTheme()
  const [route, setRoute] = useState<SidebarRoute>('home')
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    function onNav(e: Event) {
      const detail = (e as CustomEvent<{ route?: SidebarRoute }>).detail
      if (detail?.route) setRoute(detail.route)
    }
    window.addEventListener('dcn-designer:nav', onNav)
    return () => window.removeEventListener('dcn-designer:nav', onNav)
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!isPlainShortcutKey(e)) return
      switch (e.key) {
        case 'g':
          setRoute('home')
          break
        case 'l':
          setRoute('library')
          break
        case ',':
          setRoute('settings')
          break
        case 't':
          toggleTheme()
          break
        case '?':
          setHelpOpen((v) => !v)
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleTheme])

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (!workspacePath) {
    return <WorkspacePicker />
  }

  return (
    <div className="h-full flex bg-background text-foreground">
      <Sidebar activeId={route} onSelect={setRoute} />
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b flex items-center justify-end px-3 gap-2">
          <ThemeToggle />
        </header>
        <section className="flex-1 min-h-0">
          {route === 'home' && (currentProjectPath ? <ProjectView /> : <SplashView />)}
          {route === 'library' && <LibraryView />}
          {route === 'settings' && <SettingsView />}
        </section>
      </main>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Shortcuts are single keys and never fire while you are typing in a field.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <ShortcutTable title="Anywhere" rows={GLOBAL_SHORTCUTS} />
            <ShortcutTable title="Inside a project" rows={PROJECT_SHORTCUTS} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ShortcutTable({ title, rows }: { title: string; rows: ShortcutRow[] }) {
  return (
    <div>
      <h3 className="text-sm font-medium mb-1.5">{title}</h3>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.keys} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{r.action}</span>
            <kbd className="ml-4 shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
              {r.keys}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  )
}
