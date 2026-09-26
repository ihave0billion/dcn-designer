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
import { IS_WEB_BUILD } from './lib/runtime-target'
import { Lock } from 'lucide-react'
import { Button } from './components/ui/button'

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
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* Black top bar — yellow brand block on the left, utilities on the right. */}
      <header className="h-12 shrink-0 flex items-center justify-between pr-3 bg-topbar text-topbar-foreground border-b border-sidebar-border">
        <div className="flex items-center h-full">
          <div className="h-full px-3 flex items-center bg-primary text-primary-foreground chamfer-sm">
            <BrandMark />
          </div>
          <span className="ml-3 text-[17px] font-bold uppercase tracking-[0.16em]">DCN Designer</span>
          <span className="ml-3 hidden sm:inline text-[10px] font-semibold uppercase tracking-[0.2em] text-topbar-foreground/50">
            // spine-leaf design
          </span>
        </div>
        <div className="flex items-center gap-1 [&_button]:text-topbar-foreground [&_button:hover]:bg-sidebar-accent [&_button:hover]:text-topbar-foreground">
          <ThemeToggle />
          {IS_WEB_BUILD && (
            <Button
              variant="ghost"
              size="sm"
              title="Lock — end this session now"
              onClick={async () => {
                await fetch('/api/logout', { method: 'POST' }).catch(() => undefined)
                window.location.reload()
              }}
            >
              <Lock />
              Lock
            </Button>
          )}
        </div>
      </header>
      <div className="flex-1 flex min-h-0">
        <Sidebar activeId={route} onSelect={setRoute} />
        <main className="flex-1 flex flex-col min-w-0">
          <section className="flex-1 min-h-0">
            {route === 'home' && (currentProjectPath ? <ProjectView /> : <SplashView />)}
            {route === 'library' && <LibraryView />}
            {route === 'settings' && <SettingsView />}
          </section>
        </main>
      </div>
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

// Small fabric glyph for the top bar — two tiers of nodes joined by links.
function BrandMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="7" height="5" rx="1.2" fill="currentColor" opacity="0.95" />
      <rect x="13" y="2" width="7" height="5" rx="1.2" fill="currentColor" opacity="0.95" />
      <rect x="1" y="15" width="5" height="5" rx="1.2" fill="currentColor" opacity="0.7" />
      <rect x="8.5" y="15" width="5" height="5" rx="1.2" fill="currentColor" opacity="0.7" />
      <rect x="16" y="15" width="5" height="5" rx="1.2" fill="currentColor" opacity="0.7" />
      <path
        d="M5.5 7v3M16.5 7v3M5.5 10h11M3.5 15v-5M11 15v-5M18.5 15v-5"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.75"
      />
    </svg>
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
