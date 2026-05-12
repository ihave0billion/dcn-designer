import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SwitchesPanel } from './SwitchesPanel'
import { ServersPanel } from './ServersPanel'
import { OpticsPanelStub } from './OpticsPanelStub'

export function LibraryView() {
  return (
    <div className="h-full overflow-auto p-8">
      <div className="max-w-6xl mx-auto space-y-4">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Switches, servers, and (in phase 1b) per-switch optics. Edits write back to YAML in
            your workspace.
          </p>
        </header>
        <Tabs defaultValue="switches">
          <TabsList>
            <TabsTrigger value="switches">Switches</TabsTrigger>
            <TabsTrigger value="servers">Servers</TabsTrigger>
            <TabsTrigger value="optics">Optics</TabsTrigger>
          </TabsList>
          <TabsContent value="switches" className="mt-4">
            <SwitchesPanel />
          </TabsContent>
          <TabsContent value="servers" className="mt-4">
            <ServersPanel />
          </TabsContent>
          <TabsContent value="optics" className="mt-4">
            <OpticsPanelStub />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
