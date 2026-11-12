// Reads a .docx into paragraphs of styled runs. No Word or InDesign needed.
import { strFromU8, unzipSync } from 'fflate'
import { SaxesParser } from 'saxes'

const ON = (attrs) => !['0', 'false', 'none'].includes(attrs['w:val'])

/** Map Word style IDs to display names ("Heading1" -> "heading 1", "p" -> "p"). */
function readStyles(xml) {
  const names = new Map()
  const types = new Map()
  let id = null, type = null
  const sax = new SaxesParser()
  sax.on('opentag', ({ name, attributes: a }) => {
    if (name === 'w:style') { id = a['w:styleId']; type = a['w:type'] }
    else if (name === 'w:name' && id) { names.set(id, a['w:val']); types.set(id, type) }
  })
  sax.on('closetag', ({ name }) => { if (name === 'w:style') id = null })
  sax.write(xml).close()
  return { names, types }
}

/**
 * @returns {{ paragraphs: Array<{ style: string, runs: Array<{ text: string, cstyle: string|null, fmt: object }>,
 *            notes: Array<{ kind: 'footnote'|'endnote', id: string, offset: number, paragraphs: Array<{ style, runs }> }>, inTable: boolean }>,
 *            stats: object }}
 */
export function readDocx(buffer) {
  const parts = ['word/document.xml', 'word/styles.xml', 'word/footnotes.xml', 'word/endnotes.xml']
  const files = unzipSync(new Uint8Array(buffer), { filter: (f) => parts.includes(f.name) })
  if (!files['word/document.xml']) throw new Error('Not a Word document (no word/document.xml).')
  const { names } = files['word/styles.xml'] ? readStyles(strFromU8(files['word/styles.xml'])) : { names: new Map() }
  const styleName = (id) => names.get(id) ?? id
  const stats = { tables: 0, deletedRuns: 0, directFormatting: 0, fields: 0, footnotes: 0, endnotes: 0 }

  const { paragraphs } = parsePart(strFromU8(files['word/document.xml']), styleName, stats)
  // Note bodies, keyed by id; separators (Word's own rule lines) are left out.
  const bodies = { footnote: {}, endnote: {} }
  for (const kind of ['footnote', 'endnote']) {
    const f = files[`word/${kind}s.xml`]
    if (f) bodies[kind] = parsePart(strFromU8(f), styleName, stats).notes
  }
  for (const p of paragraphs) for (const n of p.notes) {
    n.paragraphs = bodies[n.kind][n.id] ?? []
    stats[`${n.kind}s`]++
  }
  return { paragraphs, stats }
}

/** One part of the package: body paragraphs, or (in footnotes.xml / endnotes.xml) paragraphs grouped by note id. */
function parsePart(xml, styleName, stats) {
  const paragraphs = []
  const notes = {}
  let note = null // id of the w:footnote / w:endnote being read, if any
  let para = null, run = null
  let inRPr = false, inPPr = false, inText = false, deleted = 0, inInstr = false, tableDepth = 0

  const startRun = () => { run = { text: '', cstyle: null, fmt: {} } }
  const endRun = () => {
    if (!run || !para || !run.text) { run = null; return }
    if (Object.keys(run.fmt).length && !run.cstyle) stats.directFormatting++
    const last = para.runs.at(-1)
    if (last && last.cstyle === run.cstyle && sameFmt(last.fmt, run.fmt)) last.text += run.text
    else para.runs.push(run)
    run = null
  }
  // Where a note reference sits: characters before it in the paragraph.
  const offset = () => para.runs.reduce((n, r) => n + r.text.length, 0) + (run ? run.text.length : 0)

  const sax = new SaxesParser()
  sax.on('opentag', ({ name, attributes: a }) => {
    switch (name) {
      case 'w:footnote': case 'w:endnote':
        note = a['w:type'] && a['w:type'] !== 'normal' ? null : a['w:id']
        if (note) notes[note] = []
        break
      case 'w:tbl': tableDepth++; stats.tables++; break
      case 'w:p': para = { style: 'Normal', runs: [], notes: [], inTable: tableDepth > 0 }; break
      case 'w:pPr': inPPr = true; break
      case 'w:pStyle': if (inPPr && para) para.style = styleName(a['w:val']); break
      case 'w:del': deleted++; stats.deletedRuns++; break
      case 'w:r': startRun(); break
      case 'w:rPr': inRPr = true; break
      case 'w:rStyle': if (inRPr && run) run.cstyle = styleName(a['w:val']); break
      case 'w:i': if (inRPr && run && ON(a)) run.fmt.i = true; break
      case 'w:b': if (inRPr && run && ON(a)) run.fmt.b = true; break
      case 'w:smallCaps': if (inRPr && run && ON(a)) run.fmt.sc = true; break
      case 'w:caps': if (inRPr && run && ON(a)) run.fmt.caps = true; break
      case 'w:strike': if (inRPr && run && ON(a)) run.fmt.strike = true; break
      case 'w:u': if (inRPr && run && ON(a)) run.fmt.u = true; break
      case 'w:vertAlign': if (inRPr && run && a['w:val'] !== 'baseline') run.fmt[a['w:val'] === 'superscript' ? 'sup' : 'sub'] = true; break
      case 'w:t': inText = !deleted; break
      case 'w:instrText': inInstr = true; stats.fields++; break
      case 'w:tab': if (run && !inRPr && !deleted) run.text += '\t'; break
      case 'w:br': if (run && !deleted && (a['w:type'] ?? 'textWrapping') === 'textWrapping') run.text += '\u2028'; break
      case 'w:noBreakHyphen': if (run && !deleted) run.text += '‑'; break
      case 'w:softHyphen': if (run && !deleted) run.text += '­'; break
      case 'w:sym': if (run && !deleted) run.text += String.fromCharCode(parseInt(a['w:char'], 16) & 0xffff); break
      case 'w:footnoteReference': if (para) para.notes.push({ kind: 'footnote', id: a['w:id'], offset: offset() }); break
      case 'w:endnoteReference': if (para) para.notes.push({ kind: 'endnote', id: a['w:id'], offset: offset() }); break
    }
  })
  sax.on('text', (t) => { if (inText && run && !inInstr) run.text += t })
  sax.on('closetag', ({ name }) => {
    switch (name) {
      case 'w:footnote': case 'w:endnote': note = null; break
      case 'w:tbl': tableDepth--; break
      case 'w:pPr': inPPr = false; break
      case 'w:rPr': inRPr = false; break
      case 'w:t': inText = false; break
      case 'w:instrText': inInstr = false; break
      case 'w:del': deleted--; break
      case 'w:r': endRun(); break
      case 'w:p':
        if (para) {
          // A note body starts with Word's own number marker (w:footnoteRef): it carries no text, so nothing to strip.
          if (note) notes[note].push({ style: para.style, runs: trimLead(para.runs) })
          else if (note === null && !insideNotePart) paragraphs.push(para)
        }
        para = null
        break
    }
  })
  // footnotes.xml / endnotes.xml hold only notes; their paragraphs never join the body.
  const insideNotePart = /<w:(footnotes|endnotes)\b/.test(xml.slice(0, 2000))
  sax.write(xml).close()
  return { paragraphs, notes }
}

// Word writes "<number> note text": the number is a field, the space after it is real text.
function trimLead(runs) {
  if (runs[0]?.text) runs[0] = { ...runs[0], text: runs[0].text.replace(/^\s+/, '') }
  return runs.filter((r) => r.text)
}

function sameFmt(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => b[k] === a[k])
}

export const textOf = (p) => p.runs.map((r) => r.text).join('')
