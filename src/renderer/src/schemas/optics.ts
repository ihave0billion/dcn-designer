import { z } from 'zod'

export const OsSupportSchema = z.object({
  os: z.string().min(1),
  min_release: z.string().min(1)
})
export type OsSupport = z.infer<typeof OsSupportSchema>

export const OpticSchema = z.object({
  id: z.string().min(1),
  family: z.string().nullable(),
  form_factor: z.string().nullable(),
  data_rate_g: z.number().nullable(),
  data_rate_raw: z.string().nullable(),
  breakout_mode: z.string().nullable(),
  reach: z.string().nullable(),
  cable_type: z.string().nullable(),
  media: z.string().nullable(),
  connector_type: z.string().nullable(),
  transceiver_type: z.string().nullable(),
  case_temperature: z.string().nullable(),
  dom_capable: z.boolean().nullable(),
  standard: z.string().nullable(),
  notes: z.string().nullable(),
  network_device_notes: z.string().nullable(),
  business_unit: z.string().nullable(),
  version_id: z.string().nullable(),
  eos: z.boolean().default(false),
  os_support: z.array(OsSupportSchema).default([]),
  data_sheet_url: z.string().nullable()
})
export type Optic = z.infer<typeof OpticSchema>

export const OpticsFileSchema = z.object({
  schema_version: z.literal(1),
  switch_id: z.string().min(1),
  source_csv: z.string().nullable(),
  imported_at: z.string().nullable(),
  optics: z.array(OpticSchema)
})
export type OpticsFile = z.infer<typeof OpticsFileSchema>
