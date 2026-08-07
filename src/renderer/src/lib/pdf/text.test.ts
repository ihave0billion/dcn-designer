import { describe, it, expect } from 'vitest'
import { pdfText } from './text'

describe('pdfText', () => {
  it('transliterates the arrows the app actually emits', () => {
    // Solver note (src/domain/solver.ts) and cable link labels.
    expect(pdfText('Breakout 1×→4×')).toBe('Breakout 1×->4×')
    expect(pdfText('spine-1:Eth1/1 ↔ leaf-1:Eth1/49')).toBe('spine-1:Eth1/1 <-> leaf-1:Eth1/49')
  })

  it('transliterates comparison and ellipsis characters', () => {
    expect(pdfText('≥ 4 uplinks')).toBe('>= 4 uplinks')
    expect(pdfText('≤ 2')).toBe('<= 2')
    expect(pdfText('a ≠ b')).toBe('a != b')
    expect(pdfText('loading…')).toBe('loading...')
  })

  it('passes through characters the built-in fonts do encode', () => {
    // × · — are Latin-1 / WinAnsi and render correctly as-is.
    expect(pdfText('4 × 100G · 2U — rack A')).toBe('4 × 100G · 2U — rack A')
    expect(pdfText('Café Ünicode ñ')).toBe('Café Ünicode ñ')
    expect(pdfText('“quoted” ‘single’ • bullet')).toBe('“quoted” ‘single’ • bullet')
  })

  it('drops characters outside the encoding rather than printing a wrong glyph', () => {
    expect(pdfText('emoji 🚀 here')).toBe('emoji  here')
    expect(pdfText('日本語')).toBe('')
  })

  it('leaves plain ASCII untouched', () => {
    expect(pdfText('N9K-C9364D-GX2A')).toBe('N9K-C9364D-GX2A')
    expect(pdfText('')).toBe('')
  })
})
