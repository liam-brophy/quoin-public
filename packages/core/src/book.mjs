// Tagged manuscript -> resolved topics -> one ICML file per topic, plus the report.
// No InDesign: pass the template's style names (if known) so missing styles are fitted.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve as resolvePath } from 'node:path'
import { readDocx } from './docx.mjs'
import { findIsbn, icmlFileNames, topicToIcml } from './icml.mjs'
import { loadProfile } from './profile.mjs'
import { reportMarkdown } from './report.mjs'
import { resolve } from './resolve.mjs'
import { withAutoCharacter } from './job.mjs'

/**
 * @param {{ docx?: string, paragraphs?: Array, out: string, profile?: string|object, book?: string, isbn?: string,
 *           templateStyles?: { paragraph: string[], character: string[] } }} o
 *   paragraphs: tagged paragraphs (e.g. from a job's taggedParagraphs) instead of the tags in docx.
 * @returns {Promise<{ book, out, profile, resolved, isbn, files: Array<{ title, abbr, path, start, excluded }> }>}
 */
export async function writeIcmlBook(o) {
  if (!o.paragraphs && !o.docx) throw new Error('writeIcmlBook needs docx or paragraphs')
  const out = resolvePath(o.out)
  const book = o.book ?? basename(o.docx).replace(/\.docx$/i, '').replace(/_Roundtripped$/i, '')
  const profile = typeof o.profile === 'object' && o.profile ? o.profile : loadProfile(o.profile ?? undefined)
  await mkdir(join(out, 'ICML'), { recursive: true })

  // A job's paragraphs already carry automatic styles; a Word file's get them here.
  const paragraphs = o.paragraphs ?? withAutoCharacter(readDocx(await readFile(o.docx)).paragraphs, profile)
  const t = o.templateStyles
  const resolved = resolve(paragraphs, profile, t && new Set(t.paragraph), t && new Set(t.character))

  const isbn = o.isbn ?? findIsbn(resolved.topics, profile)
  const names = icmlFileNames(resolved.topics, profile, isbn)
  const files = []
  for (const [i, topic] of resolved.topics.entries()) {
    const path = join(out, 'ICML', names[i])
    await writeFile(path, topicToIcml(topic, profile), 'utf8')
    files.push({
      title: topic.title, abbr: topic.abbr, path,
      start: profile.pagination[topic.abbr] ?? profile.pagination.default,
      excluded: profile.printExclude.includes(topic.abbr),
    })
  }
  return { book, out, profile, resolved, isbn, files }
}

/** report.md and report.json beside the ICML; `layout` is whatever the layout step reported (or null). */
export async function writeReport(b, { docx, template, layout = null } = {}) {
  const md = reportMarkdown({ book: b.book, docx, template, profile: b.profile, resolved: b.resolved, indesign: layout })
  await writeFile(join(b.out, 'report.md'), md, 'utf8')
  await writeFile(join(b.out, 'report.json'), JSON.stringify({ report: b.resolved.report, fit: b.resolved.fit, character: b.resolved.character, layout }, null, 1))
  return { path: join(b.out, 'report.md'), markdown: md }
}

/**
 * Tagged manuscript -> checked EPUB, with no InDesign: structure from the tags, typography from the
 * template's IDML (optional), then EPUBCheck and Ace.
 * @param {{ docx?: string, paragraphs?: Array, out: string, profile?: string|object, idml?: string,
 *           meta: { title: string, author?: string, publisher?: string, isbn?: string, language?: string },
 *           a11y?: object, validate?: boolean, images?: string, ornament?: string, openers?: string }} o   out = path of the .epub;
 *   images: folder with the art log's files; ornament: an image for ornamented breaks; openers: folder from the plugin's opener export
 */
export async function buildEpub(o) {
  const { readIdmlStyles } = await import('./idml.mjs')
  const { stylesToCss } = await import('./css.mjs')
  const { writeEpub } = await import('./epub.mjs')
  const profile = typeof o.profile === 'object' && o.profile ? o.profile : loadProfile(o.profile ?? undefined)
  const paragraphs = o.paragraphs ?? withAutoCharacter(readDocx(await readFile(o.docx)).paragraphs, profile)
  const specs = o.idml ? await readIdmlStyles(o.idml) : null
  const resolved = resolve(paragraphs, profile, specs && new Set(specs.paragraph.keys()), specs && new Set(specs.character.keys()))

  // CSS only for the styles this book uses; a style the template lacks takes its fitted parent's look.
  const used = { paragraph: new Set(), character: new Set() }
  const parentOf = new Map((resolved.fit?.missing ?? []).map((m) => [m.name, m.basedOn]))
  for (const t of resolved.topics) for (const it of t.items) {
    used.paragraph.add(it.name)
    for (const r of [...it.runs, ...it.notes.flatMap((n) => n.paragraphs.flatMap((q) => q.runs))]) if (r.name) used.character.add(r.name)
    for (const n of it.notes) for (const s of n.styles ?? []) used.paragraph.add(s)
  }
  for (const t of resolved.topics) if (t.items.some((it) => it.art?.length)) used.paragraph.add(`${t.abbr}_cap`)
  if (specs) for (const [name, parent] of parentOf) if (!specs.paragraph.has(name) && specs.paragraph.get(parent)) specs.paragraph.set(name, specs.paragraph.get(parent))
  const bodyStyle = [...used.paragraph].find((n) => /^chap_p$/.test(n)) ?? [...used.paragraph][0]
  const { css, missing } = stylesToCss(specs, used, { body: bodyStyle, fonts: profile.fonts })

  const { gatherMedia } = await import('./media.mjs')
  const media = await gatherMedia({ resolved, profile, images: o.images, ornament: o.ornament, openers: o.openers })
  const written = await writeEpub({ resolved, profile, out: o.out, meta: o.meta, a11y: o.a11y, css, media })
  let checks = null
  if (o.validate !== false) {
    const { epubcheck, ace } = await import('./validate.mjs')
    const [c, a] = await Promise.all([epubcheck(o.out), ace(o.out)])
    checks = { epubcheck: c, ace: a }
  }
  return { ...written, stylesWithoutCss: specs ? missing : null, ...checks }
}
