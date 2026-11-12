// A resolved book -> EPUB 3, written directly: one XHTML file per topic with real structure
// (epub:type and ARIA roles from the topics, headings, block quotes, lists, scene breaks,
// pop-up footnotes, language spans), navigation, metadata and optional accessibility metadata.
// No InDesign: typography comes from the template's styles (IDML) as CSS.
import { writeFile } from 'node:fs/promises'
import { strToU8, zipSync } from 'fflate'
import { a11yMetadata } from './a11y.mjs'
import { sizeFraction } from './art.mjs'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cls = (n) => esc(n)
const LINE_BREAK = new RegExp('\\u2028', 'g') // a literal U+2028 in source would end the line

// Topic → structural semantics (EPUB 3 Structural Semantics + DPUB-ARIA where one exists).
const TOPIC = {
  chap: ['chapter', 'doc-chapter'], prol: ['prologue', 'doc-prologue'], epil: ['epilogue', 'doc-epilogue'], intro: ['introduction', 'doc-introduction'],
  frwrd: ['foreword', 'doc-foreword'], pref: ['preface', 'doc-preface'], aftwrd: ['afterword', 'doc-afterword'], concl: ['conclusion', 'doc-conclusion'],
  ded: ['dedication', 'doc-dedication'], ackno: ['acknowledgments', 'doc-acknowledgments'], apx: ['appendix', 'doc-appendix'], glos: ['glossary', 'doc-glossary'],
  bib: ['bibliography', 'doc-bibliography'], idx: ['index', 'doc-index'], endno: ['endnotes', 'doc-endnotes'], part: ['part', 'doc-part'],
  cpy: ['copyright-page', null], ecpy: ['copyright-page', null], ttlpg: ['titlepage', null], httlpg: ['halftitlepage', null],
  ata: ['contributors', null], epi: ['epigraph', 'doc-epigraph'],
}
const BACK = new Set(['ata', 'ackno', 'aunote', 'apx', 'glos', 'bib', 'idx', 'endno', 'aftwrd', 'concl', 'mktg', 'rm'])

const LIST = (tag) => { const m = /^(ul|bl|nl|ll)\d?$/.exec(tag ?? ''); return m ? (m[1] === 'nl' || m[1] === 'll' ? 'ol' : 'ul') : null }

/** Inline runs → XHTML, with footnote references at their offsets. */
function inline(runs, profile, notes, refs) {
  const langs = profile.epub?.langCodes ?? {}
  const out = []
  const sorted = (notes ?? []).slice().sort((a, b) => a.offset - b.offset)
  let at = 0, k = 0
  const emitNotes = (upTo) => {
    while (k < sorted.length && sorted[k].offset <= upTo) out.push(refs(sorted[k++]))
  }
  for (const r of runs) {
    let text = r.text
    // Cut the run at any footnote reference inside it.
    while (text.length) {
      const next = k < sorted.length ? sorted[k].offset : Infinity
      const take = next > at && next < at + text.length ? next - at : text.length
      out.push(span(text.slice(0, take), r.name, langs))
      text = text.slice(take); at += take
      emitNotes(at)
    }
    if (!r.text.length) emitNotes(at)
  }
  emitNotes(Infinity)
  return out.join('')
}

function span(text, style, langs) {
  if (!text) return ''
  const t = esc(text).replace(LINE_BREAK, '<br/>').replace(/\t/g, ' ')
  if (!style) return t
  if (style === 'i') return `<i>${t}</i>`
  if (style === 'b') return `<b>${t}</b>`
  if (style === 'bi') return `<b><i>${t}</i></b>`
  if (style === 'emph') return `<em>${t}</em>`
  if (style === 'sup') return `<sup>${t}</sup>`
  if (style === 'sub') return `<sub>${t}</sub>`
  if (style === 'redact') return `<span class="redact" role="img" aria-label="redacted">${t}</span>`
  const lang = langs[style]
  return lang ? `<span class="${cls(style)}" lang="${lang}" xml:lang="${lang}">${t}</span>` : `<span class="${cls(style)}">${t}</span>`
}

