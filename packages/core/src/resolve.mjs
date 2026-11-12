// Tagged paragraphs -> topics of paragraphs with exact InDesign style names.
// Pure and deterministic: the same tags always give the same names.
import { textOf } from './docx.mjs'

const FMLO = ['first', 'middle', 'last', 'only']

/**
 * @param {Array} paragraphs  from readDocx (style = Word tag)
 * @param {object} profile    from loadProfile
 * @param {Set<string>} [templateParagraph]  paragraph style names in the template
 * @param {Set<string>} [templateCharacter]  character style names in the template
 */
export function resolve(paragraphs, profile, templateParagraph, templateCharacter) {
  const report = {
    paragraphs: paragraphs.length,
    unknownTags: {},       // Word style not in the profile
    untaggedParagraphs: 0, // "Normal"
    skipped: {},           // markers and non-emitting styles
    placeholders: 0,
    unclosedContainers: [],
    strayContainerEnds: 0,
    notes: 0,
  }
  const topics = []
  let topic = null
  const stack = []
  let containerSeq = 0

  const openTopic = (word, title) => {
    const t = profile.topics[word]
    const abbr = t?.abbr ?? profile.fallbackTopic
    topic = { word, abbr, title, items: [] }
    topics.push(topic)
  }

  for (const p of paragraphs) {
    const tag = p.style
    if (tag.startsWith('topic-')) {
      if (stack.length) report.unclosedContainers.push({ topic: topic?.title, containers: stack.splice(0) })
      if (!profile.topics[tag]) count(report.unknownTags, tag)
      if (profile.topics[tag]?.abbr === null) { count(report.skipped, tag); continue } // topic-book: the root
      openTopic(tag, textOf(p))
      continue
    }
    const def = profile.paragraph[tag]
    // Containers the profile doesn't list are still recognisable by the -i / -s naming convention.
    if (def?.container || /-[is]$/.test(tag)) { if (!def) count(report.unknownTags, tag); stack.push(tag); containerSeq++; count(report.skipped, tag); continue }
    if (tag === 'end') { if (!stack.pop()) report.strayContainerEnds++; count(report.skipped, tag); continue }
    if (def?.emit === false) { count(report.skipped, tag); continue }
    if (!def) {
      if (tag === 'Normal') report.untaggedParagraphs++
      else count(report.unknownTags, tag)
    }
    if (!topic) openTopic('topic-bm', '(before first topic)')
    let runs = p.runs
    for (const ph of profile.placeholders) {
      if (ph.style === tag && new RegExp(ph.match).test(textOf(p))) { runs = ph.replace ? [{ text: ph.replace, cstyle: null, fmt: {} }] : []; report.placeholders++ }
    }
    topic.items.push({ tag, container: stack.at(-1) ?? null, containerId: stack.length ? containerSeq : null, runs, notes: p.notes ?? [], art: p.art ?? [], fmlo: !!def?.fmlo, spelling: def?.indesign ?? null })
  }
  if (stack.length) report.unclosedContainers.push({ topic: topic?.title, containers: stack })

  for (const t of topics) {
    assignVariants(t, profile)
    for (const it of t.items) it.name = styleName(t.abbr, it, templateParagraph)
  }
  // Footnote bodies: their own paragraph styles under the topic (chap_ftnt, chap_ftnt_p).
  const fn = profile.footnotes ?? { first: 'ftnt', rest: 'ftnt_p', reference: 'fni', number: 'fn' }
  for (const t of topics) for (const it of t.items) for (const n of it.notes) {
    n.styles = n.paragraphs.map((_, k) => `${t.abbr}_${k ? fn.rest : fn.first}`)
    report.notes++
  }

  const fit = templateParagraph ? fitToTemplate(topics, profile, templateParagraph) : null
  const characterUse = characterStyles(topics, profile, templateCharacter)
  return { topics, report, fit, character: characterUse }
}

/** first/middle/last/only for runs, and positional variants such as pf / paa. */
function assignVariants(topic, profile) {
  const items = topic.items
  const groupOf = new Map()
  for (const g of profile.fmloGroups ?? []) for (const tag of g) groupOf.set(tag, g.join('+'))
  const key = (it) => groupOf.get(it.tag) ?? it.tag
  const position = (prev, next) => (prev && next ? 'middle' : prev ? 'last' : next ? 'first' : 'only')
  const cv = profile.containerVariants

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.container && cv) {
      // Position across the whole container, whatever the styles inside it.
      const inSame = (j) => items[j] && items[j].container === it.container && items[j].containerId === it.containerId
      it.variant = cv[it.fmlo ? 'fmlo' : 'plain'][position(inSame(i - 1), inSame(i + 1))] ?? undefined
    } else if (it.fmlo) {
      const same = (j) => items[j] && key(items[j]) === key(it) && items[j].container === it.container
      it.variant = position(same(i - 1), same(i + 1))
    }
  }
  const seen = new Set()
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const rules = profile.contextual[it.tag]
    if (rules) {
      const prevTag = items[i - 1]?.tag
      const firstInContainer = !!it.container && items[i - 1]?.containerId !== it.containerId
      const rule = rules.find((r) =>
        (r.firstInContainer ? firstInContainer : true) &&
        (!r.firstInTopic || !seen.has(it.tag)) && (!r.after || r.after === prevTag) &&
        (r.firstInTopic || r.after || r.firstInContainer))
      if (rule) it.base = rule.use
    }
    seen.add(it.tag)
  }
}

