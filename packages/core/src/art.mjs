// Art logs: read the publisher's log (CSV or XLSX), find where each piece goes in the manuscript
// (a callout, or an anchor phrase from the log), and say what to put there. No InDesign.
import { readFile } from 'node:fs/promises'
import { strFromU8, unzipSync } from 'fflate'
import { SaxesParser } from 'saxes'

// Column names art logs commonly use, by field. Matched after lowercasing and dropping punctuation.
const COLUMNS = {
  id: ['art id', 'artid', 'id', 'fig', 'figure', 'figure no', 'fig no', 'figure number', 'art no', 'art number', 'art', 'image id', 'number', 'no', 'item'],
  file: ['file', 'filename', 'file name', 'image', 'image file', 'art file', 'image filename', 'file names'],
  caption: ['caption', 'legend', 'caption text'],
  credit: ['credit', 'credit line', 'source', 'courtesy', 'photo credit'],
  alt: ['alt', 'alt text', 'alttext', 'alternative text', 'description', 'image description', 'alt description'],
  size: ['size', 'placement size', 'width', 'dimensions', 'print size', 'trim'],
  placement: ['placement', 'place', 'location', 'position', 'insert after', 'after', 'anchor', 'placed after', 'place after', 'callout', 'where'],
  chapter: ['chapter', 'chap', 'ch', 'section', 'part'],
  color: ['color', 'colour', 'color mode', 'colour mode', 'ink', 'inks'],
  notes: ['notes', 'note', 'comments', 'instructions', 'comp notes'],
}
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim()

/** Rows of a CSV file (quoted fields, commas or tabs). */
function parseCsv(text) {
  const sep = (text.split('\n')[0].match(/\t/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? '\t' : ','
  const rows = []
  let row = [], field = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (c === '"') q = false
      else field += c
    } else if (c === '"') q = true
    else if (c === sep) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

/** Rows of the first sheet of an .xlsx file. */
function parseXlsx(bytes) {
  const z = unzipSync(bytes)
  const shared = []
  if (z['xl/sharedStrings.xml']) {
    let cur = null
    const sax = new SaxesParser()
    sax.on('opentag', (t) => { if (t.name === 'si') cur = '' })
    sax.on('text', (t) => { if (cur !== null) cur += t })
    sax.on('closetag', (t) => { if (t.name === 'si') { shared.push(cur); cur = null } })
    sax.write(strFromU8(z['xl/sharedStrings.xml'])).close()
  }
  const sheet = Object.keys(z).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0]
  if (!sheet) throw new Error('No worksheet found in the .xlsx file.')
  const rows = []
  let row = null, col = 0, type = null, inV = false, val = ''
  const colIndex = (ref) => { let n = 0; for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1 }
  const sax = new SaxesParser()
  sax.on('opentag', (t) => {
    if (t.name === 'row') row = []
    else if (t.name === 'c') { col = colIndex(t.attributes.r); type = t.attributes.t ?? null; val = '' }
    else if (t.name === 'v' || t.name === 't') inV = true
  })
  sax.on('text', (t) => { if (inV) val += t })
  sax.on('closetag', (t) => {
    if (t.name === 'v' || t.name === 't') inV = false
    else if (t.name === 'c' && row) row[col] = type === 's' ? shared[Number(val)] ?? '' : val
    else if (t.name === 'row') { rows.push(Array.from(row, (x) => x ?? '')); row = null }
  })
  sax.write(strFromU8(z[sheet])).close()
  return rows
}

/**
 * Read an art log. The header is the first row naming at least two known columns.
 * @returns {{ items: Array<{ row, id, file, caption, credit, alt, size, placement, chapter, color, notes }>, columns: object, ignored: string[] }}
 */
export async function readArtLog(path) {
  const bytes = await readFile(path)
  const rows = /\.xlsx$/i.test(path) ? parseXlsx(new Uint8Array(bytes)) : parseCsv(new TextDecoder().decode(bytes))
  const fieldOf = (h) => Object.entries(COLUMNS).find(([, names]) => names.includes(norm(h)))?.[0]
  const headerAt = rows.findIndex((r) => r.filter((h) => fieldOf(h)).length >= 2)
  if (headerAt < 0) throw new Error(`No header row found. Expected columns such as: ${['id', 'file', 'caption', 'placement'].map((k) => `"${COLUMNS[k][0]}"`).join(', ')}.`)
  const header = rows[headerAt]
  const columns = {}, ignored = []
  header.forEach((h, i) => { const f = fieldOf(h); if (f && columns[f] === undefined) columns[f] = i; else if (String(h).trim()) ignored.push(String(h).trim()) })
  const items = []
  rows.slice(headerAt + 1).forEach((r, k) => {
    const get = (f) => (columns[f] === undefined ? '' : String(r[columns[f]] ?? '').trim())
    const item = Object.fromEntries(Object.keys(COLUMNS).map((f) => [f, get(f)]))
    if (!item.id && !item.file) return
    item.id ||= item.file.replace(/\.[a-z0-9]+$/i, '')
    item.row = headerAt + k + 2
    items.push(item)
  })
  return { items, columns: Object.fromEntries(Object.entries(columns).map(([f, i]) => [f, header[i]])), ignored }
}

// A callout: bracketed editor markup that names the art, e.g. "[Insert Fig. 2.1 here]", "<Map>", "{art: photo3.tif}".
const CALLOUT = /[[<{]\s*(?:(?:insert|place|add|art|fig(?:ure)?|image|img|photo|map|illus\w*|chart|plate|table)\b[^\]>}]*|[^\]>}]*\.(?:jpe?g|png|tiff?|psd|ai|eps|pdf|gif|svg)[^\]>}]*)[\]>}]/gi
const words = (s) => norm(s).replace(/\b(fig|figure|art|image|map|photo|plate|illus\w*|insert|place|here|add|filename|file)\b/g, ' ').replace(/\s+/g, ' ').trim()

