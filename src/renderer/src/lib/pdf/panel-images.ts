import type { Switch } from '@/schemas/switches'
import type { IpnRouterFileEntry } from '@domain'
import { MasterStore } from '@/lib/visio/master-store'
import { resolveModel } from '@/lib/visio/resolve-model'

// Phase 13 — front-view images for the PDF topology page, keyed by model.
// Same resolution as the Visio export (library override → exact master →
// alias → photo), but the PDF needs raster: a master contributes its
// rasterised front.png (present when the extractor had LibreOffice), a
// photo contributes itself. Models with neither get no entry and are drawn
// as chassis rectangles.

import type { PanelImage } from './topology-scene'

export type PanelImages = Map<string, PanelImage>

/** Widest raster the PDF needs: a panel prints ~1.5 in wide, so 640 px is > 400 dpi. */
export const PDF_IMAGE_MAX_W = 640

// react-pdf decodes every PNG to raw pixels and embeds each <Image> as its
// own object — 33 devices × a 2900-px stencil render came to 27 MB. Shrink
// in the browser first (canvas), so each panel is ~15 KB. In Node (tests)
// there is no canvas and the bytes pass through untouched.
export async function shrinkForPdf(bytes: Uint8Array, kind: 'png' | 'jpeg'): Promise<{ bytes: Uint8Array; kind: 'png' | 'jpeg' }> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return { bytes, kind }
  const size = imageSize(bytes, kind)
  if (!size || size.w <= PDF_IMAGE_MAX_W) return { bytes, kind }
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: `image/${kind}` }))
    const w = PDF_IMAGE_MAX_W
    const h = Math.max(1, Math.round((bitmap.height * w) / bitmap.width))
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) return { bytes, kind }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return { bytes: new Uint8Array(await blob.arrayBuffer()), kind: 'png' }
  } catch {
    return { bytes, kind }
  }
}

/** Pixel size of a PNG (IHDR) or baseline/progressive JPEG (SOFn). */
export function imageSize(bytes: Uint8Array, kind: 'png' | 'jpeg'): { w: number; h: number } | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (kind === 'png') {
    if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null
    return { w: dv.getUint32(16), h: dv.getUint32(20) }
  }
  let i = 2
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null
    const marker = bytes[i + 1]
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2
      continue
    }
    const len = dv.getUint16(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) }
    }
    i += 2 + len
  }
  return null
}

function toDataUrl(bytes: Uint8Array, kind: 'png' | 'jpeg'): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `data:image/${kind};base64,${btoa(bin)}`
}

export async function loadPanelImages(
  workspacePath: string,
  modelIds: Iterable<string>,
  switches: Switch[],
  ipnRouters: IpnRouterFileEntry[]
): Promise<PanelImages> {
  const out: PanelImages = new Map()
  const store = await MasterStore.open(workspacePath)
  if (!store) return out
  const hints = new Map<string, { master?: string | null; image?: string | null } | null>()
  for (const s of switches) hints.set(s.id, s.visio ?? null)
  for (const r of ipnRouters) if (!hints.has(r.id)) hints.set(r.id, r.visio ?? null)

  await Promise.all(
    [...new Set(modelIds)].map(async (modelId) => {
      const r = resolveModel(modelId, hints.get(modelId) ?? null, store.index)
      let rel: string | null = null
      if (r.kind === 'master') rel = store.masterPng(r.masterName)
      else if (r.kind === 'image') rel = r.imagePath
      if (!rel) return
      try {
        const loaded = await store.loadImage(rel)
        const img = await shrinkForPdf(loaded.bytes, loaded.kind)
        const size = imageSize(img.bytes, img.kind)
        out.set(modelId, {
          url: toDataUrl(img.bytes, img.kind),
          aspect: size && size.h > 0 ? size.w / size.h : 11
        })
      } catch {
        // A missing raster only costs the picture; the page still renders.
      }
    })
  )
  return out
}
