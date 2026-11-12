// A compact view of an untagged manuscript for Claude to tag: only the paragraphs
// that may need a non-body tag, each with just enough context.

const END = /[.!?…”"’)\]]$/
const LINE_BREAK = new RegExp('\\u2028', 'g') // a literal U+2028 in source would end the line

export function allItalic(p) {
  const rs = p.runs.filter((r) => r.text.trim())
  return rs.length > 0 && rs.every((r) => r.fmt?.i)
}

/** Paragraph indices worth a look: no end punctuation, all italic, after a colon, or front matter. */
export function shortlist(raw, { after = 1 } = {}) {
  const flagged = new Set()
  const firstBody = raw.findIndex((p) => /^(prologue|chapter\s+\S+|part\s+\S+|\d+)$/i.test(p.text.trim()))
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i].text.trim()
    const prev = i ? raw[i - 1].text.trim() : ''
    if (i < firstBody || !END.test(t) || allItalic(raw[i]) || prev.endsWith(':')) flagged.add(i)
  }
  const out = new Set(flagged)
  for (const i of flagged) for (let k = 1; k <= after; k++) if (i + k < raw.length) out.add(i + k)
  return { indices: [...out].sort((a, b) => a - b), firstBody }
}

/** One line per paragraph: index, marks (I = all italic), text. Gaps show how much body text sits between. */
export function renderOutline(raw, indices, { max = 160, from = 0, to = Infinity } = {}) {
  const lines = []
  let last = -1
  for (const i of indices) {
    if (i < from || i > to) continue
    if (last >= 0 && i > last + 1) lines.push(`   … ${i - last - 1} body paragraph(s) …`)
    const t = raw[i].text.replace(LINE_BREAK, ' ⏎ ').replace(/\t/g, ' ⇥ ')
    const mark = allItalic(raw[i]) ? 'I' : ' '
    lines.push(`${String(i).padStart(4)} ${mark} ${t.length > max ? t.slice(0, max) + `… [${t.length}]` : t}`)
    last = i
  }
  return lines.join('\n')
}

// ── tools over a job ────────────────────────────────────────

