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