/** topic_[container_]style[_variant], preferring whichever spelling the template has. */
function styleName(abbr, it, template) {
  const container = it.container ? `${it.container}_` : ''
  const variant = it.variant ? `_${it.variant}` : ''
  const bases = it.base ? [it.base] : [it.tag, it.spelling].filter(Boolean)
  const names = bases.map((b) => `${abbr}_${container}${b}${variant}`)
  it.candidates = names
  // Template wins; with neither spelling in it, the Word code (what designers use in practice).
  return (template && names.find((n) => template.has(n))) ?? names[0]
}

/** For every style the template lacks: the existing style to base it on. */
function fitToTemplate(topics, profile, template) {
  const missing = new Map()
  for (const t of topics) {
    for (const it of t.items) {
      if (template.has(it.name)) continue
      const m = missing.get(it.name) ?? { name: it.name, count: 0, basedOn: parentFor(t.abbr, it, profile, template), topic: t.abbr }
      m.count++
      missing.set(it.name, m)
    }
  }
  for (const t of topics) for (const it of t.items) for (const n of it.notes) for (const name of n.styles ?? []) {
    if (template.has(name)) continue
    const base = name.slice(t.abbr.length + 1)
    const m = missing.get(name) ?? { name, count: 0, basedOn: [`${profile.fallbackTopic}_${base}`, `${profile.fallbackTopic}_ftnt`, `${t.abbr}_p`, '[Basic Paragraph]'].find((x) => template.has(x)) ?? '[Basic Paragraph]', topic: t.abbr }
    m.count++
    missing.set(name, m)
  }
  return { missing: [...missing.values()].sort((a, b) => b.count - a.count) }
}

function parentFor(abbr, it, profile, template) {
  const bases = [it.base, it.spelling, it.tag].filter(Boolean)
  const related = [...bases, ...(profile.fallbackParents[it.tag] ?? [])]
  const topics = [...new Set([abbr, ...(profile.topicFallbacks?.[abbr] ?? []), profile.fallbackTopic])]
  const variants = it.variant ? [it.variant, ...FMLO.filter((v) => v !== it.variant), null] : [null, ...FMLO]
  const tries = []
  for (const tp of topics) {
    for (const b of related) {
      if (it.container) for (const v of variants) tries.push(`${tp}_${it.container}_${b}${v ? `_${v}` : ''}`)
      for (const v of variants) tries.push(`${tp}_${b}${v ? `_${v}` : ''}`)
    }
  }
  for (const tp of topics) tries.push(`${tp}_p`)
  tries.push('[Basic Paragraph]')
  return tries.find((n) => n !== it.name && template.has(n)) ?? '[Basic Paragraph]'
}

/** Word character styles and direct formatting -> InDesign character style names. */
function characterStyles(topics, profile, template) {
  const DIRECT = { i: 'i', b: 'b', sc: 'sc', sup: 'sup', sub: 'sub', u: 'uline', strike: 'strike', caps: 'ac' }
  const used = new Map()
  let direct = 0
  const allRuns = (it) => [...it.runs, ...it.notes.flatMap((n) => n.paragraphs.flatMap((q) => q.runs))]
  for (const t of topics) for (const it of t.items) for (const r of allRuns(it)) {
    let name = null
    if (r.cstyle) name = profile.character[r.cstyle]?.indesign ?? r.cstyle
    else {
      const keys = Object.keys(r.fmt).filter((k) => DIRECT[k])
      if (keys.length) { direct++; name = combine(keys.map((k) => DIRECT[k])) }
    }
    r.name = name
    if (name) {
      const u = used.get(name) ?? { name, count: 0, inProfile: !!(r.cstyle ? profile.character[r.cstyle] : true), inTemplate: template ? template.has(name) : null }
      u.count++
      used.set(name, u)
    }
  }
  const fn = profile.footnotes ?? { reference: 'fni', number: 'fn' }
  const noteCount = topics.reduce((k, t) => k + t.items.reduce((m, it) => m + it.notes.length, 0), 0)
  if (noteCount) for (const name of [fn.reference, fn.number]) {
    const u = used.get(name) ?? { name, count: 0, inProfile: true, inTemplate: template ? template.has(name) : null }
    u.count += noteCount
    used.set(name, u)
  }
  return { used: [...used.values()].sort((a, b) => b.count - a.count), directFormattingRuns: direct }
}

// Bold + italic -> "bi", small caps + italic -> "sci", by convention.
function combine(names) {
  const s = new Set(names)
  if (s.has('b') && s.has('i')) return 'bi'
  if (s.has('sc') && s.has('i')) return 'sci'
  return names[0]
}

function count(obj, key) { obj[key] = (obj[key] ?? 0) + 1 }
