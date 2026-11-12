// The export phase: signatures, unused styles, EPUB readiness, EPUB with validation, print PDF with preflight.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { a11yMetadata } from 'book-core/a11y'
import { loadProfile } from 'book-core/profile'
import { ace as runAce, epubcheck } from 'book-core/validate'
import { runJsx, script } from './bridge.mjs'

const LONG = { timeoutMs: 20 * 60_000 }

export async function signature({ path, profile, add = 0, master }) {
  const sig = loadProfile(profile).signature ?? 16
  return runJsx(await script('signature'), { path, signature: sig, add, master }, add ? { undoName: `Add ${add} pages`, ...LONG } : LONG)
}

export async function unusedStyles({ path, remove }) {
  return runJsx(await script('styles-usage'), { path, remove }, remove ? { undoName: 'Remove unused styles', ...LONG } : LONG)
}

export async function epubPrep({ path, profile, meta = {}, apply = false }) {
  const rules = loadProfile(profile).epub ?? {}
  return runJsx(await script('epub-prep'), { path, rules, meta, apply }, apply ? { undoName: 'EPUB export tagging', ...LONG } : LONG)
}

/** Export, then EPUBCheck (validity) and DAISY Ace (accessibility), summarised. */
export async function epub({ path, out, accessibility }) {
  const exported = await runJsx(await script('epub-export'), { path, out }, LONG)
  const added = accessibility ? await addAccessibilityMetadata(out, accessibility) : null
  const [check, ace] = await Promise.all([epubcheck(out), runAce(out)])
  return { ...exported, accessibilityMetadata: added, epubcheck: check, ace }
}

export async function addAccessibilityMetadata(file, a) {
  const files = unzipSync(new Uint8Array(await readFile(file)))
  const container = strFromU8(files['META-INF/container.xml'])
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1]
  if (!opfPath || !files[opfPath]) throw new Error('No package file (OPF) found in the EPUB.')
  let opf = strFromU8(files[opfPath])
  const { lines, prefixes } = a11yMetadata(a)
  if (!lines.length) return { added: 0 }
  // Declare the a11y prefix when an a11y: property is used (schema: and dcterms: are reserved in EPUB 3).
  if (prefixes.length && !/prefix="[^"]*a11y:/.test(opf)) {
    const decl = prefixes.join(' ')
    const tag = /<package\b[^>]*>/.exec(opf)[0]
    // Extend an existing prefix list; add the attribute only when there is none.
    const fixed = /\sprefix="/.test(tag) ? tag.replace(/\sprefix="([^"]*)"/, (m, v) => ` prefix="${v} ${decl}"`) : tag.replace(/>$/, ` prefix="${decl}">`)
    opf = opf.replace(tag, fixed)
  }
  opf = opf.replace('</metadata>', `    ${lines.join('\n    ')}\n  </metadata>`)
  files[opfPath] = strToU8(opf)
  // The mimetype entry must come first and be stored uncompressed.
  const ordered = { mimetype: [files.mimetype, { level: 0 }] }
  for (const [k, v] of Object.entries(files)) if (k !== 'mimetype') ordered[k] = v
  await writeFile(file, zipSync(ordered))
  return { added: lines.length, package: opfPath }
}

/** Preflight, then the print PDF; warns when the page count isn't a whole number of signatures. */
export async function printPdf({ path, out, pdfPreset, preflightProfile, profile }) {
  const preflight = await runJsx(await script('preflight'), { path, profile: preflightProfile }, LONG)
  const sig = await signature({ path, profile })
  const exported = await runJsx(`
    var d = __docAt(), f = new File(ARGS.out);
    if (ARGS.preset) {
      var p = app.pdfExportPresets.itemByName(ARGS.preset);
      if (!p.isValid) throw Error('No PDF preset "' + ARGS.preset + '". Have: ' + app.pdfExportPresets.everyItem().name.join(', '));
      d.exportFile(ExportFormat.PDF_TYPE, f, false, p);
    } else d.exportFile(ExportFormat.PDF_TYPE, f, false);
    return { pdf: f.fsName, exists: f.exists, bytes: f.length };`, { path, out, preset: pdfPreset }, LONG)
  const warnings = []
  if (sig.pagesToNextSignature) warnings.push(`${sig.pages} pages is not a whole number of ${sig.signature}-page signatures: ${sig.pagesToNextSignature} to the next.`)
  if (preflight.problems) warnings.push(`Preflight (${preflight.profile}) found ${preflight.problems} problems.`)
  return { ...exported, warnings, preflight, signature: sig }
}

/**
 * Everything a handoff needs checked, in one report: links, fonts, overset text, layers, preflight,
 * the signature and unused styles. `blockers` stop a clean package; `toReview` are the designer's call.
 */
