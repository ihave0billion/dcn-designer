import { Lock } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function OpticsPanelStub() {
  return (
    <Card className="border-dashed mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="size-4" />
          Optics — coming in phase 1b
        </CardTitle>
        <CardDescription>
          Each switch will have its own optics file in <code>library/optics/&lt;switch-id&gt;.yaml</code>,
          populated by uploading a Cisco TMG optics CSV (hundreds of optic SKUs per switch). The solver
          will use these per-switch lists to narrow optic choices for each link.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Phase 1b adds: CSV upload per switch · parser → YAML deduplication of OS-variant rows ·
        "replace or keep" prompt on re-upload · per-optic edit / delete.
      </CardContent>
    </Card>
  )
}
