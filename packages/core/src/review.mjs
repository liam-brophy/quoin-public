// The editor's review list: what the tagging is unsure of, most uncertain first.
import { textOf } from './docx.mjs'

const clip = (t, n = 90) => (t.length > n ? t.slice(0, n) + '…' : t)

/**
 * @returns {Array<{ order: number, kind: string, where: string, tag?: string, why: string, text: string, rule?: string }>}
 */
export function reviewItems(raw, state, job, profile) {
  const items = []
  const push = (order, kind, where, why, extra = {}) => items.push({ order, kind, where: String(where), why, ...extra })

  // 1. Structural problems
  for (const c of state.conflicts) push(0, 'problem', '-', c)
  const firstTopic = state.topic.findIndex(Boolean)
  if (firstTopic === -1) push(0, 'problem', '-', 'no topic starts: the whole book would land in one generic topic')
  else if (firstTopic > 0) push(0, 'problem', `0–${firstTopic - 1}`, `${firstTopic} paragraphs come before the first topic`)
  const topicStarts = state.topic.map((t, i) => (t ? i : -1)).filter((i) => i >= 0)
  topicStarts.forEach((s, k) => {
    const e = (topicStarts[k + 1] ?? raw.length) - 1
    if (e < s) push(0, 'problem', s, `topic ${state.topic[s]} has no paragraphs`)
  })

  // 2. Rules marked low-confidence or for review, and tags the profile says are the editor's call
  const reviewTags = new Set(profile.reviewTags ?? [])
  const byId = new Map(job.rules.map((r) => [r.id, r]))
  raw.forEach((p, i) => {
    const r = state.by[i] && byId.get(state.by[i])
    if (!r) return
    const low = r.confidence === 'low'
    if (low || r.review || reviewTags.has(state.tags[i]))
      push(low ? 1 : 3, low ? 'low confidence' : 'editor\'s call', i, r.note ?? (reviewTags.has(state.tags[i]) ? `${state.tags[i]} is flagged for review in the profile` : 'marked for review'),
        { tag: state.tags[i], text: clip(p.text), rule: r.id })
  })

  // 3. Containers that are always proposals (e.g. voices), and low-confidence containers
  const proposals = new Set(profile.proposalContainers ?? [])
  for (const c of state.containers) {
    if (proposals.has(c.type) || c.confidence === 'low')
      push(c.confidence === 'low' ? 1 : 2, 'proposal', c.start === c.end ? c.start : `${c.start}–${c.end}`,
        `${c.type} container${c.confidence === 'low' ? ' (low confidence)' : ''}`, { tag: c.type, text: clip(raw[c.start].text), rule: c.rule })
  }

  // 4. Things a typesetter notices: compositor notes, typographic quotes
  raw.forEach((p, i) => {
    if (state.tags[i] === 'compnote') push(4, 'compositor note', i, 'not printed; act on it', { tag: 'compnote', text: clip(p.text) })
  })
  return items.sort((a, b) => a.order - b.order || num(a.where) - num(b.where))
}

const num = (w) => Number(String(w).split('–')[0]) || 0

export function reviewMarkdown(items, job) {
  const L = [`# ${job.book}: tagging review`, '', `${items.length} items, most uncertain first. Paragraph numbers match the outline.`, '']
  const groups = [['problem', 'Problems'], ['low confidence', 'Low confidence'], ['proposal', 'Proposals to approve'], ["editor's call", "Editor's call"], ['compositor note', 'Compositor notes']]
  for (const [kind, title] of groups) {
    const g = items.filter((x) => x.kind === kind)
    if (!g.length) continue
    L.push(`## ${title} (${g.length})`, '', '| ¶ | Tag | Text | Why | Rule |', '|---|---|---|---|---|')
    for (const x of g) L.push(`| ${x.where} | ${x.tag ? '`' + x.tag + '`' : ''} | ${(x.text ?? '').replace(/\|/g, '\\|')} | ${x.why.replace(/\|/g, '\\|')} | ${x.rule ?? ''} |`)
    L.push('')
  }
  return L.join('\n')
}
