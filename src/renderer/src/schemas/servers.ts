import { z } from 'zod'

export const ServerPortGroupSchema = z.object({
  count: z.number().int().positive(),
  speed_g: z.number().positive(),
  naming_template: z.string()
})
export type ServerPortGroup = z.infer<typeof ServerPortGroupSchema>

export const ServerGpuSchema = z.object({
  model: z.string().min(1),
  count: z.number().int().positive()
})
export type ServerGpu = z.infer<typeof ServerGpuSchema>

export const ServerSchema = z.object({
  id: z.string().min(1),
  model_display: z.string().min(1),
  vendor: z.string().min(1),
  role: z.literal('server'),
  category: z.string().min(1),
  ru: z.number().int().positive().nullable(),
  power_w: z.number().positive().nullable(),
  ports: z.array(ServerPortGroupSchema).default([]),
  gpu: ServerGpuSchema.nullable(),
  notes: z.string().nullable(),
  data_sheet_url: z.string().nullable(),
  attachments: z.array(z.string()).default([])
})
export type Server = z.infer<typeof ServerSchema>

export const ServersFileSchema = z.object({
  schema_version: z.literal(1),
  servers: z.array(ServerSchema)
})
export type ServersFile = z.infer<typeof ServersFileSchema>
