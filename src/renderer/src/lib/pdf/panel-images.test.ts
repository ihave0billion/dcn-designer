import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import { imageSize, shrinkForPdf } from './panel-images'

function png(w: number, h: number): Uint8Array {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)])
  }
  const raw = Buffer.alloc((w * 3 + 1) * h)
  return new Uint8Array(Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

describe('panel images', () => {
  it('reads PNG dimensions from the IHDR', () => {
    expect(imageSize(png(2900, 262), 'png')).toEqual({ w: 2900, h: 262 })
  })

  it('reads JPEG dimensions from the SOF marker', () => {
    // SOI, APP0 (2 bytes len), SOF0 with height 240 width 3000
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0xf0, 0x0b, 0xb8, 0x03, 0x01, 0x11, 0x00
    ])
    expect(imageSize(jpeg, 'jpeg')).toEqual({ w: 3000, h: 240 })
  })

  it('returns null for garbage', () => {
    expect(imageSize(new Uint8Array([1, 2, 3]), 'png')).toBeNull()
    expect(imageSize(new Uint8Array([1, 2, 3]), 'jpeg')).toBeNull()
  })

  it('passes bytes through where there is no canvas (Node)', async () => {
    const bytes = png(2900, 262)
    const r = await shrinkForPdf(bytes, 'png')
    expect(r.bytes).toBe(bytes)
  })
})
