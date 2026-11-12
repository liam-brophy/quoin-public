// A tagging job: a manuscript's paragraphs plus an ordered list of rules Claude
// writes. Tags are always recomputed from the whole rule list, so rules are the
// record of the tagging — reviewable, repeatable, undone by removing one.
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'
import { readDocx, textOf } from './docx.mjs'
import { allItalic } from './outline.mjs'
import { defaultProfile, loadProfile } from './profile.mjs'
import { stripTags } from './strip.mjs'

const isContainerTag = (profile, tag) => !!profile.paragraph[tag]?.container || /-[is]$/.test(tag)

// ── open / load / save ──────────────────────────────────────

/**
 * Start a job from a .docx. With ignoreTags, the file's existing tags are set
 * aside as an answer key (for scoring) and Claude tags it from scratch.
 */
export async function openJob({ docx, out, profile = defaultProfile(), ignoreTags = false, name }) {
  const prof = loadProfile(profile)
  const { paragraphs, stats } = readDocx(await readFile(docx))
  const book = name ?? basename(docx).replace(/\.docx$/i, '')
  const dir = resolvePath(out)
  await mkdir(dir, { recursive: true })

  // A plain Word file (no topic tags) under a profile with wordStyles: built-in styles such as
  // "Heading 1" become starting rules, and blank spacer paragraphs are dropped.
  const mapped = !!prof.wordStyles && !paragraphs.some((p) => p.style.startsWith('topic-'))
  const source = mapped ? paragraphs.filter((p) => textOf(p).trim()) : paragraphs
  const tagged = !mapped && paragraphs.some((p) => p.style !== 'Normal')
  // Topic and container markers are never body text: strip them either way.
  const { raw, key } = tagged
    ? stripTags(paragraphs, prof, { keepCharacterStyles: !ignoreTags })
    : { raw: source.map((p) => ({ text: textOf(p), runs: p.runs.map((r) => ({ text: r.text, cstyle: r.cstyle, fmt: r.fmt })), notes: p.notes })), key: null }

  const job = {
    version: 1, book, source: resolvePath(docx), profile, created: new Date().toISOString(),
    paragraphs: raw.length, hasKey: !!(key && ignoreTags), rules: [], nextRule: 1,
  }
  const path = join(dir, `${book}.job.json`)
  await writeFile(join(dir, `${book}.paras.json`), JSON.stringify(raw))
  // ignoreTags: the editor's tags become an answer key; otherwise they become the starting rules.
  if (key && ignoreTags) await writeFile(join(dir, `${book}.key.json`), JSON.stringify(key))
  if (key && !ignoreTags) job.rules.push(...rulesFromKey(key, job))
  if (mapped) job.rules.push(...rulesFromWordStyles(source, prof, job))
  await saveJob(path, job)
  return { path, job, stats, tagged, mapped }
}

export async function loadJob(path) {
  const job = JSON.parse(await readFile(path, 'utf8'))
  const dir = dirname(path)
  const raw = JSON.parse(await readFile(join(dir, `${job.book}.paras.json`), 'utf8'))
  const keyPath = join(dir, `${job.book}.key.json`)
  const key = existsSync(keyPath) ? JSON.parse(await readFile(keyPath, 'utf8')) : null
  return { job, raw, key, profile: loadProfile(job.profile), dir }
}

export const saveJob = (path, job) => writeFile(path, JSON.stringify(job, null, 1))

// A plain Word file: its built-in styles (Title, Heading 1, Quote…) and break lines become rules.
function rulesFromWordStyles(paras, profile, job) {
  const map = new Map(Object.entries(profile.wordStyles).map(([k, v]) => [k.toLowerCase(), v]))
  const tags = new Map(), topics = new Map(), out = []
  const add = (m, k, i) => { const l = m.get(k) ?? []; l.push(i); m.set(k, l) }
  paras.forEach((p, i) => {
    const m = map.get(p.style.toLowerCase())
    if (m?.tag) add(tags, `${p.style}|${m.tag}`, i)
    if (m?.topic) add(topics, m.topic, i)
  })
  for (const [topic, indices] of topics) out.push({ id: `r${job.nextRule++}`, kind: 'topic', topic, where: { indices }, confidence: 'high', note: 'from Word heading styles' })
  for (const [k, indices] of tags) { const [style, tag] = k.split('|'); out.push({ id: `r${job.nextRule++}`, kind: 'tag', tag, where: { indices }, confidence: 'high', note: `Word style "${style}"` }) }
  if (profile.breakTag && profile.breakPattern) out.push({ id: `r${job.nextRule++}`, kind: 'tag', tag: profile.breakTag, where: { text: profile.breakPattern }, confidence: 'high', note: 'break line' })
  return out
}

