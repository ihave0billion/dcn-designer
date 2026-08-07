import { StyleSheet } from '@react-pdf/renderer'

// Phase 9 — the "PDF-safe stylesheet" called for by Open Risk #1.
//
// The app is styled with Tailwind + shadcn, and almost none of that survives
// the trip: react-pdf implements a small subset of flexbox and CSS, has no
// cascade, no `rem`, no CSS variables, and no `oklch()`. So the PDF gets its
// own tokens rather than trying to import the app's. The palette is a
// print-first greyscale plus the three semantic colours the app already uses
// for validity, deliberately darkened for paper.
//
// Only the built-in PDF fonts are used (Helvetica). Registering a webfont
// would mean fetching or bundling one, and the app is offline-first.

export const COLORS = {
  text: '#111111',
  muted: '#5b5b5b',
  faint: '#8a8a8a',
  rule: '#d4d4d4',
  panel: '#f4f4f5',
  error: '#a11212',
  warn: '#8a5a00',
  ok: '#15702f',
  spine: '#1f4e79',
  leaf: '#2f6f4f',
  ipn: '#8a5a00'
} as const

export const PAGE_MARGIN = 36

export const styles = StyleSheet.create({
  page: {
    paddingTop: PAGE_MARGIN,
    paddingBottom: PAGE_MARGIN + 14,
    paddingHorizontal: PAGE_MARGIN,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: COLORS.text,
    lineHeight: 1.4
  },

  // ── Cover ────────────────────────────────────────────────────────
  // Explicit lineHeight on every multi-line stack: the page's 1.4 is tuned for
  // 9pt body copy, and inheriting it at 26pt leaves the glyphs taller than
  // their line box, so the next line overprints the title.
  coverTitle: { fontSize: 26, lineHeight: 1.2, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  coverCustomer: { fontSize: 13, lineHeight: 1.3, color: COLORS.muted, marginBottom: 2 },
  coverMeta: { fontSize: 9, color: COLORS.faint },
  coverRule: { borderBottomWidth: 2, borderBottomColor: COLORS.text, marginVertical: 14 },

  // ── Structure ────────────────────────────────────────────────────
  section: { marginBottom: 16 },
  h2: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.rule
  },
  h3: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 8, marginBottom: 4 },
  note: { fontSize: 8, color: COLORS.muted, marginTop: 4 },
  empty: { fontSize: 9, color: COLORS.faint, fontStyle: 'italic' },

  // ── Definition grid (label above value, wrapped in rows) ─────────
  defGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  defCell: { width: '25%', paddingRight: 8, marginBottom: 7 },
  defLabel: { fontSize: 7, color: COLORS.faint, textTransform: 'uppercase' },
  defValue: { fontSize: 10 },

  // ── Tables ───────────────────────────────────────────────────────
  table: { marginTop: 2 },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.rule,
    paddingVertical: 3
  },
  trHead: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.text,
    paddingBottom: 3,
    marginBottom: 1
  },
  trTotal: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: COLORS.text,
    paddingTop: 3,
    marginTop: 1
  },
  // paddingRight is the column gutter. Without it a right-aligned cell ends
  // exactly where the next left-aligned cell begins and the two run together
  // ("QTYNOTES", "LENGTHMEDIA").
  th: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', paddingRight: 6 },
  td: { fontSize: 8.5, paddingRight: 6 },
  tdBold: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', paddingRight: 6 },
  right: { textAlign: 'right' },

  // ── Warnings ─────────────────────────────────────────────────────
  warnRow: { flexDirection: 'row', marginBottom: 5 },
  warnTag: {
    width: 42,
    fontSize: 7,
    lineHeight: 1.7,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase'
  },
  warnBody: { fontSize: 8.5, lineHeight: 1.3 },
  warnCode: { fontSize: 7, lineHeight: 1.3, color: COLORS.faint },

  // ── Verdict banner ───────────────────────────────────────────────
  banner: {
    padding: 7,
    marginBottom: 10,
    borderLeftWidth: 3,
    backgroundColor: COLORS.panel
  },
  bannerTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  bannerBody: { fontSize: 8.5, color: COLORS.muted, marginTop: 1 },

  // ── Rack diagrams ────────────────────────────────────────────────
  rackRow: { flexDirection: 'row', flexWrap: 'wrap' },
  rackCell: { marginRight: 12, marginBottom: 12 },
  rackName: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  rackMeta: { fontSize: 7, color: COLORS.muted, marginBottom: 3 },

  // ── Page furniture ───────────────────────────────────────────────
  footer: {
    position: 'absolute',
    bottom: 18,
    left: PAGE_MARGIN,
    right: PAGE_MARGIN,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: COLORS.faint
  },
  legend: { flexDirection: 'row', marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 14 },
  legendSwatch: { width: 8, height: 8, marginRight: 4 },
  legendLabel: { fontSize: 7.5, color: COLORS.muted }
})
