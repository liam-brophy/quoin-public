import { artNoteText } from './art.mjs'

// Writes one InCopy (ICML) story per topic. Styles are declared by name only, so
// on placing, InDesign uses the document's definitions for every style it has.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// XML 1.0 forbids most C0 controls; keep tab. U+2028 is InDesign's forced line break.
const clean = (s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')

const NO_CHAR = 'CharacterStyle/$ID/[No character style]'
const selfFor = (kind, name) => `${kind}/${esc(name).replace(/:/g, '%3a')}`

/** Character ranges for runs; `br` closes the paragraph. */
function ranges(runs, cStyles, br) {
  const list = runs.length ? runs : [{ text: '', name: null }]
  return list.map((r, j) => {
    if (r.name) cStyles.add(r.name)
    const style = r.name ? selfFor('CharacterStyle', r.name) : NO_CHAR
    const content = clean(r.text) ? `<Content>${esc(clean(r.text))}</Content>` : ''
    return `   <CharacterStyleRange AppliedCharacterStyle="${style}">${content}${br && j === list.length - 1 ? '<Br/>' : ''}</CharacterStyleRange>`
  })
}

/** Split runs at the given character offsets (for footnote references). */
function splitAt(runs, offsets) {
  const out = []
  let at = 0
  const cuts = [...new Set(offsets)].sort((x, y) => x - y)
  for (const r of runs) {
    let text = r.text, start = at
    for (const c of cuts) if (c > start && c < start + text.length) {
      out.push({ ...r, text: text.slice(0, c - start) })
      text = text.slice(c - start); start = c
    }
    out.push({ ...r, text })
    at += r.text.length
  }
  return out
}

// A footnote: an inline story whose first character is InDesign's automatic number (<?ACE 4?>).
function footnote(n, pStyles, cStyles, fn) {
  cStyles.add(fn.reference); cStyles.add(fn.number)
  const paras = n.paragraphs.length ? n.paragraphs : [{ runs: [] }]
  const inner = paras.map((q, k) => {
    const style = n.styles?.[k] ?? 'ftnt'
    pStyles.add(style)
    const number = k === 0 ? `   <CharacterStyleRange AppliedCharacterStyle="${selfFor('CharacterStyle', fn.number)}"><Content><?ACE 4?></Content></CharacterStyleRange>\n   <CharacterStyleRange AppliedCharacterStyle="${NO_CHAR}"><Content>${esc(fn.separator ?? ' ')}</Content></CharacterStyleRange>\n` : ''
    return `  <ParagraphStyleRange AppliedParagraphStyle="${selfFor('ParagraphStyle', style)}">\n${number}${ranges(q.runs, cStyles, k < paras.length - 1).join('\n')}\n  </ParagraphStyleRange>`
  })
  return `   <CharacterStyleRange AppliedCharacterStyle="${selfFor('CharacterStyle', fn.reference)}"><Footnote>\n${inner.join('\n')}\n   </Footnote></CharacterStyleRange>`
}

// An InCopy/InDesign Note (Window › Editorial › Notes) saying which art goes here.
function artNote(item) {
  const lines = artNoteText(item).map(esc)
  const content = lines.map((l, k) => `<Content>${l}</Content>${k < lines.length - 1 ? '<Br/>' : ''}`).join('')
  return `   <CharacterStyleRange AppliedCharacterStyle="${NO_CHAR}"><Note Collapsed="true" UserName="Art log"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/[No paragraph style]"><CharacterStyleRange AppliedCharacterStyle="${NO_CHAR}">${content}</CharacterStyleRange></ParagraphStyleRange></Note></CharacterStyleRange>`
}

/** @param {{ items: Array<{ name: string, runs: Array<{ text: string, name?: string|null }>, notes?: Array }> }} topic */
export function topicToIcml(topic, profile = {}) {
  const fn = { reference: 'fni', number: 'fn', ...(profile.footnotes ?? {}) }
  const pStyles = new Set(), cStyles = new Set()
  const body = []
  topic.items.forEach((it, i) => {
    pStyles.add(it.name)
    const last = i === topic.items.length - 1
    // Footnotes and art notes, each written at its character position.
    const notes = [...(it.notes ?? []).map((n) => ({ offset: n.offset, xml: () => footnote(n, pStyles, cStyles, fn) })),
      ...(it.art ?? []).map((a) => ({ offset: a.offset, xml: () => artNote(a.item) }))].sort((x, y) => x.offset - y.offset)
    let parts
    if (!notes.length) parts = ranges(it.runs, cStyles, !last)
    else {
      const runs = splitAt(it.runs, notes.map((n) => n.offset))
      parts = []
      let at = 0, k = 0
      runs.forEach((r) => {
        while (k < notes.length && notes[k].offset <= at) parts.push(notes[k++].xml())
        parts.push(...ranges([r], cStyles, false))
        at += r.text.length
      })
      while (k < notes.length) parts.push(notes[k++].xml())
      if (!last) parts.push(`   <CharacterStyleRange AppliedCharacterStyle="${NO_CHAR}"><Br/></CharacterStyleRange>`)
    }
    body.push(`  <ParagraphStyleRange AppliedParagraphStyle="${selfFor('ParagraphStyle', it.name)}">\n${parts.join('\n')}\n  </ParagraphStyleRange>`)
  })

  const pDecl = [...pStyles].map((n) => `  <ParagraphStyle Self="${selfFor('ParagraphStyle', n)}" Name="${esc(n)}"/>`)
  const cDecl = [...cStyles].map((n) => `  <CharacterStyle Self="${selfFor('CharacterStyle', n)}" Name="${esc(n)}"/>`)
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<?aid style="50" type="snippet" readerVersion="6.0" featureSet="513" product="8.0(370)" ?>
<?aid SnippetType="InCopyInterchange"?>
<Document DOMVersion="8.0" Self="d">
 <RootCharacterStyleGroup Self="rcsg">
  <CharacterStyle Self="${NO_CHAR}" Name="$ID/[No character style]"/>
${cDecl.join('\n')}
 </RootCharacterStyleGroup>
 <RootParagraphStyleGroup Self="rpsg">
  <ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]"/>
${pDecl.join('\n')}
 </RootParagraphStyleGroup>
 <Story Self="story" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="${esc(topic.title ?? '')}" AppliedNamedGrid="n">
  <StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>
${body.join('\n')}
 </Story>
</Document>
`
}

/**
 * File names in the house pattern: A001_9780000000002_TitlePage.icml for front matter,
 * B001_… from the first body topic. Falls back to "01_chap.icml" without an ISBN.
 */
export function icmlFileNames(topics, profile, isbn) {
  const cfg = profile.icmlNames ?? {}
  const body = new Set(cfg.bodyStartTopics ?? ['chap', 'prol', 'part'])
  const firstBody = topics.findIndex((t) => body.has(t.abbr))
  const count = { A: 0, B: 0 }
  const used = new Set()
  return topics.map((t, i) => {
    if (!isbn) return `${String(i + 1).padStart(2, '0')}_${t.abbr}.icml`
    const section = firstBody >= 0 && i >= firstBody ? 'B' : 'A'
    count[section]++
    let title = (t.title ?? t.abbr).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9.()]+/g, '') || t.abbr
    let name = (cfg.pattern ?? '{section}{n}_{isbn}_{title}').replace('{section}', section).replace('{n}', String(count[section]).padStart(3, '0'))
      .replace('{isbn}', isbn).replace('{title}', title)
    while (used.has(name)) name += '_'
    used.add(name)
    return `${name}.icml`
  })
}

/** The print ISBN from the copyright page ("ISBN 978-0-00-000000-2"), digits only. */
export function findIsbn(topics, profile) {
  const ex = new Set(profile.printExclude ?? [])
  for (const t of topics) {
    if (ex.has(t.abbr)) continue
    for (const it of t.items) {
      const m = /ISBN[:\s]*((?:97[89][-\s]?)?\d[-\s\d]{8,15}[\dXx])/.exec(it.runs.map((r) => r.text).join(''))
      if (m) return m[1].replace(/[^0-9Xx]/g, '')
    }
  }
  return null
}