// A tagged Word file opened without ignoreTags: its tags become rules (one per tag, topic and container).
function rulesFromKey(key, job) {
  const byTag = new Map(), topics = new Map(), out = [], titles = {}
  const note = 'from the Word file'
  let open = null
  key.forEach((k, i) => {
    if (k.tag !== 'p') { const l = byTag.get(k.tag) ?? []; l.push(i); byTag.set(k.tag, l) }
    if (k.topicStart) { const l = topics.get(k.topic) ?? []; l.push(i); topics.set(k.topic, l); if (k.topicTitle) titles[i] = k.topicTitle }
    if (k.containerStart) open = { start: i, type: k.container }
    if (k.containerEnd && open) {
      out.push({ id: `r${job.nextRule++}`, kind: 'container', container: open.type, where: { range: [open.start, i] }, group: 'span', confidence: 'high', note })
      open = null
    }
  })
  const tagRules = [...byTag].map(([tag, indices]) => ({ id: `r${job.nextRule++}`, kind: 'tag', tag, where: { indices }, confidence: 'high', note }))
  const topicRules = [...topics].map(([topic, indices]) => ({ id: `r${job.nextRule++}`, kind: 'topic', topic, where: { indices }, titles: Object.fromEntries(indices.filter((i) => titles[i]).map((i) => [i, titles[i]])), confidence: 'high', note }))
  return [...tagRules, ...topicRules, ...out]
}

// ── selecting paragraphs ────────────────────────────────────

/** Indices a `where` selects. All given conditions must hold. */
export function select(raw, where, tags, containerOf) {
  let pool
  if (where.indices) pool = [...new Set(where.indices)].filter((i) => i >= 0 && i < raw.length).sort((a, b) => a - b)
  else {
    const [a, b] = where.range ?? where.within ?? [0, raw.length - 1]
    pool = []
    for (let i = Math.max(0, a); i <= Math.min(raw.length - 1, b); i++) pool.push(i)
  }
  if (where.within && where.indices) pool = pool.filter((i) => i >= where.within[0] && i <= where.within[1])
  const re = where.text ? new RegExp(where.text, where.flags ?? 'u') : null
  const not = where.notText ? new RegExp(where.notText, where.flags ?? 'u') : null
  return pool.filter((i) => {
    const t = raw[i].text.trim()
    if (re && !re.test(t)) return false
    if (not && not.test(t)) return false
    if (where.allItalic !== undefined && allItalic(raw[i]) !== where.allItalic) return false
    if (where.currentTag && tags && tags[i] !== where.currentTag) return false
    if (where.inContainer && (!containerOf || containerOf[i] !== where.inContainer)) return false
    if (where.maxLength && t.length > where.maxLength) return false
    return true
  })
}

// ── validating and applying rules ───────────────────────────

/** Problems that make a rule unusable, and suggestions for an unknown tag. */
export function checkRule(rule, profile) {
  const errors = []
  const valid = (code) => !!profile.paragraph[code]
  if (!['tag', 'topic', 'container', 'char'].includes(rule.kind)) errors.push(`kind must be tag, topic, container or char (got "${rule.kind}")`)
  if (!rule.where || typeof rule.where !== 'object') errors.push('where is required')
  try { if (rule.where?.text) new RegExp(rule.where.text, rule.where.flags ?? 'u') } catch (e) { errors.push(`where.text is not a valid regular expression: ${e.message}`) }
  if (rule.kind === 'tag' && !(valid(rule.tag) || rule.tag === 'p' || rule.tag?.startsWith('topic-')))
    errors.push(`"${rule.tag}" is not a paragraph tag in the ${profile.name} profile${suggest(rule.tag, profile)}`)
  if (rule.kind === 'topic' && !profile.topics[rule.topic])
    errors.push(`"${rule.topic}" is not a topic in the ${profile.name} profile${suggest(rule.topic, profile, 'topics')}`)
  if (rule.kind === 'container' && !/-[is]$/.test(rule.container ?? '') && !profile.paragraph[rule.container]?.container)
    errors.push(`"${rule.container}" is not a container (container tags end in -i or -s)`)
  if (rule.kind === 'char' && !characterStyleNames(profile).has(rule.style))
    errors.push(`"${rule.style}" is not a character style in the ${profile.name} profile${suggest(rule.style, profile, 'character')}`)
  try { if (rule.match) new RegExp(rule.match, 'gu') } catch (e) { errors.push(`match is not a valid regular expression: ${e.message}`) }
  if (rule.confidence && !['high', 'low'].includes(rule.confidence)) errors.push('confidence must be high or low')
  return errors
}

