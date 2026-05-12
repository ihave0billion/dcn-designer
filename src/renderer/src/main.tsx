import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ThemeProvider } from './components/ThemeProvider'
import { WorkspaceProvider } from './state/WorkspaceContext'
import './styles/globals.css'

if (import.meta.env.DEV) {
  const { installMockDcn } = await import('./dev/install-mock-dcn')
  installMockDcn()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <WorkspaceProvider>
        <App />
      </WorkspaceProvider>
    </ThemeProvider>
  </StrictMode>
)
