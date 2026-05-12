import { useState } from 'react'
import { Sidebar, type SidebarRoute } from './components/Sidebar'
import { ThemeToggle } from './components/ThemeToggle'
import { useWorkspace } from './state/WorkspaceContext'
import { WorkspacePicker } from './views/splash/WorkspacePicker'
import { SplashView } from './views/splash/SplashView'
import { ProjectView } from './views/project/ProjectView'
import { LibraryView } from './views/library/LibraryView'
import { SettingsView } from './views/SettingsView'

export function App() {
  const { ready, workspacePath, currentProjectPath } = useWorkspace()
  const [route, setRoute] = useState<SidebarRoute>('home')

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
    </div>
  )
}
