import Papa from 'papaparse'
import { OpticSchema, type Optic, type OsSupport } from '@/schemas/optics'

export interface ParseSummary {
  optic_count: number
  row_count: number
  rows_skipped_other_switch: number
  rows_skipped_no_pid: number
  rows_skipped_malformed: number
  warnings: string[]
}

export interface ParseResult {
  optics: Optic[]
  summary: ParseSummary
}

const CSV_FIELDS = {
  productFamily: 'Network Device Product Family',
  productId: 'Network Device Product ID',
  breakoutMode: 'Network Device Breakout mode',
  businessUnit: 'Transceiver Business Unit',
  transceiverFamily: 'Transceiver Product Family',
  transceiverId: 'Transceiver Product ID',
  versionId: 'Transceiver Version ID',
  eos: 'Transceiver End of Sale',
  osType: 'OS Type',
  minRelease: 'Min Software Release',
  networkDeviceNotes: 'Network Device Notes',
  dataRate: 'Data Rate',
  formFactor: 'Form Factor',
  reach: 'Reach',
  cableType: 'Cable Type',
  media: 'Media',
  connectorType: 'Connector Type',
  transceiverType: 'Transceiver Type',
  caseTemperature: 'Case Temperature',
  domCapable: 'DOM Capable',
  standard: 'Standard',
  transceiverNotes: 'Transceiver Notes',
  transceiverDataSheet: 'Transceiver Product ID Data Sheet (link)'
} as const

function clean(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  const s = String(raw).trim()
  if (!s) return null
  return s
}

function parseDataRate(raw: string | null): number | null {
  if (!raw) return null
  // "100 Gbps", "40/100 Gbps", "400 Gbps" → take highest numeric prefix
  const matches = raw.match(/(\d+(?:\.\d+)?)/g)
  if (!matches) return null
  const nums = matches.map(Number).filter((n) => Number.isFinite(n))
  if (nums.length === 0) return null
  return Math.max(...nums)
}

function parseBool(raw: string | null): boolean | null {
  if (!raw) return null
  const s = raw.toUpperCase()
  if (s === 'Y' || s === 'YES' || s === 'TRUE') return true
  if (s === 'N' || s === 'NO' || s === 'FALSE') return false
  return null
}

interface DedupKey {
  pid: string
  breakout: string
}

function keyOf(k: DedupKey): string {
  return `${k.pid}::${k.breakout || 'none'}`
}

export function parseTmgOpticsCsv(csvText: string, targetSwitchId: string): ParseResult {
  const warnings: string[] = []
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim()
  })

  for (const err of result.errors) {
    // Papaparse emits row-level errors when column counts mismatch (which is exactly
    // the unquoted-newline case we saw on row 236). We surface count rather than detail.
    if (err.code !== 'TooFewFields' && err.code !== 'TooManyFields') {
      warnings.push(`Row ${err.row !== undefined ? err.row + 2 : '?'}: ${err.message}`)
    }
  }

  const dedup = new Map<string, Optic>()
  let rowsSkippedOther = 0
  let rowsSkippedNoPid = 0
  let rowsSkippedMalformed = 0

  for (const row of result.data) {
    const switchId = clean(row[CSV_FIELDS.productId])
    if (!switchId) {
      rowsSkippedMalformed += 1
      continue
    }
    if (switchId !== targetSwitchId) {
      rowsSkippedOther += 1
      continue
    }

    const pid = clean(row[CSV_FIELDS.transceiverId])
    if (!pid) {
      rowsSkippedNoPid += 1
      continue
    }

    const breakoutMode = clean(row[CSV_FIELDS.breakoutMode])
    const k = keyOf({ pid, breakout: breakoutMode ?? '' })
    const osTypeRaw = clean(row[CSV_FIELDS.osType])
    const minReleaseRaw = clean(row[CSV_FIELDS.minRelease])
    const osSupportEntry: OsSupport | null =
      osTypeRaw && minReleaseRaw ? { os: osTypeRaw, min_release: minReleaseRaw } : null

    const existing = dedup.get(k)
    if (existing) {
      if (osSupportEntry && !existing.os_support.some((o) => o.os === osSupportEntry.os && o.min_release === osSupportEntry.min_release)) {
        existing.os_support.push(osSupportEntry)
      }
      continue
    }

    const dataRateRaw = clean(row[CSV_FIELDS.dataRate])
    const optic: Optic = {
      id: pid,
      family: clean(row[CSV_FIELDS.transceiverFamily]),
      form_factor: clean(row[CSV_FIELDS.formFactor]),
      data_rate_g: parseDataRate(dataRateRaw),
      data_rate_raw: dataRateRaw,
      breakout_mode: breakoutMode,
      reach: clean(row[CSV_FIELDS.reach]),
      cable_type: clean(row[CSV_FIELDS.cableType]),
      media: clean(row[CSV_FIELDS.media]),
      connector_type: clean(row[CSV_FIELDS.connectorType]),
      transceiver_type: clean(row[CSV_FIELDS.transceiverType]),
      case_temperature: clean(row[CSV_FIELDS.caseTemperature]),
      dom_capable: parseBool(clean(row[CSV_FIELDS.domCapable])),
      standard: clean(row[CSV_FIELDS.standard]),
      notes: clean(row[CSV_FIELDS.transceiverNotes]),
      network_device_notes: clean(row[CSV_FIELDS.networkDeviceNotes]),
      business_unit: clean(row[CSV_FIELDS.businessUnit]),
      version_id: clean(row[CSV_FIELDS.versionId]),
      eos: parseBool(clean(row[CSV_FIELDS.eos])) ?? false,
      os_support: osSupportEntry ? [osSupportEntry] : [],
      data_sheet_url: clean(row[CSV_FIELDS.transceiverDataSheet])
    }

    const parsed = OpticSchema.safeParse(optic)
    if (!parsed.success) {
      warnings.push(`Optic "${pid}" failed schema validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
      rowsSkippedMalformed += 1
      continue
    }

    dedup.set(k, parsed.data)
  }

  const optics = Array.from(dedup.values()).sort((a, b) => {
    if (a.family && b.family && a.family !== b.family) return a.family.localeCompare(b.family)
    return a.id.localeCompare(b.id)
  })

  return {
    optics,
    summary: {
      optic_count: optics.length,
      row_count: result.data.length,
      rows_skipped_other_switch: rowsSkippedOther,
      rows_skipped_no_pid: rowsSkippedNoPid,
      rows_skipped_malformed: rowsSkippedMalformed,
      warnings
    }
  }
}
