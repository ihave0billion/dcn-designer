import type { MasterAsset } from './vsdx-writer'

// Phase 13 — reads the extracted stencil bundle at <workspace>/library/visio/.
//
// The bundle is produced offline by scripts/visio/extract-masters.py (see
// docs/VISIO_EXPORT_PLAN.md for the format). Nothing here parses Visio XML:
// the parts are handed to the writer verbatim, and only the media rel
// targets are rewritten at save time. Text parts go through readTextFile,
// binary parts (EMF media, PNG photos) through readBinaryFile.

export interface VisioIndexMaster {
  slug: string
  width_in: number
  height_in: number
  media: string[]
  png?: string | null
}

export interface VisioIndex {
  schema_version: 1
  generated_at: string
  packs: Array<{ family: string; file: string; sha256?: string }>
  masters: Record<string, VisioIndexMaster>
  aliases: Record<string, string>
  images: Record<string, string>
}

export interface LoadedImage {
  bytes: Uint8Array
  kind: 'png' | 'jpeg'
}

export function visioAssetsDir(workspacePath: string): string {
  return `${workspacePath}/library/visio`
}

function imageKind(path: string): 'png' | 'jpeg' {
  return /\.jpe?g$/i.test(path) ? 'jpeg' : 'png'
}

export class MasterStore {
  private readonly masters = new Map<string, Promise<MasterAsset>>()
  private readonly images = new Map<string, Promise<LoadedImage>>()

  private constructor(
    readonly base: string,
    readonly index: VisioIndex
  ) {}

  /** Resolves to null when the workspace has no bundle (nothing extracted yet). */
  static async open(workspacePath: string): Promise<MasterStore | null> {
    const base = visioAssetsDir(workspacePath)
    const indexPath = `${base}/index.json`
    if (!(await window.dcn.fileExists(indexPath))) return null
    const raw = JSON.parse(await window.dcn.readTextFile(indexPath)) as Partial<VisioIndex>
    if (raw.schema_version !== 1 || !raw.masters) {
      throw new Error(`library/visio/index.json: unsupported schema (${String(raw.schema_version)})`)
    }
    const index: VisioIndex = {
      schema_version: 1,
      generated_at: raw.generated_at ?? '',
      packs: raw.packs ?? [],
      masters: raw.masters,
      aliases: raw.aliases ?? {},
      images: raw.images ?? {}
    }
    return new MasterStore(base, index)
  }

  hasMaster(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.index.masters, name)
  }

  masterNames(): string[] {
    return Object.keys(this.index.masters).sort()
  }

  /** Load (and cache) one master's parts, ready for Diagram.registerMaster. */
  loadMaster(name: string): Promise<MasterAsset> {
    let p = this.masters.get(name)
    if (!p) {
      p = this.readMaster(name)
      this.masters.set(name, p)
    }
    return p
  }

  private async readMaster(name: string): Promise<MasterAsset> {
    const entry = this.index.masters[name]
    if (!entry) throw new Error(`Visio master not in bundle: ${name}`)
    const dir = `${this.base}/masters/${entry.slug}`
    const relsPath = `${dir}/master.xml.rels`
    const [entryXml, masterXml, hasRels] = await Promise.all([
      window.dcn.readTextFile(`${dir}/entry.xml`),
      window.dcn.readTextFile(`${dir}/master.xml`),
      window.dcn.fileExists(relsPath)
    ])
    const relsXml = hasRels ? await window.dcn.readTextFile(relsPath) : null
    const media: Record<string, Uint8Array> = {}
    await Promise.all(
      entry.media.map(async (file) => {
        media[file] = await window.dcn.readBinaryFile(`${dir}/media/${file}`)
      })
    )
    return {
      name,
      entryXml,
      masterXml,
      relsXml,
      media,
      widthIn: entry.width_in,
      heightIn: entry.height_in
    }
  }

  /** Load a PNG/JPEG under library/visio/ (product photo or a master's rasterised front.png). */
  loadImage(relPath: string): Promise<LoadedImage> {
    let p = this.images.get(relPath)
    if (!p) {
      p = window.dcn
        .readBinaryFile(`${this.base}/${relPath}`)
        .then((bytes) => ({ bytes, kind: imageKind(relPath) }))
      this.images.set(relPath, p)
    }
    return p
  }

  /** The rasterised front panel of a master, if the extractor had LibreOffice. */
  masterPng(name: string): string | null {
    return this.index.masters[name]?.png ?? null
  }
}