/** Character style names a rule may use: the profile's Word codes and their InDesign names. */
export function characterStyleNames(profile) {
  const out = new Set()
  for (const [k, v] of Object.entries(profile.character)) { out.add(k); if (v.indesign) out.add(v.indesign) }
  for (const a of profile.autoCharacter ?? []) out.add(a.style)
  return out
}

function suggest(code, profile, table = 'paragraph') {
  if (!code) return ''
  const words = code.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1)
  const hits = Object.entries(profile[table])
    .filter(([c, d]) => c.includes(code) || code.includes(c) || words.some((w) => (d.label ?? d.name ?? '').toLowerCase().includes(w)))
    .slice(0, 6).map(([c, d]) => `${c} (${d.label ?? d.name})`)
  return hits.length ? `. Did you mean: ${hits.join(', ')}?` : ''
}

/**
 * Recompute every paragraph's tag, the topic starts and the containers from the rules.
 * @returns {{ tags: string[], topic: (string|null)[], containers: Array<{start,end,type,rule}>, ruleHits: Map, conflicts: string[] }}
 */
export function computeState(raw, rules, art = null) {
  const n = raw.length
  const tags = new Array(n).fill('p')
  const conf = new Array(n).fill('default')
  const by = new Array(n).fill(null)
  const topic = new Array(n).fill(null)
  const topicTitle = new Array(n).fill(null)
  let containers = []
  const ruleHits = new Map()
  for (const r of rules) {
    if (r.kind === 'char') continue
    const hit = select(raw, r.where, tags)
    ruleHits.set(r.id, hit)
    if (r.kind === 'tag') for (const i of hit) { tags[i] = r.tag; conf[i] = r.confidence ?? 'high'; by[i] = r.id }
    else if (r.kind === 'topic') for (const i of hit) { topic[i] = r.topic; topicTitle[i] = r.titles?.[i] ?? r.title ?? null }
    else if (r.kind === 'container') {
      const spans = r.group === 'span' && hit.length ? [[hit[0], hit.at(-1)]] : runs(hit, topic)
      // A later container over the same paragraphs replaces the earlier one.
      containers = containers.filter((c) => !spans.some(([a, b]) => c.start <= b && a <= c.end))
      for (const [a, b] of spans) containers.push({ start: a, end: b, type: r.container, rule: r.id, confidence: r.confidence ?? 'high' })
    }
  }
  containers.sort((a, b) => a.start - b.start)
  // Touching containers of one type are one container (e.g. a run of a voice split across a
  // high- and a low-confidence rule); the merged one keeps the lower confidence.
  const merged = []
  for (const c of containers) {
    const last = merged.at(-1)
    if (last && last.type === c.type && last.end + 1 === c.start && !topic[c.start]) {
      last.end = c.end
      if (c.confidence === 'low') last.confidence = 'low'
      last.rule = last.rule === c.rule ? last.rule : `${last.rule}+${c.rule}`
    } else merged.push({ ...c })
  }
  containers = merged
  const conflicts = []
  for (const c of containers) for (let i = c.start + 1; i <= c.end; i++) if (topic[i]) conflicts.push(`container ${c.start}–${c.end} (${c.type}, ${c.rule}) crosses the topic starting at ${i}`)
  // Character rules run once paragraphs and containers are settled, so they can select by both.
  const containerOf = new Array(n).fill(null)
  for (const c of containers) for (let i = c.start; i <= c.end; i++) containerOf[i] = c.type
  const chars = new Map() // paragraph -> [{ start, end, style, rule }], later entries win
  for (const r of rules) {
    if (r.kind !== 'char') continue
    const hit = select(raw, r.where, tags, containerOf)
    let count = 0
    for (const i of hit) {
      const spans = matchSpans(raw[i].text, r.match)
      for (const [a, b] of spans) { push(chars, i, { start: a, end: b, style: r.style, rule: r.id }); count++ }
    }
    ruleHits.set(r.id, hit)
  }
  return { tags, conf, by, topic, topicTitle, containers, containerOf, chars, ruleHits, conflicts, art }
}