/**
 * @param {{ resolved, profile, out: string, meta: { title, author?, publisher?, isbn?, language?, modified? },
 *           a11y?: object, css: string }} o
 */
export async function writeEpub(o) {
  const { resolved, profile, meta } = o
  const lang = meta.language ?? profile.epub?.language ?? 'en-US'
  const exclude = new Set(profile.epub?.exclude ?? ['toc'])
  // E-book copyright replaces the print one when the book has both.
  if (resolved.topics.some((t) => t.abbr === 'ecpy')) exclude.add('cpy')
  const headings = profile.epub?.headings ?? {}
  const quotes = new Set(profile.epub?.blockquote ?? [])
  const lists = profile.epub?.lists ?? null
  const breaks = profile.epub?.breaks ? new Set(profile.epub.breaks) : null
  const bodyStart = new Set(profile.icmlNames?.bodyStartTopics ?? ['chap', 'prol', 'part'])
  const firstBody = resolved.topics.findIndex((t) => bodyStart.has(t.abbr))
  const warnings = [...(o.media?.warnings ?? [])]
  const media = o.media ?? null
  const openerTags = new Set(profile.epub?.opener ?? [])
  const ornamentTags = new Set(profile.epub?.ornamentTags ?? ['txb1', 'txb3'])
  let noteNo = 0, figureCount = 0

  const docs = []
  resolved.topics.forEach((t, ti) => {
    if (exclude.has(t.abbr)) return
    const id = `t${String(docs.length + 1).padStart(3, '0')}`
    const matter = BACK.has(t.abbr) ? 'backmatter' : firstBody >= 0 && ti >= firstBody ? 'bodymatter' : 'frontmatter'
    // An author's note is a preface before the story and an afterword after it.
    const [type, role] = t.abbr === 'aunote' ? (matter === 'frontmatter' ? ['preface', 'doc-preface'] : ['afterword', 'doc-afterword']) : TOPIC[t.abbr] ?? [null, null]
    const notes = []
    const refs = (n) => {
      const no = ++noteNo
      notes.push({ no, n })
      return `<a epub:type="noteref" role="doc-noteref" href="#fn${no}" id="fnref${no}">${no}</a>`
    }
    const body = []
    let headingId = null, title = null
    let group = null // { tag: 'blockquote'|'ul'|'ol', key, html: [] }
    let box = null // { id, type, html: [] }
    const flushGroup = () => {
      if (!group) return
      const html = group.tag === 'blockquote'
        ? `<blockquote>\n${group.html.join('\n')}\n</blockquote>`
        : `<${group.tag}${group.unmarked ? ' class="list-unmarked"' : ''}>\n${group.html.join('\n')}\n</${group.tag}>`
      ;(box ? box.html : body).push(html)
      group = null
    }
    const flushBox = () => { flushGroup(); if (box) { body.push(`<div class="${cls(box.type)}">\n${box.html.join('\n')}\n</div>`); box = null } }

    // A styled chapter opener: the heading lines as one image exported from the layout, with their text as its alt.
    let skip = 0
    const op = media?.openers.get(media.names[ti])
    if (op) {
      let lead = 0
      while (lead < t.items.length && openerTags.has(t.items[lead].tag)) lead++
      if (lead && lead === op.paragraphs) {
        const lines = t.items.slice(0, lead).map((x) => x.runs.map((r) => r.text).join('').trim()).filter(Boolean)
        headingId = `${id}-h0`
        title = (t.items.slice(0, lead).find((x) => headings[x.tag]) ?? t.items[0]).runs.map((r) => r.text).join('')
        body.push(`<h1 class="opener" id="${headingId}"><img src="../images/${op.name}" alt="${esc(lines.join('. '))}"/></h1>`)
        skip = lead
      } else warnings.push(`${t.title}: the opener image covers ${op.paragraphs} paragraphs but the text has ${lead} opener lines; kept as text`)
    }
    const figure = (item) => {
      const f = media?.figures.get(item.file)
      if (!f) return null
      if (!item.alt) warnings.push(`art ${item.id}: no alt text in the art log (the image is treated as decorative)`)
      const pct = Math.round(sizeFraction(item.size) * 100)
      const cap = [item.caption && esc(item.caption), item.credit && `<span class="credit">${esc(item.credit)}</span>`].filter(Boolean).join(' ')
      figureCount++
      return `<figure class="art"${pct < 100 ? ` style="width:${pct}%"` : ''}><img src="../images/${f.name}" alt="${esc(item.alt ?? '')}"/>${cap ? `<figcaption class="${cls(`${t.abbr}_cap`)}">${cap}</figcaption>` : ''}</figure>`
    }
    let afterPara = []
    for (const [k, it] of t.items.entries()) {
      if (k < skip) continue
      // Containers (e.g. a run of text messages, a voice) become a div around their paragraphs.
      if ((it.containerId ?? null) !== (box?.id ?? null)) { flushBox(); if (it.container) box = { id: it.containerId, type: it.container, html: [] } }
      const text = inline(it.runs, profile, it.notes, refs)
      const target = () => (box ? box.html : body)
      // Art: before its paragraph when it sits at the paragraph's start, otherwise after it.
      if (afterPara.length) { flushGroup(); target().push(...afterPara); afterPara = [] }
      for (const a of it.art ?? []) {
        const html = figure(a.item)
        if (!html) continue
        if (a.offset === 0) { flushGroup(); target().push(html) } else afterPara.push(html)
      }
      const level = headings[it.tag]
      if (level) {
        flushGroup()
        const hid = `${id}-h${target().length}`
        if (!headingId) { headingId = hid; title = it.runs.map((r) => r.text).join('') }
        target().push(`<${level} class="${cls(it.name)}" id="${hid}">${text}</${level}>`)
        continue
      }
      if (breaks ? breaks.has(it.tag) : /^txb\d/.test(it.tag)) {
        flushGroup()
        if (media?.ornament && ornamentTags.has(it.tag)) target().push(`<div class="ornament ${cls(it.name)}" role="separator"><img src="../images/${media.ornament.name}" alt=""/></div>`)
        else target().push(`<hr class="${cls(it.name)}${it.tag === 'txb2' || breaks ? '' : ' ornament'}"/>`)
        continue
      }
      const list = lists ? lists[it.tag] ?? null : LIST(it.tag), quote = quotes.has(it.tag)
      const wrap = list ?? (quote ? 'blockquote' : null)
      if (wrap) {
        const key = `${wrap}:${list && !lists ? it.tag.replace(/\d$/, '') : it.tag}`
        if (group?.key !== key) { flushGroup(); group = { tag: wrap, key, html: [], unmarked: !lists && it.tag.startsWith('ul') } }
        group.html.push(list ? `<li class="${cls(it.name)}">${text}</li>` : `<p class="${cls(it.name)}">${text}</p>`)
        continue
      }
      flushGroup()
      target().push(`<p class="${cls(it.name)}">${text}</p>`)
    }
    if (afterPara.length) { flushGroup(); (box ? box.html : body).push(...afterPara) }
    flushBox()
    // A page with no heading takes a plain name, so navigation and readers have something to show.
    const PLAIN = { cpy: 'Copyright', ecpy: 'Copyright', ded: 'Dedication', ttlpg: 'Title Page', httlpg: 'Half Title', epi: 'Epigraph' }
    const label = title ?? PLAIN[t.abbr] ?? t.title ?? t.abbr
    const notesHtml = notes.map(({ no, n }) => {
      const paras = (n.paragraphs.length ? n.paragraphs : [{ runs: [] }]).map((q, k) =>
        `<p class="${cls(n.styles?.[k] ?? 'ftnt')}">${k === 0 ? `<a href="#fnref${no}">${no}</a> ` : ''}${inline(q.runs.map((r) => ({ ...r, name: r.name ?? null })), profile, [], refs)}</p>`)
      return `<aside epub:type="footnote" role="doc-footnote" id="fn${no}">\n${paras.join('\n')}\n</aside>`
    })
    const sectionAttrs = [type ? `epub:type="${type}"` : '', role ? `role="${role}"` : '', headingId ? `aria-labelledby="${headingId}"` : `aria-label="${esc(label)}"`].filter(Boolean).join(' ')
    const html = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head>
<meta charset="UTF-8"/>
<title>${esc(label)}</title>
<link rel="stylesheet" type="text/css" href="../css/book.css"/>
</head>
<body epub:type="${matter}">
<section ${sectionAttrs}>
${body.join('\n')}
</section>
${notesHtml.join('\n')}
</body>
</html>
`
    docs.push({ id, file: `xhtml/${id}.xhtml`, html, label, abbr: t.abbr, matter, inToc: t.abbr !== 'httlpg' })
  })

  const toc = docs.filter((d) => d.inToc)
  const start = docs.find((d) => d.matter === 'bodymatter') ?? docs[0]
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head><meta charset="UTF-8"/><title>Contents</title><link rel="stylesheet" type="text/css" href="css/book.css"/></head>
<body epub:type="frontmatter">
<nav epub:type="toc" role="doc-toc" id="toc">
<h1>Contents</h1>
<ol>
${toc.map((d) => `<li><a href="${d.file}">${esc(d.label)}</a></li>`).join('\n')}
</ol>
</nav>
<nav epub:type="landmarks" id="landmarks" hidden="hidden">
<ol>
<li><a epub:type="toc" href="nav.xhtml#toc">Contents</a></li>
<li><a epub:type="bodymatter" href="${start.file}">Start of content</a></li>
</ol>
</nav>
</body>
</html>
`
  const ident = meta.isbn ? `urn:isbn:${meta.isbn.replace(/[^0-9Xx]/g, '')}` : `urn:uuid:${crypto.randomUUID()}`
  const modified = (meta.modified ?? new Date()).toISOString().replace(/\.\d+Z$/, 'Z')
  const a11y = o.a11y ? a11yMetadata(o.a11y) : { lines: [], prefixes: [] }
  const prefixes = a11y.prefixes.length ? ` prefix="${a11y.prefixes.join(' ')}"` : ''
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}"${prefixes}>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${esc(ident)}</dc:identifier>
    <dc:title>${esc(meta.title)}</dc:title>
    ${meta.author ? `<dc:creator>${esc(meta.author)}</dc:creator>` : ''}
    ${meta.publisher ? `<dc:publisher>${esc(meta.publisher)}</dc:publisher>` : ''}
    <dc:language>${lang}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
    ${a11y.lines.join('\n    ')}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="css/book.css" media-type="text/css"/>
${(media?.files ?? []).map((f, k) => `    <item id="img${k + 1}" href="images/${f.name}" media-type="${f.type}"/>`).join('\n')}
${docs.map((d) => `    <item id="${d.id}" href="${d.file}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine>
    <itemref idref="nav" linear="no"/>
${docs.map((d) => `    <itemref idref="${d.id}"/>`).join('\n')}
  </spine>
</package>
`
  const files = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n`),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8(nav),
    'OEBPS/css/book.css': strToU8(o.css),
  }
  for (const d of docs) files[`OEBPS/${d.file}`] = strToU8(d.html)
  for (const f of media?.files ?? []) files[`OEBPS/images/${f.name}`] = [f.bytes, { level: 0 }]
  await writeFile(o.out, zipSync(files))
  if ((media?.files.length ?? 0) && o.a11y && !(o.a11y.accessMode ?? []).includes('visual')) warnings.push('The EPUB has images but the accessibility metadata does not list "visual" as an access mode: confirm with the publisher.')
  return { epub: o.out, files: docs.length, notes: noteNo, figures: figureCount, openers: media?.openers.size ?? 0, images: media?.files.length ?? 0, warnings }
}
