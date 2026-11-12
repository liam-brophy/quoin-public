// Score automatic tagging against a production editor's tags (from stripTags).

/** Rebuild tagged paragraphs (with topic and container markers) from per-paragraph predictions. */
export function toTagged(raw, pred) {
  const out = []
  pred.forEach((p, i) => {
    if (p.topic) out.push({ style: p.topic, runs: [], notes: [] })
    if (p.containerStart) out.push({ style: p.containerStart, runs: [], notes: [] })
    out.push({ style: p.tag, runs: raw[i].runs, notes: [] })
    if (p.containerEnd) out.push({ style: 'end', runs: [], notes: [] })
  })
  return out
}

export function scoreTags(key, pred) {
  const n = key.length
  let same = 0
  const confusion = new Map(), perTag = new Map()
  const bump = (tag, k) => { const t = perTag.get(tag) ?? { tp: 0, fp: 0, fn: 0 }; t[k]++; perTag.set(tag, t) }
  const examples = []
  for (let i = 0; i < n; i++) {
    const a = key[i].tag, b = pred[i].tag
    if (a === b) { same++; bump(a, 'tp'); continue }
    bump(a, 'fn'); bump(b, 'fp')
    const k = `${a} → ${b}`
    confusion.set(k, (confusion.get(k) ?? 0) + 1)
    if (examples.length < 40) examples.push({ i, key: a, claude: b })
  }
  const nonP = key.filter((k) => k.tag !== 'p').length
  const nonPRight = key.filter((k, i) => k.tag !== 'p' && pred[i].tag === k.tag).length

  const topicKey = key.map((k, i) => (k.topicStart ? `${i}:${k.topic}` : null)).filter(Boolean)
  const topicPred = pred.map((p, i) => (p.topic ? `${i}:${p.topic}` : null)).filter(Boolean)
  const tk = new Set(topicKey), tp = new Set(topicPred)

  const spans = (arr, startOf, endOf) => {
    const s = []; let open = null
    arr.forEach((x, i) => { if (startOf(x)) open = i; if (endOf(x) && open !== null) { s.push(`${open}-${i}`); open = null } })
    return new Set(s)
  }
  const ck = spans(key, (k) => k.containerStart, (k) => k.containerEnd)
  const cp = spans(pred, (p) => p.containerStart, (p) => p.containerEnd)

  return {
    paragraphs: n,
    tagAccuracy: same / n,
    nonBody: { total: nonP, right: nonPRight, recall: nonPRight / nonP },
    topics: { key: tk.size, claude: tp.size, matched: [...tk].filter((x) => tp.has(x)).length,
      missed: [...tk].filter((x) => !tp.has(x)), extra: [...tp].filter((x) => !tk.has(x)) },
    containers: { key: ck.size, claude: cp.size, matched: [...ck].filter((x) => cp.has(x)).length,
      missed: [...ck].filter((x) => !cp.has(x)), extra: [...cp].filter((x) => !ck.has(x)) },
    confusion: [...confusion.entries()].sort((a, b) => b[1] - a[1]),
    perTag: Object.fromEntries([...perTag.entries()].filter(([t]) => t !== 'p').map(([t, v]) => [t, v])),
    examples,
  }
}

const FMT = (f = {}) => (f.b && f.i ? 'bi' : f.sc && f.i ? 'sci' : f.i ? 'i' : f.b ? 'b' : f.sc ? 'sc' : null)

/**
 * Character-level score: per character, the editor's character style vs the one the job gives
 * (rule, automatic, or direct formatting such as italic). Counted over characters either side styled.
 * @param key  stripTags key (each entry has chars: [[start, end, style]])
 * @param runsFor  (i) => the job's runs for paragraph i
 */
export function scoreChars(key, runsFor, aliases = {}) {
  const per = new Map()
  const bump = (s, k) => { if (!s) return; const t = per.get(s) ?? { tp: 0, fp: 0, fn: 0 }; t[k]++; per.set(s, t) }
  let right = 0, styled = 0
  key.forEach((k, i) => {
    const runs = runsFor(i)
    const len = runs.reduce((n, r) => n + r.text.length, 0)
    const want = new Array(len).fill(null)
    for (const [a, b, s] of k.chars ?? []) for (let x = a; x < b && x < len; x++) want[x] = aliases[s] ?? s
    let x = 0
    for (const r of runs) {
      const got = r.cstyle ? (aliases[r.cstyle] ?? r.cstyle) : FMT(r.fmt)
      for (let c = 0; c < r.text.length; c++, x++) {
        const w = want[x]
        if (!w && !got) continue
        styled++
        if (w === got) { right++; bump(w, 'tp') } else { bump(w, 'fn'); bump(got, 'fp') }
      }
    }
  })
  const styles = Object.fromEntries([...per].sort((a, b) => (b[1].tp + b[1].fn) - (a[1].tp + a[1].fn)).map(([s, t]) => [s, {
    editorChars: t.tp + t.fn, recall: +(t.tp / Math.max(1, t.tp + t.fn)).toFixed(3), precision: +(t.tp / Math.max(1, t.tp + t.fp)).toFixed(3),
  }]))
  return { styledCharacters: styled, accuracy: +(right / Math.max(1, styled)).toFixed(4), styles }
}
