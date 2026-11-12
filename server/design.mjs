// General design work beyond long-form books: fonts, documents from specs, zine imposition.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { miniZine, saddleStitch } from 'book-core/impose'
import { runJsx, script } from './bridge.mjs'

const UNIT = { pt: 1, in: 72, mm: 72 / 25.4, cm: 72 / 2.54, pica: 12 }
/** Common page sizes in points [width, height], portrait. */
export const SIZES = {
  letter: [612, 792], 'half-letter': [396, 612], 'quarter-letter': [306, 396], tabloid: [792, 1224], legal: [612, 1008],
  a3: [841.89, 1190.55], a4: [595.276, 841.89], a5: [419.528, 595.276], a6: [297.638, 419.528], a7: [209.764, 297.638],
  '6x9': [432, 648], '5.5x8.5': [396, 612], '5x8': [360, 576], '5.25x8': [378, 576], '4.25x7': [306, 504],
  'mini-zine-letter': [198, 306], 'mini-zine-a4': [210.472, 297.638], square: [576, 576], postcard: [288, 432],
}

/** { size | width+height, unit, landscape, margins } -> points. Margins are in `unit` (default inches). */
export function pageSpec(p = {}) {
  const u = UNIT[p.unit ?? 'in']
  if (!u) throw new Error(`Unknown unit "${p.unit}". Use in, mm, cm, pt or pica.`)
  let w, h
  if (p.size) {
    const s = SIZES[String(p.size).toLowerCase()]
    if (!s) throw new Error(`Unknown size "${p.size}". Known: ${Object.keys(SIZES).join(', ')}; or give width and height.`)
    ;[w, h] = s
  } else if (p.width && p.height) { w = p.width * u; h = p.height * u }
  if (w && p.landscape && w < h) [w, h] = [h, w]
  const m = p.margins && Object.fromEntries(['top', 'bottom', 'inside', 'outside'].map((k) => [k, (p.margins[k] ?? p.margins.all ?? 0.5) * u]))
  return { width: w, height: h, margins: m, unit: u }
}

export async function fonts(o) { return runJsx(await script('fonts'), o) }

export async function newDocument(o) {
  const s = pageSpec(o.page)
  if (!s.width) throw new Error('Give a page size: a named size or width and height.')
  const pt = (v) => (v === undefined ? undefined : v * s.unit)
  return runJsx(await script('new-document'), {
    out: o.out, width: s.width, height: s.height, margins: s.margins, pages: o.pages, facing: o.facing,
    columns: o.columns, gutter: pt(o.gutter), bleed: pt(o.bleed),
    baseline: o.baseline && { start: o.baseline.start * s.unit, increment: o.baseline.increment }, // increment is in points (it is leading)
    styles: o.styles,
  }, { timeoutMs: 5 * 60_000 })
}

/** Impose a document for folding: 'saddle-stitch' (2-up, nested sheets) or 'mini-zine' (8 pages on one sheet). */
export async function impose({ document, kind, out }) {
  const dir = await mkdtemp(join(tmpdir(), 'impose-'))
  const pdf = join(dir, 'pages.pdf')
  const src = await runJsx(`
    var d = __docAt(), ep = app.pdfExportPreferences, r = ep.pageRange, s = ep.exportReaderSpreads;
    ep.pageRange = PageRange.ALL_PAGES; ep.exportReaderSpreads = false;
    try { d.exportFile(ExportFormat.PDF_TYPE, new File(ARGS.pdf), false); } finally { ep.pageRange = r; ep.exportReaderSpreads = s; }
    return { pages: d.pages.length, w: d.documentPreferences.pageWidth, h: d.documentPreferences.pageHeight, name: d.name };`,
    { path: document, pdf }, { timeoutMs: 15 * 60_000 })
  const { w, h } = src
  let sheets, sheetW, sheetH, notes = []
  if (kind === 'mini-zine') {
    const z = miniZine(src.pages)
    sheetW = 4 * w; sheetH = 2 * h
    sheets = [{ label: 'one side', cells: z.rows.flatMap((row, ri) => row.pages.map((page, ci) => ({ page, x: ci * w, y: ri * h, rot: row.rotate }))) }]
    notes.push('Print one-sided at 100%. Fold in half both ways, cut the centre slit along the long fold between the two middle panels, then fold into a booklet.')
  } else {
    const b = saddleStitch(src.pages)
    sheetW = 2 * w; sheetH = h
    sheets = b.sides.map((s) => ({ label: `sheet ${s.sheet} ${s.side}`, cells: s.pages.map((page, k) => ({ page, x: k * w, y: 0, rot: 0 })) }))
    if (b.blanks) notes.push(`${src.pages} pages padded to ${b.total} with ${b.blanks} blank page(s) at the back; add or cut pages to control where they fall.`)
    notes.push(`Print double-sided, flipping on the short edge: ${b.total / 4} sheet(s). Nest, fold and staple on the fold.`)
  }
  const base = out.replace(/\.(indd|pdf)$/i, '')
  const r = await runJsx(await script('impose'), { pdf, outIndd: `${base}.indd`, outPdf: `${base}.pdf`, w, h, sheetW, sheetH, sheets }, { timeoutMs: 15 * 60_000 })
  return { source: src.name, sourcePages: src.pages, kind, ...r, order: sheets.map((s) => `${s.label}: ${s.cells.map((c) => c.page ?? 'blank').join(' | ')}`), notes }
}
