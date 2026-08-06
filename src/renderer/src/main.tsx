import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ThemeProvider } from './components/ThemeProvider'
import { WorkspaceProvider } from './state/WorkspaceContext'
import './styles/globals.css'

import { IS_WEB_BUILD } from './lib/runtime-target'

// Electron injects window.dcn from the preload script. When it's absent we're either
// running the self-hosted web build (talk to the real server) or a plain browser
// preview with no backend (fall back to the dev mock). This has to settle before the
// first render — WorkspaceProvider touches window.dcn on mount. Wrapped in an async
// entry rather than top-level await, which the browser build target rejects.
async function installDcnBridge(): Promise<void> {
  if (window.dcn) return
  if (IS_WEB_BUILD) {
    const { installHttpDcn } = await import('./lib/http-dcn')
    installHttpDcn()
  } else if (import.meta.env.DEV) {
    const { installMockDcn } = await import('./dev/install-mock-dcn')
    installMockDcn()
  }
}

void installDcnBridge().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider>
        <WorkspaceProvider>
          <App />
        </WorkspaceProvider>
      </ThemeProvider>
    </StrictMode>
  )
})
