import { CableLinkKindSchema, type CableLink } from '@/schemas/cable-links'

// Fixed-schema CSV round-trip for cable_links.yaml. The columns below
// are what `Export CSV` writes and what `Import CSV` expects. Unknown
// columns are ignored on import; rows with missing required columns
// are skipped and surfaced in the parse summary.
//
// Per Phase 6 Q4: this is intentionally not a column-mapping UI — the
// app produces and consumes the same shape so users can edit in Excel.

// Phase 14: `kind` (uplink | vpc-peer-link) — optional on import, defaults
// to uplink. For a peer-link both device columns name leaves; the column
// names are kept for spreadsheet compatibility ("spine_*" = device A).
const COLUMNS = [
  'id',
  'kind',
  'spine_rack',
  'spine_device_id',
  'spine_port',
  'leaf_rack',
  'leaf_device_id',
  'leaf_port',
  'speed_g',
  'optic_id',
  'patch_panel_id',
  'label',
  'length_m',
  'notes'
] as const

export interface CsvParseResult {
  links: CableLink[]
  total_rows: number
  rows_skipped_malformed: number
  rows_skipped_unknown_device: number
  warnings: string[]
}

interface ValidDevices {
  spineIds: Set<string>
  leafIds: Set<string>
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

function toCsvCell(value: string | number | null | undefined): string {
  if (value == null) return ''
  return escapeCsv(String(value))
}

export function serializeCableLinksCsv(links: CableLink[]): string {
  const header = COLUMNS.join(',')
  const rows = links.map((l) =>
    [
      l.id,
      l.kind ?? 'uplink',
      l.device_a.rack ?? '',
      l.device_a.device_id,
      l.device_a.port,
      l.device_b.rack ?? '',
      l.device_b.device_id,
      l.device_b.port,
      l.speed_g,
      l.optic_id ?? '',
      l.patch_panel_id ?? '',
      l.label,
      l.length_m ?? '',
      l.notes ?? ''
    ]
      .map(toCsvCell)
      .join(',')
  )
  return [header, ...rows].join('\n') + '\n'
}

// Minimal CSV row parser — handles double-quoted cells with embedded
// commas and doubled "" escape sequences. Not RFC 4180 perfect (no
// support for cell-internal newlines), but good enough for the
// roundtripped shape this app emits.
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let i = 0
  let cur = ''
  let inQuotes = false
  while (i < line.length) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      cur += c
      i += 1
    } else {
      if (c === ',') {
        out.push(cur)
        cur = ''
        i += 1
        continue
      }
      if (c === '"' && cur === '') {
        inQuotes = true
        i += 1
        continue
      }
      cur += c
      i += 1
    }
  }
  out.push(cur)
  return out
}

function parseCsvLines(text: string): string[][] {
  const trimmed = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return trimmed
    .split('\n')
    .filter((l) => l.length > 0)
    .map(parseCsvLine)
}

export function parseCableLinksCsv(
  text: string,
  valid: ValidDevices,
  startSerial = 1
): CsvParseResult {
  const result: CsvParseResult = {
    links: [],
    total_rows: 0,
    rows_skipped_malformed: 0,
    rows_skipped_unknown_device: 0,
    warnings: []
  }
  const lines = parseCsvLines(text)
  if (lines.length === 0) {
    result.warnings.push('CSV is empty.')
    return result
  }
  const header = lines[0].map((h) => h.trim().toLowerCase())
  const colIdx = new Map<string, number>()
  for (let i = 0; i < header.length; i++) colIdx.set(header[i], i)
  const required = ['spine_device_id', 'spine_port', 'leaf_device_id', 'leaf_port', 'speed_g']
  const missing = required.filter((c) => !colIdx.has(c))
  if (missing.length > 0) {
    result.warnings.push(`Missing required columns: ${missing.join(', ')}.`)
    return result
  }

  let serial = startSerial
  for (let r = 1; r < lines.length; r++) {
    result.total_rows += 1
    const row = lines[r]
    function cell(col: string): string {
      const idx = colIdx.get(col)
      if (idx == null) return ''
      return (row[idx] ?? '').trim()
    }
    const spineDeviceId = cell('spine_device_id')
    const leafDeviceId = cell('leaf_device_id')
    const spinePort = cell('spine_port')
    const leafPort = cell('leaf_port')
    const speedStr = cell('speed_g')
    const speed_g = Number(speedStr)

    if (!spineDeviceId || !leafDeviceId || !spinePort || !leafPort || !Number.isFinite(speed_g) || speed_g <= 0) {
      result.rows_skipped_malformed += 1
      continue
    }
    const kindParsed = CableLinkKindSchema.safeParse(cell('kind') || 'uplink')
    if (!kindParsed.success) {
      result.rows_skipped_malformed += 1
      result.warnings.push(`Row ${r + 1}: unknown link kind "${cell('kind')}" — skipped.`)
      continue
    }
    const kind = kindParsed.data
    const aOk = kind === 'vpc-peer-link' ? valid.leafIds.has(spineDeviceId) : valid.spineIds.has(spineDeviceId)
    if (!aOk) {
      result.rows_skipped_unknown_device += 1
      result.warnings.push(`Row ${r + 1}: unknown spine device "${spineDeviceId}" — skipped.`)
      continue
    }
    if (!valid.leafIds.has(leafDeviceId)) {
      result.rows_skipped_unknown_device += 1
      result.warnings.push(`Row ${r + 1}: unknown leaf device "${leafDeviceId}" — skipped.`)
      continue
    }

    const idIn = cell('id')
    const id = idIn || `link-${serial.toString().padStart(4, '0')}`
    if (!idIn) serial += 1
    const length_m_raw = cell('length_m')
    const length_m = length_m_raw === '' ? null : Number(length_m_raw)

    result.links.push({
      id,
      kind,
      device_a: {
        rack: cell('spine_rack') || null,
        device_id: spineDeviceId,
        port: spinePort
      },
      device_b: {
        rack: cell('leaf_rack') || null,
        device_id: leafDeviceId,
        port: leafPort
      },
      speed_g,
      optic_id: cell('optic_id') || null,
      patch_panel_id: cell('patch_panel_id') || null,
      label: cell('label') || `${spineDeviceId}:${spinePort} ↔ ${leafDeviceId}:${leafPort}`,
      length_m: length_m != null && Number.isFinite(length_m) ? length_m : null,
      notes: cell('notes') || null
    })
  }
  return result
}

export const CABLE_LINKS_CSV_COLUMNS = COLUMNS