const QUOTE = /^[“"‘']/

/**
 * Lines for one page of an outline. mode: 'shortlist' | 'all' | 'dialogue'.
 * With state, non-body tags show beside each paragraph; dialogue mode shows quoted
 * lines plus narration that matches `cue`.
 */
export function outlinePage(raw, { mode = 'shortlist', from = 0, to = raw.length - 1, cue, cursor = 0, limit = 300, max = 120, state } = {}) {
  let indices
  if (mode === 'shortlist') indices = shortlist(raw).indices
  else {
    indices = []
    const cueRe = cue ? new RegExp(cue, 'iu') : null
    for (let i = Math.max(0, from); i <= Math.min(raw.length - 1, to); i++) {
      if (mode === 'all') indices.push(i)
      else if (QUOTE.test(raw[i].text.trim()) || /^\[/.test(raw[i].text.trim()) || (cueRe && cueRe.test(raw[i].text))) indices.push(i)
    }
  }
  indices = indices.filter((i) => i >= from && i <= to)
  const page = indices.slice(cursor, cursor + limit)
  const lines = []
  let last = -1
  for (const i of page) {
    if (last >= 0 && i > last + 1) lines.push(`   … ${i - last - 1} paragraph(s) …`)
    const t = raw[i].text.replace(LINE_BREAK, ' ⏎ ').replace(/\t/g, ' ⇥ ')
    const tag = state && state.tags[i] !== 'p' ? ` ${state.tags[i]}` : ''
    const top = state?.topic[i] ? ` «${state.topic[i]}»` : ''
    const mark = allItalic(raw[i]) ? 'I' : ' '
    lines.push(`${String(i).padStart(5)} ${mark}${top}${tag ? `[${tag.trim()}]` : ''} ${t.length > max ? t.slice(0, max) + `… [${t.length}]` : t}`)
    last = i
  }
  const next = cursor + limit < indices.length ? cursor + limit : null
  return { text: lines.join('\n'), shown: page.length, total: indices.length, next }
}

/** Recurring paragraph shapes across the whole book, with counts and examples. */
export function shapes(raw) {
  const T = raw.map((p) => p.text.trim())
  const tests = {
    'all italic': (t, i) => allItalic(raw[i]),
    'no end punctuation': (t) => t && !END.test(t),
    'bracketed [ … ]': (t) => /^\[[^\]]*\]$/.test(t),
    'starts with [': (t) => /^\[/.test(t),
    'number heading (1, 2.01, IV)': (t) => /^(\d+(\.\d+)*( [A-Z])?|[IVXLC]+)$/.test(t),
    'Chapter / Part / Book heading': (t) => /^(chapter|part|book)\s+\S+/i.test(t) && t.length < 60,
    'scene break (* * *, #, ~)': (t) => /^((\* ?){3}|#|~|◆|\* \* \*)$/.test(t),
    'contains a tab': (t) => /\t/.test(t),
    'ALL CAPS': (t) => t.length > 4 && t === t.toUpperCase() && /[A-Z]/.test(t),
    'date line': (t) => /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)\b.*\d{4}$/.test(t),
    'after a colon': (t, i) => i > 0 && T[i - 1].endsWith(':'),
    'empty': (t) => !t,
  }
  const out = {}
  for (const [name, test] of Object.entries(tests)) {
    const hits = T.map((t, i) => (test(t, i) ? i : -1)).filter((i) => i >= 0)
    if (hits.length) out[name] = { count: hits.length, examples: hits.slice(0, 4).map((i) => `${i}: ${T[i].slice(0, 60)}`) }
  }
  // Short lines that repeat once numbers are ignored ("2.N", "[N Users Connected]").
  const tmpl = new Map()
  T.forEach((t, i) => {
    if (!t || t.length > 60) return
    const k = t.replace(/\d+/g, 'N')
    const e = tmpl.get(k) ?? { count: 0, first: i }
    e.count++
    tmpl.set(k, e)
  })
  const repeating = [...tmpl].filter(([, e]) => e.count >= 3).sort((a, b) => b[1].count - a[1].count).slice(0, 25)
    .map(([k, e]) => `${e.count}× "${k}" (first at ${e.first})`)
  return { paragraphs: raw.length, shapes: out, repeatingLines: repeating }
}

/**
 * Scenes where a cue (a character, a creature, a voice) appears, widened to the
 * scenes on either side, since a character can speak in a scene that never names them.
 */
export function scenes(raw, state, { cues, expand = 1, minHits = 1 }) {
  const re = new RegExp(cues, 'iu')
  // Scene boundaries: topic starts and scene breaks.
  const isBreak = (i) => (state?.topic[i]) || /^txb/.test(state?.tags[i] ?? '') || /^((\* ?){3}|#)$/.test(raw[i].text.trim())
  const bounds = [0]
  for (let i = 1; i < raw.length; i++) if (isBreak(i)) bounds.push(i)
  bounds.push(raw.length)
  const list = []
  for (let k = 0; k < bounds.length - 1; k++) {
    const a = bounds[k], b = bounds[k + 1] - 1
    let hits = 0, quoted = 0
    for (let i = a; i <= b; i++) { if (re.test(raw[i].text)) hits++; if (QUOTE.test(raw[i].text.trim())) quoted++ }
    list.push({ k, from: a, to: b, hits, quoted })
  }
  const keep = new Set()
  list.forEach((s, k) => { if (s.hits >= minHits) for (let d = -expand; d <= expand; d++) if (list[k + d]) keep.add(k + d) })
  const chosen = [...keep].sort((x, y) => x - y).map((k) => ({ ...list[k], reason: list[k].hits >= minHits ? `${list[k].hits} cue hits` : 'next to a cue scene' }))
  return { scenes: chosen, paragraphs: chosen.reduce((n, s) => n + s.to - s.from + 1, 0), quoted: chosen.reduce((n, s) => n + s.quoted, 0) }
}

/** Paragraphs matching a regular expression. */
export function find(raw, state, { text, flags = 'iu', limit = 60 }) {
  const re = new RegExp(text, flags)
  const hits = []
  for (let i = 0; i < raw.length && hits.length < limit; i++) if (re.test(raw[i].text)) hits.push(`${String(i).padStart(5)}${state && state.tags[i] !== 'p' ? ` [${state.tags[i]}]` : ''} ${raw[i].text.slice(0, 120)}`)
  let total = 0
  for (const p of raw) if (re.test(p.text)) total++
  return { total, shown: hits.length, text: hits.join('\n') }
}
