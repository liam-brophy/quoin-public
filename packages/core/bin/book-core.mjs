#!/usr/bin/env node
// book-core: tagged manuscripts to ICML, tagging jobs and their review lists — no InDesign, no Claude.
import { parseArgs } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { buildEpub, computeState, loadJob, openJob, predictions, reviewItems, reviewMarkdown, scoreTags, styledRuns, scoreChars, summarize, taggedParagraphs, writeIcmlBook, writeReport } from '../src/index.mjs'

const HELP = `book-core <command>

  icml <manuscript.docx> --out <dir> [--profile <name>] [--isbn 978…] [--book Name]
      Tagged Word manuscript -> one ICML per topic (house names) + report.md
  epub <manuscript.docx | book.job.json> --out <book.epub> --title "…" [--author …] [--publisher …] [--isbn <e-book ISBN>]
       [--idml template.idml] [--images folder] [--ornament image] [--openers folder] [--a11y a11y.json] [--no-check]
      Tagged manuscript -> EPUB 3 directly (no InDesign), then EPUBCheck and Ace
  job open <manuscript.docx> --out <dir> [--profile <name>] [--ignore-tags]
      Start a tagging job (a tagged file's tags become rules; --ignore-tags keeps them as an answer key)
  job icml <book.job.json> [--out <dir>]
      Write ICML from a job's current rules
  job review <book.job.json>
      Write the editor's review list (<book>.review.md)
  job score <book.job.json>
      Compare a test job with the editor's original tags
  job status <book.job.json>
      Rules, tag counts, topics, containers`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' }, title: { type: 'string' }, author: { type: 'string' }, publisher: { type: 'string' }, idml: { type: 'string' }, images: { type: 'string' }, ornament: { type: 'string' }, openers: { type: 'string' }, a11y: { type: 'string' }, 'no-check': { type: 'boolean', default: false }, profile: { type: 'string' }, isbn: { type: 'string' }, book: { type: 'string' }, 'ignore-tags': { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' } },
})
const [cmd, sub, arg] = positionals
const say = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2))

if (values.help || !cmd) say(HELP)
else if (cmd === 'icml') {
  if (!sub || !values.out) { say(HELP); process.exit(2) }
  const b = await writeIcmlBook({ docx: sub, out: values.out, profile: values.profile, isbn: values.isbn, book: values.book })
  const r = await writeReport(b, { docx: sub })
  say(`${b.files.length} ICML files in ${join(b.out, 'ICML')} (ISBN ${b.isbn ?? 'not found'}); report: ${r.path}`)
} else if (cmd === 'epub') {
  if (!sub || !values.out || !values.title) { say(HELP); process.exit(2) }
  let paragraphs, profile = values.profile
  if (sub.endsWith('.job.json')) { const j = await loadJob(sub); paragraphs = taggedParagraphs(j.raw, computeState(j.raw, j.job.rules, j.job.art), j.profile); profile = j.profile }
  const a11y = values.a11y ? JSON.parse(await readFile(values.a11y, 'utf8')) : undefined
  const r = await buildEpub({ docx: paragraphs ? undefined : sub, paragraphs, out: values.out, profile, idml: values.idml, images: values.images, ornament: values.ornament, openers: values.openers, a11y, validate: !values['no-check'],
    meta: { title: values.title, author: values.author, publisher: values.publisher, isbn: values.isbn } })
  say({ epub: r.epub, files: r.files, footnotes: r.notes, figures: r.figures, openers: r.openers, warnings: r.warnings, stylesWithoutCss: r.stylesWithoutCss?.length ?? null,
    epubcheck: r.epubcheck && { fatal: r.epubcheck.fatal, errors: r.epubcheck.errors, warnings: r.epubcheck.warnings, messages: r.epubcheck.messages?.filter((m) => m.severity !== 'INFO').slice(0, 8) },
    ace: r.ace && { outcome: r.ace.outcome, violations: r.ace.violationsByImpact, rules: r.ace.violations?.map((v) => `${v.impact} ${v.rule} ×${v.count}`), report: r.ace.report } })
} else if (cmd === 'job') {
  if (sub === 'open') {
    const { path, job, tagged } = await openJob({ docx: arg, out: values.out, profile: values.profile, ignoreTags: values['ignore-tags'], name: values.book })
    say({ job: path, paragraphs: job.paragraphs, taggedFile: tagged, answerKey: job.hasKey, startingRules: job.rules.length })
  } else {
    const { job, raw, key, profile, dir } = await loadJob(arg)
    const state = computeState(raw, job.rules, job.art)
    if (sub === 'status') say(summarize(state, job))
    else if (sub === 'review') {
      const items = reviewItems(raw, state, job, profile)
      const file = join(dir, `${job.book}.review.md`)
      await writeFile(file, reviewMarkdown(items, job))
      say(`${items.length} items -> ${file}`)
    } else if (sub === 'score') {
      if (!key) { say('This job has no answer key (open a tagged file with --ignore-tags).'); process.exit(1) }
      const s = scoreTags(key, predictions(state))
      const aliases = Object.fromEntries(Object.entries(profile.character).filter(([, v]) => v.indesign).map(([k, v]) => [k, v.indesign]))
      const c = scoreChars(key, (i) => styledRuns({ runs: raw[i].runs }, state.chars.get(i), profile), aliases)
      say({ tagAccuracy: s.tagAccuracy, nonBody: s.nonBody, topics: { key: s.topics.key, matched: s.topics.matched }, containers: { key: s.containers.key, matched: s.containers.matched }, characters: c.accuracy, confusion: s.confusion.slice(0, 15) })
    } else if (sub === 'icml') {
      const b = await writeIcmlBook({ paragraphs: taggedParagraphs(raw, state, profile), out: values.out ?? dir, profile, book: job.book, isbn: values.isbn })
      const r = await writeReport(b)
      say(`${b.files.length} ICML files in ${join(b.out, 'ICML')}; report: ${r.path}`)
    } else { say(HELP); process.exit(2) }
  }
} else { say(HELP); process.exit(2) }
