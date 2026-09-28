import { Document, type DocumentProps } from '@react-pdf/renderer'
import type { ReactElement } from 'react'
import type { DesignResult } from '@domain'
import type { RequirementsFile } from '@/schemas/project'
import type { CableLink } from '@/schemas/cable-links'
import type { Switch } from '@/schemas/switches'
import { buildCableBom } from '@/lib/cable-bom'
import { buildDeviceBom } from '@/lib/device-bom'
import { BomPage } from './DesignReport'

// Phase 16 — the standalone bill of materials.
//
// The same BOM page the design report carries (switches, optics, cables —
// built from device-bom / cable-bom, so it can never disagree with the
// Summary tab), wrapped in its own one-page document with a title block, for
// handing to procurement without the rest of the report.

export interface BomReportInput {
  requirements: RequirementsFile
  design: DesignResult
  links: CableLink[]
  switches: Switch[]
  generatedAt: string
}

export function BomReport({
  requirements,
  design,
  links,
  switches,
  generatedAt
}: BomReportInput): ReactElement<DocumentProps> {
  const deviceBom = buildDeviceBom(design, switches)
  const cableBom = buildCableBom({ links, cable_tray_m: requirements.cable_tray_m, default_media: requirements.default_cable_media })
  const projectName = requirements.project.name
  return (
    <Document
      title={`${projectName} — Bill of materials`}
      author="DCN Designer"
      subject={requirements.project.customer || undefined}
      creator="DCN Designer"
      producer="DCN Designer"
    >
      <BomPage
        projectName={projectName}
        design={design}
        deviceBom={deviceBom}
        cableBom={cableBom}
        cableTrayM={requirements.cable_tray_m}
        standalone={{ requirements, generatedAt }}
      />
    </Document>
  )
}
