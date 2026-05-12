import { z } from 'zod'

export const ProjectMetaSchema = z.object({
  name: z.string().min(1),
  customer: z.string().default(''),
  site: z.string().default(''),
  created: z.string(),
  last_edited: z.string()
})
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>

export const RequirementsFileSchema = z.object({
  schema_version: z.literal(1),
  project: ProjectMetaSchema
})
export type RequirementsFile = z.infer<typeof RequirementsFileSchema>