/** Does a callout's text name this item (by id, or by file name with or without extension)? */
function names(callout, item) {
  const c = norm(callout)
  const file = norm(item.file), base = norm(item.file.replace(/\.[a-z0-9]+$/i, ''))
  if (item.file && (c.includes(file) || (base.length > 3 && c.includes(base)))) return true
  const id = words(item.id)
  return !!id && new RegExp(`(^| )${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(words(callout))
}

/**
 * Where each art item goes.
 * @param raw  job paragraphs ({ text })
 * @param topics  per paragraph: the topic starting there, or null (state.topic)
 * @param titles  per paragraph: that topic's title (state.topicTitle), for "Chapter 3" in the log
 * @returns {{ places: Array<{ id, index, offset, how }>, drop: number[], strip: Array<{ index, start, end }>, unmatched: Array<{ id, row, why }> }}
 *   drop: callout paragraphs to leave out of the text; strip: inline callout text to remove.
 */
export function findArtPlaces(raw, items, { topics = [], titles = [] } = {}) {
  const places = [], drop = [], strip = [], unmatched = []
  // Every callout in the manuscript, once.
  const callouts = []
  raw.forEach((p, i) => {
    for (const m of p.text.matchAll(CALLOUT)) {
      const whole = p.text.trim() === m[0].trim()
      // Take one neighbouring space with an inline callout, so "water <photo> and" becomes "water and".
      let end = m.index + m[0].length
      if (!whole && p.text[m.index - 1] === ' ' && p.text[end] === ' ') end++
      callouts.push({ index: i, start: m.index, end, text: m[0], whole, used: false })
    }
  })
  // Chapter ranges by title, for scoping anchor phrases.
  const starts = topics.map((t, i) => (t ? i : -1)).filter((i) => i >= 0)
  const chapterRange = (ch) => {
    if (!ch) return [0, raw.length - 1]
    const want = norm(ch).replace(/^(chapter|chap|ch)\s*/, '')
    const k = starts.findIndex((s) => { const t = norm(titles[s] ?? raw[s].text).replace(/^(chapter|chap|ch)\s*/, ''); return t === want || norm(raw[s].text).replace(/^(chapter|chap|ch)\s*/, '') === want })
    if (k < 0) return null
    return [starts[k], (starts[k + 1] ?? raw.length) - 1]
  }
  const nextText = (i) => { let j = i + 1; while (j < raw.length && drop.includes(j)) j++; return j < raw.length ? j : i }

  for (const item of items) {
    const c = callouts.find((x) => !x.used && names(x.text, item))
    if (c) {
      c.used = true
      if (c.whole) { drop.push(c.index); places.push({ id: item.id, index: nextText(c.index), offset: 0, how: `callout "${c.text}" on its own line (removed)` }) }
      else { strip.push({ index: c.index, start: c.start, end: c.end }); places.push({ id: item.id, index: c.index, offset: c.start, how: `callout "${c.text}" in the text (removed)` }) }
      continue
    }
    const range = chapterRange(item.chapter)
    if (item.chapter && !range) { unmatched.push({ id: item.id, row: item.row, why: `chapter "${item.chapter}" not found` }); continue }
    const phrase = item.placement.replace(/^\s*(after|following|below|before|above|at)\s*[:\-–—]?\s*/i, '').replace(/^["“'‘]|["”'’]$/g, '').trim()
    const before = /^\s*(before|above)\b/i.test(item.placement)
    if (phrase.length >= 8) {
      const want = norm(phrase).slice(0, 60)
      const hits = []
      for (let i = range[0]; i <= range[1]; i++) if (norm(raw[i].text).includes(want)) hits.push(i)
      if (hits.length === 1) {
        places.push({ id: item.id, index: before ? hits[0] : nextText(hits[0]), offset: 0, how: `${before ? 'before' : 'after'} the paragraph containing "${phrase.slice(0, 50)}"` })
        continue
      }
      unmatched.push({ id: item.id, row: item.row, why: hits.length ? `"${phrase.slice(0, 40)}" occurs ${hits.length} times${item.chapter ? '' : '; give the chapter'}` : `"${phrase.slice(0, 40)}" not found${item.chapter ? ` in ${item.chapter}` : ''}` })
      continue
    }
    unmatched.push({ id: item.id, row: item.row, why: 'no callout in the manuscript and no placement phrase in the log' })
  }
  return { places, drop, strip, unmatched, unusedCallouts: callouts.filter((c) => !c.used).map((c) => ({ index: c.index, text: c.text })) }
}

/** The note text the plugin reads back: "ART: <id>" then "key: value" lines. */
export function artNoteText(item) {
  const lines = [`ART: ${item.id}`]
  for (const k of ['file', 'size', 'caption', 'credit', 'alt', 'color', 'notes']) if (item[k]) lines.push(`${k}: ${String(item[k]).replace(/\s*\n\s*/g, ' ')}`)
  return lines
}

/** Parse an art note back (inverse of artNoteText). */
export function parseArtNote(text) {
  const lines = String(text).split(/\r|\n/).map((l) => l.trim()).filter(Boolean)
  const m = /^ART:\s*(.+)$/.exec(lines[0] ?? '')
  if (!m) return null
  const item = { id: m[1] }
  for (const l of lines.slice(1)) { const kv = /^([a-z]+):\s*(.*)$/.exec(l); if (kv) item[kv[1]] = kv[2] }
  return item
}

const FRACTION = { full: 1, 'full-page': 1, 'full page': 1, page: 1, column: 1, 'full-width': 1, 'full width': 1, 'full column': 1, 'two-thirds': 2 / 3, half: 0.5, third: 1 / 3, quarter: 0.25 }
const UNIT = { in: 72, inch: 72, '"': 72, mm: 72 / 25.4, cm: 72 / 2.54, pt: 1, p: 12, pica: 12 }
/** A log's size word ("half", "3 in", "full-page") as a fraction of a text column `colPt` points wide. */
export function sizeFraction(size, colPt = 306) {
  const s = String(size ?? '').trim().toLowerCase()
  if (!s) return 1
  if (FRACTION[s] !== undefined) return FRACTION[s]
  const m = /^([\d.]+)\s*(in|inch|"|mm|cm|pt|p|pica)?/.exec(s)
  return m ? Math.min(1, (Number(m[1]) * UNIT[m[2] ?? 'in']) / colPt) : 1
}
