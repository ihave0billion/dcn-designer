// Node loader hook for running renderer-side TypeScript straight from source:
// the renderer imports relative modules without an extension (Vite resolves
// them), while Node's ESM loader needs one. This appends `.ts` when a bare
// relative specifier has no extension. Used by scripts/visio/smoke.ts:
//   node --import ./scripts/visio/node-ts-resolver.mjs scripts/visio/smoke.ts
import { register } from 'node:module'

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\\.[a-zA-Z0-9]+$/.test(specifier)) {
    try {
      return await next(specifier + '.ts', context)
    } catch (e) {
      if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e
    }
  }
  return next(specifier, context)
}
`),
  import.meta.url
)
