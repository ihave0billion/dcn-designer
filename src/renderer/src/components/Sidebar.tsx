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

// Black icon rail: icon over a small uppercase label, the active item lit
// in signal yellow with a bar on its left edge. Same in both themes.
export function Sidebar({ activeId, onSelect }: SidebarProps) {
  return (
    <aside className="w-[84px] shrink-0 flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <nav className="flex-1 py-2 flex flex-col gap-1">
        {NAV.map((item) => {
          const Icon = item.icon
          const active = item.id === activeId
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={cn(
                'relative mx-2 chamfer-xs flex flex-col items-center gap-1 px-1 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors cursor-pointer',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
              )}
            >
              {active && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-primary" />
              )}
              <Icon className="size-5" strokeWidth={1.75} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
      <div className="mx-3 h-1 hazard opacity-60" />
      <div className="px-2 py-3 text-[10px] text-sidebar-foreground/60 text-center leading-tight font-mono">
        v1.2.0
        <br />
        <kbd className="border border-sidebar-border bg-sidebar-accent/40 px-1">?</kbd> keys
      </div>
    </aside>
  )
}
