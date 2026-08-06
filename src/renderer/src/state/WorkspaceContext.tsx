import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { IS_WEB_BUILD } from '@/lib/runtime-target'

const WORKSPACE_KEY = 'dcn-designer.workspace_path'
const CURRENT_PROJECT_KEY = 'dcn-designer.current_project_path'

interface WorkspaceContextValue {
  workspacePath: string | null
  currentProjectPath: string | null
  ready: boolean
  setWorkspacePath(path: string | null): void
  openProject(path: string | null): void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspacePath, setPathState] = useState<string | null>(null)
  const [currentProjectPath, setProjectState] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function boot(): Promise<void> {
      if (IS_WEB_BUILD) {
        // The server owns the workspace root and it is shared by every browser that
        // connects, so adopt it instead of trusting this device's localStorage. Also
        // means the first-run WorkspacePicker never has to appear on the web.
        try {
          const root = await window.dcn.defaultWorkspacePath()
          if (cancelled) return
          localStorage.setItem(WORKSPACE_KEY, root)
          setPathState(root)
          await window.dcn.ensureWorkspace(root)
        } catch (e) {
          console.error('workspace bootstrap failed', e)
        }
        if (!cancelled) setReady(true)
        return
      }

      const stored = localStorage.getItem(WORKSPACE_KEY)
      if (stored) setPathState(stored)
      setReady(true)
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  const setWorkspacePath = useCallback(async (path: string | null) => {
    setPathState(path)
    setProjectState(null)
    localStorage.removeItem(CURRENT_PROJECT_KEY)
    if (path) {
      localStorage.setItem(WORKSPACE_KEY, path)
      try {
        await window.dcn.ensureWorkspace(path)
      } catch (e) {
        console.error('ensureWorkspace failed', e)
      }
    } else {
      localStorage.removeItem(WORKSPACE_KEY)
    }
  }, [])

  const openProject = useCallback((path: string | null) => {
    setProjectState(path)
    if (path) localStorage.setItem(CURRENT_PROJECT_KEY, path)
    else localStorage.removeItem(CURRENT_PROJECT_KEY)
  }, [])

  const value = useMemo<WorkspaceContextValue>(
    () => ({ workspacePath, currentProjectPath, ready, setWorkspacePath, openProject }),
    [workspacePath, currentProjectPath, ready, setWorkspacePath, openProject]
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within a WorkspaceProvider')
  return ctx
}
