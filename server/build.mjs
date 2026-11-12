// The InDesign half of a build: copy the template, read its style names, let the core write
// the ICML, then flow it into the copy. Everything else lives in book-core.
import { copyFile, mkdir } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'
import { writeIcmlBook, writeReport } from 'book-core/book'
import { runJsx, script } from './bridge.mjs'

/**
 * @param {{ docx?: string, paragraphs?: Array, template?: string, out: string, profile?: string, book?: string, isbn?: string, indesign?: boolean }} o
 */
export async function buildBook(o) {
  const out = resolvePath(o.out)
  const inDesign = o.indesign !== false
  let indd = null, templateStyles = null
  if (inDesign) {
    const name = o.book ?? (o.docx ? o.docx.split('/').pop().replace(/\.docx$/i, '').replace(/_Roundtripped$/i, '') : 'Book')
    indd = join(out, `${name}.indd`)
    await mkdir(out, { recursive: true })
    await copyFile(o.template, indd)
    templateStyles = await runJsx(await script('style-names'), { path: indd })
  }

  const b = await writeIcmlBook({ ...o, out, templateStyles })

  let layout = null
  if (inDesign) {
    layout = await runJsx(await script('build-book'), {
      indd,
      master: b.profile.master,
      icmls: b.files.filter((f) => !f.excluded).map((f) => ({ path: f.path, title: f.title, start: f.start })),
      missingParagraph: b.resolved.fit.missing.map(({ name, basedOn }) => ({ name, basedOn })),
      missingCharacter: b.resolved.character.used.filter((c) => c.inTemplate === false).map((c) => c.name),
      fonts: b.profile.fonts ?? null,
      page: o.page ?? null,
    }, { timeoutMs: 20 * 60_000 })
    layout.excluded = b.files.filter((f) => f.excluded).map((f) => f.title)
  }

  const r = await writeReport(b, { docx: o.docx, template: o.template, layout })
  return { out, indd, report: r.path, summary: r.markdown, pages: layout?.pages ?? null, signature: b.profile.signature ?? null }
}
