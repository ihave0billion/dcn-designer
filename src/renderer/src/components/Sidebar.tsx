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

// Navy icon rail, Nexus Dashboard style: icon stacked over a short label,
// active item carries a left accent bar. Stays navy in both themes.
export function Sidebar({ activeId, onSelect }: SidebarProps) {
  return (
    <aside className="w-[88px] shrink-0 flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <nav className="flex-1 py-2 flex flex-col gap-1">
        {NAV.map((item) => {
          const Icon = item.icon
          const active = item.id === activeId
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={cn(
                'relative mx-2 flex flex-col items-center gap-1 rounded-md px-1 py-3 text-[11px] font-medium transition-colors cursor-pointer',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
              )}
            >
              {active && (
                <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-primary" />
              )}
              <Icon className="size-5" strokeWidth={1.75} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
      <div className="px-2 py-3 border-t border-sidebar-border text-[10px] text-sidebar-foreground/60 text-center leading-tight">
        v1.1.0
        <br />
        <kbd className="rounded border border-sidebar-border bg-sidebar-accent/40 px-1 font-mono">?</kbd>{' '}
        keys
      </div>
    </aside>
  )
}
