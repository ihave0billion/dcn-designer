import { Home, Library, Settings, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SidebarRoute = 'home' | 'library' | 'settings'

interface NavItem {
  id: SidebarRoute
  label: string
  icon: LucideIcon
}

const NAV: NavItem[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'settings', label: 'Settings', icon: Settings }
]

interface SidebarProps {
  activeId: SidebarRoute
  onSelect: (id: SidebarRoute) => void
}

export function Sidebar({ activeId, onSelect }: SidebarProps) {
  return (
    <aside className="w-56 shrink-0 border-r flex flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-4 h-12 flex items-center border-b">
        <span className="text-sm font-semibold tracking-tight">DCN Designer</span>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {NAV.map((item) => {
          const Icon = item.icon
          const active = item.id === activeId
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left cursor-pointer',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'hover:bg-sidebar-accent/60'
              )}
            >
              <Icon className="size-4" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
      <div className="p-3 border-t text-xs text-muted-foreground">
        v1.0.0 ·{' '}
        <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">?</kbd> shortcuts
      </div>
    </aside>
  )
}
