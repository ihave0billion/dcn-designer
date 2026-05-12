import { z } from 'zod'

export const ThemeSchema = z.enum(['light', 'dark'])
export type Theme = z.infer<typeof ThemeSchema>

export const SettingsFileSchema = z.object({
  schema_version: z.literal(1),
  workspace_path: z.string(),
  theme: ThemeSchema.default('light'),
  last_project: z.string().nullable().default(null),
  recent_projects: z.array(z.string()).default([])
})
export type SettingsFile = z.infer<typeof SettingsFileSchema>