export async function handoffCheck({ path, profile, preflightProfile }) {
  const h = await runJsx(await script('handoff'), { path }, LONG)
  const [preflight, sig, styles] = await Promise.all([
    runJsx(await script('preflight'), { path: h.path ?? path, profile: preflightProfile }, LONG),
    signature({ path: h.path ?? path, profile }),
    unusedStyles({ path: h.path ?? path }),
  ])
  const blockers = [], toReview = []
  const n = (k, one, many = one + 's') => `${k} ${k === 1 ? one : many}`
  const list = (a, n = 5) => a.slice(0, n).map((x) => (typeof x === 'string' ? x : `${x.link}${x.ppi ? ` (${x.ppi} ppi)` : ''}${x.page ? ` p.${x.page}` : ''}`)).join(', ') + (a.length > n ? `, and ${a.length - n} more` : '')
  if (!h.saved) blockers.push('The document has never been saved. Package needs a saved file.')
  else if (h.modified) blockers.push('The document has unsaved changes. Save it before packaging.')
  if (h.links.missing.length) blockers.push(`${n(h.links.missing.length, 'missing link')}: ${list(h.links.missing)}`)
  if (h.links.inaccessible.length) blockers.push(`${n(h.links.inaccessible.length, 'link')} can't be read: ${list(h.links.inaccessible)}`)
  if (h.fonts.missing.length) blockers.push(`Missing ${n(h.fonts.missing.length, 'font')}: ${list(h.fonts.missing)}`)
  if (h.overset.length) blockers.push(`Overset text in ${n(h.overset.length, 'story', 'stories')}: ${list(h.overset.map((o) => `"${o.startsWith}"${o.lastFrameOnPage ? ` (ends p.${o.lastFrameOnPage})` : ''}`))}`)
  if (h.links.outOfDate.length) toReview.push(`${n(h.links.outOfDate.length, 'link')} out of date (changed since placing): ${list(h.links.outOfDate)}`)
  if (h.fonts.substituted.length) toReview.push(`Substituted fonts: ${list(h.fonts.substituted)}`)
  if (h.fonts.fauxed.length) toReview.push(`Faux (synthesised) styles: ${list(h.fonts.fauxed)}`)
  if (h.fonts.adobeFonts.length) toReview.push(`${n(h.fonts.adobeFonts.length, 'Adobe Font')} not copied into a package (the printer activates them in Creative Cloud): ${list(h.fonts.adobeFonts)}`)
  if (h.fonts.noEmbedding.length) toReview.push(`Fonts whose licence forbids PDF embedding: ${list(h.fonts.noEmbedding)}`)
  if (h.links.lowRes.length) toReview.push(`${n(h.links.lowRes.length, 'image')} under 300 ppi at the placed size: ${list(h.links.lowRes)}`)
  if (h.links.rgb.length) toReview.push(`${n(h.links.rgb.length, 'RGB image')} (fine for EPUB; for print, check with the printer): ${list(h.links.rgb)}`)
  if (h.links.embedded.length) toReview.push(`${n(h.links.embedded.length, 'embedded image')} (not copied to Links): ${list(h.links.embedded)}`)
  if (h.layers.hidden.length) toReview.push(`Hidden layers (packaged, not printed): ${list(h.layers.hidden)}`)
  if (h.layers.nonPrinting.length) toReview.push(`Non-printing layers: ${list(h.layers.nonPrinting)}`)
  if (sig.pagesToNextSignature) toReview.push(`${sig.pages} pages is not a whole number of ${sig.signature}-page signatures: ${sig.pagesToNextSignature} to the next (book_signature).`)
  if (preflight.problems) toReview.push(`Preflight (${preflight.profile}) found ${n(preflight.problems, 'problem')}: ${Object.entries(preflight.byRule).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  const unused = (styles.unusedParagraph?.length ?? 0) + (styles.unusedCharacter?.length ?? 0)
  if (unused) toReview.push(`${n(unused, 'unused style')} could be removed before handoff (book_unused_styles).`)
  return { document: h.document, ready: !blockers.length, blockers, toReview, details: { ...h, preflight, signature: sig, unusedStyles: unused } }
}

/** File › Package into a new folder: fonts, links, IDML, report, optionally a PDF. Never saves the document. */
export async function packageBook({ path, out, fonts = true, links = true, idml = true, pdf = false, pdfPreset, comments }) {
  return runJsx(await script('package'), { path, out, fonts, links, idml, pdf, pdfPreset, comments }, LONG)
}

/** Export each chapter's styled heading block from the layout as an image, for book_epub_direct's `openers`. */
export async function epubOpeners({ path, outDir, profile, resolution = 220, transparent = true }) {
  const styles = loadProfile(profile).epub?.opener ?? []
  if (!styles.length) throw new Error('This profile lists no opener styles (epub.opener).')
  await mkdir(outDir, { recursive: true })
  const r = await runJsx(await script('openers'), { path, outDir, styles, resolution, transparent }, LONG)
  await writeFile(join(outDir, 'openers.json'), JSON.stringify({ document: r.document, resolution, transparent, openers: r.openers }, null, 1))
  return { folder: outDir, count: Object.keys(r.openers).length, skipped: r.skipped, sample: Object.entries(r.openers).slice(0, 3).map(([k, v]) => ({ key: k, ...v })),
    note: transparent ? 'Transparent background: dark type can disappear in a reader\'s night mode. Use transparent: false for a white panel instead.' : 'White background: shows as a white panel in a reader\'s night mode.' }
}
