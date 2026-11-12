// Turn a tagged manuscript back into what an author delivers, keeping the tags
// aside as an answer key. Used to score automatic tagging against a production editor's.
import { textOf } from './docx.mjs'

/**
 * @returns {{ raw: Array<{ text: string, runs: Array }>, key: Array<{ tag: string, topic: string, container: string|null,
 *            topicStart: boolean, containerStart: boolean, containerEnd: boolean }> }}
 */
export function stripTags(paragraphs, profile, { keepCharacterStyles = false } = {}) {
  const raw = [], key = []
  let topic = null, topicStart = false, topicTitle = null, container = null, containerStart = false
  for (const p of paragraphs) {
    const tag = p.style
    if (tag.startsWith('topic-')) {
      if (profile.topics[tag]?.abbr !== null) { topic = tag; topicStart = true; topicTitle = textOf(p) }
      continue
    }
    // Containers the profile doesn't list are still recognisable by the -i / -s naming convention.
    if (profile.paragraph[tag]?.container || /-[is]$/.test(tag)) { container = tag; containerStart = true; continue }
    if (tag === 'end') { if (key.length) key.at(-1).containerEnd = true; container = null; continue }
    // A blind test hides character styles too (an author's file has none); a real job keeps them.
    let runs = p.runs.map((r) => ({ text: r.text, cstyle: keepCharacterStyles ? r.cstyle : null, fmt: keepCharacterStyles ? r.fmt : authorFormatting(r) }))
    if (!keepCharacterStyles && tag === 'txb2' && /^\[no ornament\]$/.test(textOf(p))) runs = [{ text: '* * *', cstyle: null, fmt: {} }]
    raw.push({ text: runs.map((r) => r.text).join(''), runs, notes: p.notes ?? [] })
    const chars = []
    let at = 0
    for (const r of p.runs) { if (r.cstyle) chars.push([at, at + r.text.length, r.cstyle]); at += r.text.length }
    key.push({ tag, topic, container, topicStart, ...(topicStart ? { topicTitle } : {}), containerStart, containerEnd: false, chars })
    topicStart = false
    containerStart = false
  }
  return { raw, key }
}

// Character styles become the direct formatting an author would have used.
function authorFormatting(r) {
  const f = { ...r.fmt }
  if (r.cstyle === 'i' || r.cstyle === 'ialt') f.i = true
  if (r.cstyle === 'b') f.b = true
  if (r.cstyle === 'bi') { f.b = true; f.i = true }
  if (r.cstyle === 'sc') f.sc = true
  return f
}