const push = (map, k, v) => { const l = map.get(k) ?? []; l.push(v); map.set(k, l) }

/** Character ranges a pattern covers; no pattern = the whole paragraph. */
function matchSpans(text, match) {
  if (!match) return text.length ? [[0, text.length]] : []
  const out = []
  for (const m of text.matchAll(new RegExp(match, 'gu'))) if (m[0].length) out.push([m.index, m.index + m[0].length])
  return out
}

// Automatic character styles from the profile: writing systems and patterns (redaction blocks).
function autoSpans(text, profile) {
  const out = []
  for (const a of profile.autoCharacter ?? []) {
    let re
    if (a.script) {
      const cls = a.script.split('|').map((x) => `\\p{Script=${x}}`).join('')
      // A run of the script; inside it only spaces, combining marks and the scripts' own punctuation.
      re = new RegExp(`[${cls}](?:[${cls}\\p{M} 、。・ー।]*[${cls}\\p{M}])?[?!.。、।]?`, 'gu')
    } else re = new RegExp(a.match, 'gu')
    for (const m of text.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length, style: a.style, rule: 'auto' })
  }
  return out
}

/** Automatic character styles (languages, redaction) on paragraphs read straight from a Word file. */
export function withAutoCharacter(paragraphs, profile) {
  if (!profile.autoCharacter?.length) return paragraphs
  return paragraphs.map((p) => ({ ...p, runs: styledRuns({ runs: p.runs.map((r) => ({ ...r, fmt: r.fmt ?? {} })) }, null, profile) }))
}

/** A paragraph's runs with character rules, then automatic styles, laid over the original runs. */
export function styledRuns(p, spans, profile) {
  const text = p.runs.map((r) => r.text).join('')
  const auto = autoSpans(text, profile)
  if (!spans?.length && !auto.length) return p.runs
  const style = [], fmt = []
  for (const r of p.runs) for (let k = 0; k < r.text.length; k++) { style.push(r.cstyle ?? null); fmt.push(r.fmt ?? {}) }
  const lay = (s, onlyIfUnstyled) => {
    for (let k = s.start; k < s.end && k < style.length; k++) {
      // An automatic style never overrides one the file itself set (a tagged file is authoritative).
      if (onlyIfUnstyled && style[k] && !p.ruleStyled?.[k]) continue
      style[k] = s.style
      if (!onlyIfUnstyled) (p.ruleStyled ??= [])[k] = true
    }
  }
  for (const s of spans ?? []) lay(s, false)
  for (const s of auto) lay(s, true)
  const runs = []
  for (let k = 0; k < text.length; k++) {
    const last = runs.at(-1)
    if (last && last.cstyle === style[k] && last.fmt === fmt[k]) last.text += text[k]
    else runs.push({ text: text[k], cstyle: style[k], fmt: fmt[k] })
  }
  delete p.ruleStyled
  return runs
}

// Consecutive indices form one container; a topic start breaks a run.
function runs(idx, topic) {
  const out = []
  let a = null, prev = null
  for (const i of idx) {
    if (a !== null && i === prev + 1 && !topic[i]) { prev = i; continue }
    if (a !== null) out.push([a, prev])
    a = prev = i
  }
  if (a !== null) out.push([a, prev])
  return out
}

/** Add and/or remove rules; returns what changed and the new tag counts. */
export function editRules(job, raw, profile, { add = [], remove = [] }) {
  const errors = [], added = [], warnings = []
  if (remove.length) {
    const before = job.rules.length
    job.rules = job.rules.filter((r) => !remove.includes(r.id))
    if (job.rules.length + remove.length !== before) warnings.push('some ids to remove were not found')
  }
  for (const r of add) {
    const problems = checkRule(r, profile)
    if (problems.length) { errors.push({ rule: r, problems }); continue }
    const rule = { id: `r${job.nextRule++}`, confidence: 'high', ...r }
    job.rules.push(rule)
    added.push(rule.id)
  }
  const state = computeState(raw, job.rules)
  for (const id of added) {
    const n = state.ruleHits.get(id).length
    if (!n) warnings.push(`${id} matched no paragraphs`)
  }
  return { added, errors, warnings, summary: summarize(state, job) }
}

export function summarize(state, job) {
  const counts = {}
  for (const t of state.tags) counts[t] = (counts[t] ?? 0) + 1
  const topics = state.topic.filter(Boolean).length
  return {
    rules: job.rules.length,
    tags: Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1])),
    topics,
    containers: state.containers.length,
    conflicts: state.conflicts.slice(0, 10),
    rulesList: job.rules.map((r) => ({ id: r.id, kind: r.kind, what: r.tag ?? r.topic ?? r.container ?? r.style, confidence: r.confidence, matches: state.ruleHits.get(r.id).length, note: r.note })),
  }
}

// ── tagged paragraphs for the resolver / build ──────────────

/** Remove characters [start, end) from runs. */
function cutRuns(runs, start, end) {
  const out = []
  let at = 0
  for (const r of runs) {
    const a = Math.max(start - at, 0), b = Math.min(end - at, r.text.length)
    const text = a < b ? r.text.slice(0, a) + r.text.slice(b) : r.text
    if (text) out.push({ ...r, text })
    at += r.text.length
  }
  return out
}

/** Store an art log's matches (from findArtPlaces) on a job; computeState passes them to taggedParagraphs. */
export function setArt(job, art) {
  job.art = art
  return job
}

/** The job as tagged paragraphs with topic and container marker paragraphs, as readDocx would give. */
export function taggedParagraphs(raw, state, profile) {
  const out = []
  const starts = new Map(state.containers.map((c) => [c.start, c]))
  const ends = new Map(state.containers.map((c) => [c.end, c]))
  // Art log matches: callout lines left out, inline callouts cut, notes attached where the art goes.
  const art = state.art ?? null
  const drop = new Set(art?.drop ?? [])
  const byIndex = new Map()
  for (const pl of art?.places ?? []) { const l = byIndex.get(pl.index) ?? []; l.push(pl); byIndex.set(pl.index, l) }
  const items = new Map((art?.items ?? []).map((it) => [it.id, it]))
  const topic = [...state.topic], topicTitle = [...(state.topicTitle ?? [])]
  raw.forEach((p0, i) => {
    let p = p0
    for (const c of (art?.strip ?? []).filter((x) => x.index === i)) {
      const width = c.end - c.start
      p = { ...p, runs: cutRuns(p.runs, c.start, c.end), notes: (p.notes ?? []).map((n) => (n.offset >= c.end ? { ...n, offset: n.offset - width } : n)) }
    }
    if (drop.has(i)) {
      // A topic that starts on a dropped callout line starts on the next paragraph instead.
      if (topic[i] && i + 1 < raw.length && !topic[i + 1]) { topic[i + 1] = topic[i]; topicTitle[i + 1] = topicTitle[i] ?? null }
      return
    }
    // The topic marker carries its title (the editor's label, else the topic's first line) for file names and reports.
    if (topic[i]) out.push({ style: topic[i], runs: [{ text: topicTitle[i] ?? p.text.slice(0, 40), cstyle: null, fmt: {} }], notes: [] })
    if (starts.has(i)) out.push({ style: starts.get(i).type, runs: [], notes: [] })
    const artHere = (byIndex.get(i) ?? []).map((pl) => ({ offset: pl.offset, item: items.get(pl.id) })).filter((a) => a.item)
    out.push({ style: state.tags[i], runs: styledRuns({ runs: p.runs.map((r) => ({ ...r, fmt: r.fmt ?? {} })) }, state.chars?.get(i), profile), notes: p.notes ?? [], ...(artHere.length ? { art: artHere } : {}) })
    if (ends.has(i)) out.push({ style: 'end', runs: [], notes: [] })
  })
  return out
}

/** Per-paragraph predictions in the shape scoreTags expects. */
export function predictions(state) {
  const starts = new Map(state.containers.map((c) => [c.start, c]))
  const ends = new Set(state.containers.map((c) => c.end))
  return state.tags.map((tag, i) => ({
    tag,
    ...(state.topic[i] ? { topic: state.topic[i] } : {}),
    ...(starts.has(i) ? { containerStart: starts.get(i).type } : {}),
    ...(ends.has(i) ? { containerEnd: true } : {}),
  }))
}
