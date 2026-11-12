#!/usr/bin/env node
// Local MCP server: exposes a running Adobe InDesign to Claude Code.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { APP, InDesignError, runJsx, script } from './bridge.mjs'
import { toTypestory } from './typestory.mjs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildBook } from './build.mjs'
import { buildEpub } from 'book-core/book'
import { computeState, editRules, loadJob, openJob, predictions, saveJob, styledRuns, summarize, taggedParagraphs } from 'book-core/job'
import { find, outlinePage, scenes, shapes } from 'book-core/outline'
import { loadProfile } from 'book-core/profile'
import { reviewItems, reviewMarkdown } from 'book-core/review'
import { scoreChars, scoreTags } from 'book-core/score'
import { previewDesignerScript, registry, runDesignerScript } from './designer-scripts.mjs'
import { artCheck, artPlace, attachArtLog } from './art.mjs'
import { fonts, impose, newDocument, pageSpec, SIZES } from './design.mjs'
import { epub, epubOpeners, epubPrep, handoffCheck, packageBook, printPdf, signature, unusedStyles } from './export.mjs'

// The workflow guide. Claude Code loads it as a skill; Claude Desktop (one-click extension) has no skills,
// so the essentials go out as server instructions and the whole guide is one tool call away (quoin_guide).
const GUIDE = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'indesign', 'SKILL.md')
const INSTRUCTIONS = `Quoin: tools for Adobe InDesign and book production (manuscripts, templates, art, zines, EPUB, handoff).
Before a multi-step task (tagging a manuscript, building a book, placing art, a zine, an EPUB, a handoff), call quoin_guide once and follow it.
Rules: never save, close or overwrite the user's documents; work on copies. Anything that changes a document is previewed first and
runs only after the user approves (approved: true). Fonts, spacing and layout are the designer's decisions: propose, never impose.
Report overset text, missing fonts and missing links whenever you see them. Use real quotes and dashes.`
const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version
const server = new McpServer({ name: 'indesign', version: VERSION }, { instructions: INSTRUCTIONS })

const docArg = z.string().optional().describe('Name of an open document (e.g. "Book.indd"). Defaults to the active document.')
const absPath = z.string().refine(isAbsolute, 'Use an absolute path.')

const READ = { readOnlyHint: true, openWorldHint: false }

/** Wrap a handler so results and InDesign errors come back as tool content. */
function tool(fn) {
  return async (args) => {
    try {
      const result = await fn(args)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (err) {
      const detail = err instanceof InDesignError ? err.detail : {}
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: err.message, ...detail }, null, 2) }] }
    }
  }
}

server.registerTool(
  'quoin_guide',
  {
    title: 'Quoin workflow guide',
    description: 'How to use these tools well: the workflows for tagging a manuscript, building into a template, art logs, zines, ' +
      'EPUB and handoff, the rules for editing a designer\'s documents, and ExtendScript gotchas. Call it once before a multi-step task. ' +
      'Pass section (a heading, e.g. "Zines") for just that part.',
    inputSchema: { section: z.string().optional() },
    annotations: READ,
  },
  tool(async ({ section }) => {
    const text = (await readFile(GUIDE, 'utf8')).replace(/^---[\s\S]*?---\n/, '')
    const parts = text.split(/\n(?=## )/)
    const headings = parts.slice(1).map((p) => p.split('\n')[0].replace(/^## /, ''))
    if (!section) return { guide: text, sections: headings }
    const hit = parts.find((p) => p.startsWith('## ') && p.split('\n')[0].toLowerCase().includes(section.toLowerCase()))
    if (!hit) throw new Error(`No section matching "${section}". Sections: ${headings.join('; ')}`)
    return { section: hit.split('\n')[0].replace(/^## /, ''), text: hit }
  }),
)

server.registerTool(
  'indesign_status',
  {
    title: 'InDesign status',
    description: `Check that ${APP} answers, and list its open documents. Launches InDesign if it is not running.`,
    inputSchema: {},
    annotations: READ,
  },
  tool(async () => runJsx(await script('status'))),
)

server.registerTool(
  'indesign_inspect_document',
  {
    title: 'Inspect document',
    description:
      'Page size, margins, columns, bleed, baseline grid, masters, style counts, and problems ' +
      '(overset stories, missing fonts, missing or modified links). All measurements in points.',
    inputSchema: { document: docArg },
    annotations: READ,
  },
  tool(async (args) => runJsx(await script('inspect'), args)),
)

server.registerTool(
  'indesign_list_styles',
  {
    title: 'List styles',
    description:
      'Paragraph and/or character styles with their type specs: font, size, leading, tracking, ' +
      'alignment, indents, space before/after, baseline alignment, hyphenation. Points.',
    inputSchema: {
      document: docArg,
      kind: z.enum(['paragraph', 'character', 'both']).default('both'),
      names: z.array(z.string()).optional().describe('Only these style names.'),
    },
    annotations: READ,
  },
  tool(async (args) => runJsx(await script('styles'), args)),
)

server.registerTool(
  'indesign_export',
  {
    title: 'Export',
    description:
      'Export the active/named document, or a closed .indd given as `source` (opened without a window, ' +
      'exported, closed unsaved). Call once per file for batch exports. Overwrites `path` if it exists.',
    inputSchema: {
      format: z.enum(['pdf', 'idml', 'epub', 'epub-fixed']),
      path: absPath.describe('Absolute output file path.'),
      pdfPreset: z.string().optional().describe('PDF export preset name, e.g. "[High Quality Print]".'),
      source: absPath.optional().describe('Absolute path to an .indd to export without leaving it open.'),
      document: docArg,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async (args) => runJsx(await script('export'), args)),
)

server.registerTool(
  'indesign_run_script',
  {
    title: 'Run ExtendScript',
    description:
      'Run ExtendScript (ES3) inside InDesign. The code is a function body: `return` plain data ' +
      '(objects, arrays, strings, numbers). `ARGS` holds `args`; `__doc()` gives the target document; ' +
      'units are points; dialogs are suppressed. The whole script is one undo step named `undoName`. ' +
      'Do not save or close the user\'s documents unless asked.',
    inputSchema: {
      code: z.string().describe('ExtendScript function body.'),
      args: z.record(z.string(), z.unknown()).optional(),
      undoName: z.string().default('Claude edit').describe('Name shown under Edit → Undo.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  tool(async ({ code, args, undoName }) => runJsx(code, args ?? {}, { undoName })),
)

server.registerTool(
  'indesign_typestory_pairing',
  {
    title: 'Typestory pairing from InDesign',
    description:
      "Read a document's body and heading paragraph styles and propose a Typestory FontPairing " +
      'and ReaderSettings (leading step, spaced vs indented paragraphs), with the print values for comparison.',
    inputSchema: {
      document: docArg,
      bodyStyle: z.string().describe('Body text paragraph style name, e.g. "Body" or "Text"'),
      headingStyle: z.string().optional().describe('Chapter heading paragraph style name.'),
    },
    annotations: READ,
  },
  tool(async ({ document, bodyStyle, headingStyle }) => {
    const names = [bodyStyle, headingStyle].filter(Boolean)
    const { paragraph } = await runJsx(await script('styles'), { document, kind: 'paragraph', names })
    const body = paragraph.find((s) => s.name === bodyStyle)
    if (!body) throw new Error(`No paragraph style named "${bodyStyle}".`)
    const heading = headingStyle ? paragraph.find((s) => s.name === headingStyle) : undefined
    if (headingStyle && !heading) throw new Error(`No paragraph style named "${headingStyle}".`)
    return toTypestory(body, heading)
  }),
)

// ── manuscript tagging ──────────────────────────────────────
// Workflow: profile_tags → manuscript_open → manuscript_shapes / _outline / _find / _scenes
// → manuscript_rules (repeat) → manuscript_review → book_build. See skills/indesign/SKILL.md.

const pageArg = z.object({
  size: z.string().optional().describe(`Named size: ${Object.keys(SIZES).join(', ')}`),
  width: z.number().optional(), height: z.number().optional(), unit: z.enum(['in', 'mm', 'cm', 'pt', 'pica']).default('in'),
  landscape: z.boolean().optional(),
  margins: z.object({ all: z.number().optional(), top: z.number().optional(), bottom: z.number().optional(), inside: z.number().optional(), outside: z.number().optional() }).optional().describe('In `unit`.'),
})

const jobArg = absPath.describe('Absolute path to the .job.json that manuscript_open returned.')

const where = z.object({
  text: z.string().optional().describe('Regular expression the trimmed paragraph text must match (JavaScript syntax, Unicode).'),
  flags: z.string().optional().describe('Regex flags; default "u".'),
  notText: z.string().optional().describe('Regular expression the text must NOT match.'),
  indices: z.array(z.number().int()).optional().describe('Exact paragraph numbers.'),
  range: z.tuple([z.number().int(), z.number().int()]).optional().describe('Inclusive paragraph range [from, to].'),
  within: z.tuple([z.number().int(), z.number().int()]).optional().describe('Limit text/indices matches to this inclusive range.'),
  allItalic: z.boolean().optional(),
  currentTag: z.string().optional().describe('Only paragraphs that currently have this tag (after earlier rules).'),
  maxLength: z.number().int().optional(),
  inContainer: z.string().optional().describe('Only paragraphs inside a container of this type (e.g. "var1-i"); for char rules.'),
}).describe('Which paragraphs. All given conditions must hold.')

const rule = z.object({
  kind: z.enum(['tag', 'topic', 'container', 'char']),
  style: z.string().optional().describe('kind=char: the character style, e.g. "diaspk", "cstyle1". Language and redaction styles are automatic; don\'t write rules for them.'),
  match: z.string().optional().describe('kind=char: regex for the characters to style in each selected paragraph (all matches); omit to style the whole paragraph.'),
  tag: z.string().optional().describe('kind=tag: the paragraph tag (Word style code), e.g. "num", "ext", "dia".'),
  topic: z.string().optional().describe('kind=topic: the topic that STARTS at each matched paragraph, e.g. "topic-chap".'),
  title: z.string().optional().describe('kind=topic: its title for file names ("Copyright (print)"); default = the topic\'s first line.'),
  container: z.string().optional().describe('kind=container: container type, e.g. "electr-i", "var1-i".'),
  group: z.enum(['runs', 'span']).optional().describe('kind=container: "runs" (default) = one container per run of consecutive matches; "span" = one container from first to last match.'),
  where,
  confidence: z.enum(['high', 'low']).optional().describe('low = goes on the review list.'),
  review: z.boolean().optional().describe('true = goes on the review list even at high confidence (editor\'s call).'),
  note: z.string().optional().describe('Why: one line the editor will read on the review list.'),
})

server.registerTool(
  'profile_tags',
  {
    title: 'Tag library',
    description: 'The tag library (profile): every paragraph tag with its label, the topics, character styles, and the house tagging guide. Read the guide before tagging. Use search to filter.',
    inputSchema: { profile: z.string().optional().describe('Profile name; defaults to your own profile if you have one, else "basic".'), search: z.string().optional() },
    annotations: READ,
  },
  tool(async ({ profile, search }) => {
    const p = loadProfile(profile)
    const q = search?.toLowerCase()
    const pick = (obj, label) => Object.entries(obj)
      .filter(([k, v]) => !q || k.toLowerCase().includes(q) || (v[label] ?? '').toLowerCase().includes(q))
      .map(([k, v]) => `${k} — ${v[label] ?? ''}${v.fmlo ? ' (first/middle/last/only)' : ''}${v.container ? ' (container)' : ''}${v.emit === false ? ' (not printed)' : ''}`)
    return { profile: p.name, guide: p.taggingGuide ?? [], topics: pick(p.topics, 'name'), paragraph: pick(p.paragraph, 'label'), character: pick(p.character, 'label') }
  }),
)

server.registerTool(
  'manuscript_open',
  {
    title: 'Open manuscript',
    description:
      'Start a tagging job from a Word manuscript (.docx). Untagged files start with every paragraph as body text (p). ' +
      'A tagged file keeps its tags as starting rules, or with ignoreTags its tags become an answer key for manuscript_score and Claude tags from scratch (a test).',
    inputSchema: {
      docx: absPath, out: absPath.describe('Folder for the job files and build output.'),
      profile: z.string().optional().describe('Tag library; defaults to your own profile if you have one, else "basic".'), ignoreTags: z.boolean().default(false), name: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async (a) => {
    const { path, job, stats, tagged } = await openJob(a)
    return { job: path, book: job.book, paragraphs: job.paragraphs, taggedFile: tagged, answerKey: job.hasKey, startingRules: job.rules.length, wordStats: stats,
      next: 'profile_tags for the guide, then manuscript_shapes and manuscript_outline (mode shortlist).' }
  }),
)

server.registerTool(
  'manuscript_shapes',
  {
    title: 'Paragraph shapes',
    description: 'Recurring shapes across the whole manuscript (headings, bracketed lines, all-italic runs, scene breaks, repeating short lines) with counts and examples. Use it to write rules that cover the whole book at once.',
    inputSchema: { job: jobArg },
    annotations: READ,
  },
  tool(async ({ job }) => shapes((await loadJob(job)).raw)),
)

server.registerTool(
  'manuscript_outline',
  {
    title: 'Manuscript outline',
    description:
      'Read the manuscript compactly. mode "shortlist" = paragraphs that may need a non-body tag (front matter, no end punctuation, all italic, after a colon) plus the one after each; ' +
      '"all" = every paragraph in from–to; "dialogue" = quoted and bracketed lines in from–to plus narration matching cue (for attributing speakers). ' +
      'Current non-body tags show in [brackets], topic starts in «». Paged: pass next as cursor.',
    inputSchema: {
      job: jobArg, mode: z.enum(['shortlist', 'all', 'dialogue']).default('shortlist'),
      from: z.number().int().optional(), to: z.number().int().optional(), cue: z.string().optional(),
      cursor: z.number().int().default(0), limit: z.number().int().max(600).default(300), max: z.number().int().default(120).describe('Characters shown per paragraph.'),
    },
    annotations: READ,
  },
  tool(async ({ job, ...o }) => {
    const { job: j, raw } = await loadJob(job)
    return outlinePage(raw, { ...o, to: o.to ?? raw.length - 1, from: o.from ?? 0, state: computeState(raw, j.rules, j.art) })
  }),
)

server.registerTool(
  'manuscript_find',
  {
    title: 'Find paragraphs',
    description: 'Paragraphs whose text matches a regular expression (case-insensitive by default), with their numbers and current tags.',
    inputSchema: { job: jobArg, text: z.string(), flags: z.string().default('iu'), limit: z.number().int().max(300).default(60) },
    annotations: READ,
  },
  tool(async ({ job, ...o }) => { const { job: j, raw } = await loadJob(job); return find(raw, computeState(raw, j.rules, j.art), o) }),
)

server.registerTool(
  'manuscript_scenes',
  {
    title: 'Find scenes',
    description:
      'Scenes (between topic starts and scene breaks) where a cue appears, widened by expand scenes either side, because a character can speak in a scene that never names them. ' +
      'Then read each with manuscript_outline mode "dialogue" over its from–to.',
    inputSchema: { job: jobArg, cues: z.string().describe('Regular expression of names/words that signal the character, e.g. "faer(y|ie|ies)|Frost|sisters".'),
      expand: z.number().int().min(0).max(3).default(1), minHits: z.number().int().min(1).default(1) },
    annotations: READ,
  },
  tool(async ({ job, ...o }) => { const { job: j, raw } = await loadJob(job); return scenes(raw, computeState(raw, j.rules, j.art), o) }),
)

server.registerTool(
  'manuscript_rules',
  {
    title: 'Tagging rules',
    description:
      'Add or remove tagging rules. Rules apply in order (a later rule overrides an earlier one on the same paragraph); every paragraph not matched stays p. ' +
      'Prefer one rule per pattern over many single paragraphs. Give low confidence or review:true to anything the editor should check, and a note saying why. ' +
      'Returns tag counts, rules with their match counts, warnings and any rejected rule with suggestions.',
    inputSchema: { job: jobArg, add: z.array(rule).default([]), remove: z.array(z.string()).default([]).describe('Rule ids to remove, e.g. ["r3"].') },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async ({ job, add, remove }) => {
    const { job: j, raw, profile } = await loadJob(job)
    const r = editRules(j, raw, profile, { add, remove })
    if (r.added.length || remove.length) await saveJob(job, j)
    return r
  }),
)

server.registerTool(
  'manuscript_review',
  {
    title: 'Review list',
    description: 'The review list for the editor, most uncertain first: structural problems, low-confidence tags, proposals to approve (e.g. voices), editor\'s-call tags, compositor notes. Writes <book>.review.md beside the job.',
    inputSchema: { job: jobArg, limit: z.number().int().default(80) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async ({ job, limit }) => {
    const { job: j, raw, profile, dir } = await loadJob(job)
    const items = reviewItems(raw, computeState(raw, j.rules, j.art), j, profile)
    const file = join(dir, `${j.book}.review.md`)
    await writeFile(file, reviewMarkdown(items, j))
    const counts = {}
    for (const x of items) counts[x.kind] = (counts[x.kind] ?? 0) + 1
    return { file, total: items.length, counts, items: items.slice(0, limit) }
  }),
)

server.registerTool(
  'manuscript_score',
  {
    title: 'Score against answer key',
    description: 'Only for a job opened with ignoreTags: compare the current tagging with the editor\'s original tags (paragraph tags, topics, containers, confusions).',
    inputSchema: { job: jobArg },
    annotations: READ,
  },
  tool(async ({ job }) => {
    const { job: j, raw, key } = await loadJob(job)
    if (!key) throw new Error('This job has no answer key. Open a tagged file with ignoreTags: true to score.')
    const { profile } = await loadJob(job)
    const state = computeState(raw, j.rules, j.art)
    const s = scoreTags(key, predictions(state))
    // Word's name for a style and the profile's code are the same style ("footnote reference" = fni).
    const aliases = Object.fromEntries(Object.entries(profile.character).filter(([, v]) => v.indesign).map(([k, v]) => [k, v.indesign]))
    const characters = scoreChars(key, (i) => styledRuns({ runs: raw[i].runs }, state.chars.get(i), profile), aliases)
    return { ...s, characters, examples: s.examples.slice(0, 25).map((e) => ({ ...e, text: raw[e.i].text.slice(0, 80) })),
      containers: { ...s.containers, missed: s.containers.missed.slice(0, 30), extra: s.containers.extra.slice(0, 30) } }
  }),
)

server.registerTool(
  'book_build',
  {
    title: 'Build book in InDesign',
    description:
      'Flow a tagged job into a copy of a template: one ICML per topic, missing styles created from their nearest relative, recto/verso starts from the profile. ' +
      'Writes <out>/<book>.indd, ICML/ and report.md. Never touches the template itself. Run manuscript_review first.',
    inputSchema: {
      job: jobArg, template: absPath, out: absPath.optional().describe('Defaults to the job folder.'),
      page: pageArg.optional().describe('A trim size and/or margins different from the template\'s.'),
      targetPages: z.number().int().optional().describe('The page count the user needs; the result says how far off this build is.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async ({ job, template, out, page, targetPages }) => {
    const { job: j, raw, profile, dir } = await loadJob(job)
    const paragraphs = taggedParagraphs(raw, computeState(raw, j.rules, j.art), profile)
    const spec = page ? pageSpec(page) : null
    const r = await buildBook({ paragraphs, template, out: out ?? dir, profile: j.profile, book: j.book, page: spec && { width: spec.width, height: spec.height, margins: spec.margins } })
    const fit = targetPages && r.pages ? { targetPages, pages: r.pages, difference: r.pages - targetPages,
      note: r.pages === targetPages ? 'On target.' : `${Math.abs(r.pages - targetPages)} pages ${r.pages > targetPages ? 'over' : 'under'} (${(100 * (r.pages - targetPages) / targetPages).toFixed(1)}%). Levers, all the designer's call: margins, trim, body size and leading in the template, or front/back matter. Propose one, rebuild, compare.` } : null
    return { indd: r.indd, report: r.report, pages: r.pages, fit, summary: r.summary.slice(0, 4000) }
  }),
)

// ── the designer's own scripts ──────────────────────────────

server.registerTool(
  'designer_scripts',
  {
    title: 'Designer scripts',
    description: 'The designer\'s own InDesign scripts the plugin can run without their dialogs: what each does, whether it changes the document, and its settings. They are never run as part of a build. ' +
      'An empty list means none are registered: point the designer to designer-scripts/README.md.',
    inputSchema: {},
    annotations: READ,
  },
  tool(async () => registry()),
)

server.registerTool(
  'designer_script_run',
  {
    title: 'Run a designer script',
    description:
      'Run one of the designer\'s scripts (see designer_scripts) on a document, without its dialogs; its alerts come back as the report. ' +
      'ONLY when the designer asks for it. For a script of kind "changes": first run with dryRun (if it has one) or preview, show the designer what would change, ' +
      'and run for real only after they agree (pass approved: true). A real run is one undo step in InDesign. The document is not saved.',
    inputSchema: {
      id: z.string(),
      document: absPath.optional().describe('Absolute path of the .indd; opened with a window if not already open. Omit to use the active document.'),
      settings: z.record(z.string(), z.unknown()).optional().describe('Script settings, as listed in designer_scripts.'),
      dryRun: z.boolean().default(false).describe('Run the script\'s own dry run: nothing changes.'),
      preview: z.boolean().default(false).describe('Run the plugin\'s read-only preview for a script with no dry run.'),
      approved: z.boolean().default(false).describe('The designer has seen the dry run or preview and agreed to the real run.'),
      answers: z.array(z.boolean()).optional().describe('Answers to the script\'s yes/no questions, in order; unanswered questions get "no".'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  tool(async ({ id, document, settings, dryRun, preview, approved, answers }) => {
    const entry = (await registry()).find((s) => s.id === id)
    if (!entry) throw new Error(`No script "${id}". Call designer_scripts for the list.`)
    if (preview) return previewDesignerScript({ id, document, settings })
    if (entry.kind === 'changes' && !dryRun && !approved)
      throw new Error(`${entry.name} changes the document. Run it with ${entry.dryRun ? 'dryRun: true' : 'preview: true'} first, show the designer the result, and pass approved: true once they agree.`)
    return runDesignerScript({ id, document, settings, dryRun, answers })
  }),
)

// ── export phase ────────────────────────────────────────────
// Reports and exports run freely; anything that changes the document needs the designer's approval.

const docPath = absPath.optional().describe('Absolute path of the .indd (opened with a window if needed). Omit for the active document.')
const needsApproval = (what) => new Error(`${what} changes the document. Show the designer the report first, then call again with approved: true once they agree.`)

server.registerTool(
  'book_signature',
  {
    title: 'Signatures',
    description: 'Page count against the print signature (from the profile: 16 for most trade books, 4 for a booklet): pages to the next signature, blank pages at the end. ' +
      'With add (and approved), adds that many pages at the end on a master. Where the extra pages go is the designer\'s call: ask.',
    inputSchema: { document: docPath, add: z.number().int().min(0).default(0), master: z.string().optional(), approved: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async ({ document, add, master, approved }) => {
    if (add && !approved) throw needsApproval(`Adding ${add} pages`)
    return signature({ path: document, add, master })
  }),
)

server.registerTool(
  'book_unused_styles',
  {
    title: 'Unused styles',
    description: 'Paragraph and character styles nothing in the document uses (stories, footnotes, tables), leaving out any a used style, object style, TOC style or footnote option depends on. ' +
      'For handoff: with remove (names from the report) and approved, deletes them as one undo step.',
    inputSchema: { document: docPath, remove: z.array(z.string()).optional(), approved: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  tool(async ({ document, remove, approved }) => {
    if (remove?.length && !approved) throw needsApproval(`Removing ${remove.length} styles`)
    return unusedStyles({ path: document, remove })
  }),
)

server.registerTool(
  'book_epub_prep',
  {
    title: 'EPUB readiness',
    description: 'Dry run (default): lists the EPUB export tagging the profile proposes: headings as h1–h6, extracts as blockquote, where files split, languages for language styles, and title/author/publisher/ISBN metadata. ' +
      'With apply and approved, makes those changes to the styles and document settings (one undo step). Ask the designer for metadata you don\'t know.',
    inputSchema: {
      document: docPath,
      meta: z.object({ title: z.string().optional(), author: z.string().optional(), publisher: z.string().optional(), isbn: z.string().optional() }).default({}),
      apply: z.boolean().default(false), approved: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async ({ document, meta, apply, approved }) => {
    if (apply && !approved) throw needsApproval('EPUB export tagging')
    return epubPrep({ path: document, meta, apply })
  }),
)

server.registerTool(
  'book_epub',
  {
    title: 'Export and check EPUB',
    description: 'Export a reflowable EPUB 3 (footnotes as pop-ups; export settings put back afterwards), then check it with EPUBCheck (validity) and DAISY Ace (accessibility). ' +
      'Returns both reports summarised; Ace\'s full HTML report path is included. Run book_epub_prep first.',
    inputSchema: {
      document: docPath, out: absPath.describe('Absolute path for the .epub.'),
      accessibility: z.object({
        accessMode: z.array(z.string()).optional().describe('e.g. ["textual"] (add "visual" if images carry meaning)'),
        accessModeSufficient: z.array(z.string()).optional().describe('e.g. ["textual"]'),
        features: z.array(z.string()).optional().describe('e.g. ["structuralNavigation", "tableOfContents", "readingOrder", "displayTransformability", "pageNavigation"]'),
        hazards: z.array(z.string()).optional().describe('e.g. ["none"]'),
        summary: z.string().optional(),
        conformsTo: z.string().optional().describe('Only when the publisher claims it, e.g. "EPUB Accessibility 1.1 - WCAG 2.2 Level AA".'),
        certifiedBy: z.string().optional(),
        printIsbn: z.string().optional().describe('Source of the print page numbers in the EPUB.'),
        pageBreakSourceProperty: z.boolean().optional().describe('Also write a11y:pageBreakSource (EPUB Accessibility 1.1). Off by default: EPUBCheck 5.3 rejects it.'),
      }).optional().describe('Accessibility metadata: the publisher\'s claims. Propose values, confirm them with the designer, never invent conformance.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async ({ document, out, accessibility }) => epub({ path: document, out, accessibility })),
)

server.registerTool(
  'book_epub_direct',
  {
    title: 'EPUB without InDesign',
    description:
      'Write an EPUB 3 straight from a tagged manuscript or a tagging job — no InDesign: one file per topic with chapter/dedication/copyright semantics, real headings, block quotes, lists, ' +
      'pop-up footnotes and language spans; typography from the template\'s IDML (File › Save As › IDML) if given. Then EPUBCheck and Ace. ' +
      'Accessibility metadata are the publisher\'s claims: confirm them with the designer. For print page numbers in an EPUB, use book_epub (they come from the InDesign layout).',
    inputSchema: {
      job: absPath.optional().describe('A .job.json (its current rules), or…'), docx: absPath.optional().describe('…a tagged .docx'),
      out: absPath.describe('Absolute path for the .epub.'), idml: absPath.optional().describe('The template saved as IDML, for its typography.'),
      images: absPath.optional().describe('Folder with the art log\'s image files: each piece placed by manuscript_art becomes a figure with its caption and alt text.'),
      ornament: absPath.optional().describe('An image used for ornamented scene breaks instead of "* * *".'),
      openers: absPath.optional().describe('Folder from book_epub_openers: each chapter starts with its heading block as styled in the layout.'),
      meta: z.object({ title: z.string(), author: z.string().optional(), publisher: z.string().optional(), isbn: z.string().optional().describe('E-book ISBN'), language: z.string().optional() }),
      accessibility: z.object({
        accessMode: z.array(z.string()).optional(), accessModeSufficient: z.array(z.string()).optional(), features: z.array(z.string()).optional(),
        hazards: z.array(z.string()).optional(), summary: z.string().optional(), conformsTo: z.string().optional(), certifiedBy: z.string().optional(),
      }).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async ({ job, docx, out, idml, meta, accessibility, images, ornament, openers }) => {
    if (!job && !docx) throw new Error('Pass job or docx.')
    let paragraphs, profile
    if (job) { const j = await loadJob(job); paragraphs = taggedParagraphs(j.raw, computeState(j.raw, j.job.rules, j.job.art), j.profile); profile = j.profile }
    const r = await buildEpub({ docx, paragraphs, profile, out, idml, meta, a11y: accessibility, images, ornament, openers })
    return { epub: r.epub, files: r.files, footnotes: r.notes, figures: r.figures, openers: r.openers, warnings: r.warnings, stylesWithoutCss: r.stylesWithoutCss,
      epubcheck: { fatal: r.epubcheck.fatal, errors: r.epubcheck.errors, warnings: r.epubcheck.warnings, messages: r.epubcheck.messages?.filter((m) => m.severity !== 'INFO').slice(0, 10), error: r.epubcheck.error },
      ace: { outcome: r.ace.outcome, violations: r.ace.violations?.slice(0, 10), metadataMissing: r.ace.metadata?.missing, report: r.ace.report, error: r.ace.error } }
  }),
)

server.registerTool(
  'book_epub_openers',
  {
    title: 'Styled chapter openers for the EPUB',
    description: 'From a built, designed document: export each chapter\'s opening heading lines (number, title, place and date lines…) as one image, exactly as styled in the layout and at the text column\'s width. ' +
      'Pass the folder to book_epub_direct as `openers`; the image replaces those lines and carries their text as alt text. Run after the designer has styled the openers. Changes nothing in the document.',
    inputSchema: { document: docPath, outDir: absPath.describe('Folder to write the images and openers.json into.'), resolution: z.number().int().default(220),
      transparent: z.boolean().default(true).describe('false = white background (safer for night mode with dark type).') },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async ({ document, outDir, resolution, transparent }) => epubOpeners({ path: document, outDir, resolution, transparent })),
)

server.registerTool(
  'book_pdf',
  {
    title: 'Print PDF',
    description: 'Preflight the document, export the print PDF with a preset, and warn if the page count is not a whole number of signatures.',
    inputSchema: { document: docPath, out: absPath, pdfPreset: z.string().optional().describe('e.g. "[High Quality Print]" or the house preset.'), preflightProfile: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async ({ document, out, pdfPreset, preflightProfile }) => printPdf({ path: document, out, pdfPreset, preflightProfile })),
)

server.registerTool(
  'book_package',
  {
    title: 'Handoff check and package',
    description: 'For handing a book to a printer or the next designer. Without approved: a read-only handoff check (missing or out-of-date links, ' +
      'missing, substituted and Adobe Fonts, overset text, low-resolution and RGB images, hidden layers, preflight, signature, unused styles), ' +
      'split into blockers and things to review. Show it to the designer. With out and approved: runs File > Package into that new, empty folder ' +
      '(fonts, links, IDML, Instructions.txt, optionally a PDF). The document is never saved or changed: if it has unsaved changes, ask the designer to save it.',
    inputSchema: {
      document: docPath,
      out: absPath.optional().describe('New, empty folder for the package (required with approved).'),
      approved: z.boolean().default(false).describe('The designer has seen the handoff check and wants the package made.'),
      pdf: z.boolean().default(false).describe('Also put a PDF in the package.'),
      pdfPreset: z.string().optional().describe('PDF preset for that PDF, e.g. the printer\'s or "[PDF/X-4:2008]".'),
      idml: z.boolean().default(true),
      fonts: z.boolean().default(true).describe('Copy fonts (Adobe Fonts are never copied; the report says which).'),
      comments: z.string().optional().describe('Notes for the printer, written into the package report.'),
      preflightProfile: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async ({ document, out, approved, pdf, pdfPreset, idml, fonts, comments, preflightProfile }) => {
    if (!approved) return handoffCheck({ path: document, preflightProfile })
    if (!out) throw new Error('Give out: a new, empty folder for the package.')
    return packageBook({ path: document, out, pdf, pdfPreset, idml, fonts, comments })
  }),
)

// ── general design: zines, booklets, flyers ─────────────────

server.registerTool(
  'design_fonts',
  {
    title: 'Available fonts',
    description: 'Font families InDesign can use on this computer right now (installed fonts and any the user has activated from Adobe Fonts), with their styles. ' +
      'Suggest pairings only from this list; to use an Adobe Fonts family that is not listed, the user activates it themselves at fonts.adobe.com.',
    inputSchema: { search: z.string().optional(), limit: z.number().int().max(600).default(150) },
    annotations: READ,
  },
  tool(async (a) => fonts(a)),
)

server.registerTool(
  'design_new_document',
  {
    title: 'New document from specs',
    description: 'Create and save a new InDesign document: page size (named or custom), pages, facing or single, margins, columns, bleed, baseline grid, and a starter set of paragraph styles ' +
      '(a type system the user has agreed to: fonts from design_fonts, sizes, leading). Opens nothing on screen; the user opens the saved file.',
    inputSchema: {
      out: absPath.describe('Absolute path for the new .indd.'), page: pageArg, pages: z.number().int().min(1).default(1), facing: z.boolean().default(true),
      columns: z.number().int().min(1).default(1), gutter: z.number().optional().describe('In the page unit.'), bleed: z.number().optional().describe('In the page unit, e.g. 0.125 in.'),
      baseline: z.object({ start: z.number().describe('From the top of the page, in the page unit.'), increment: z.number().describe('Points; normally the body leading.') }).optional(),
      styles: z.array(z.object({
        name: z.string(), font: z.string().optional(), fontStyle: z.string().optional(), size: z.number().optional().describe('pt'), leading: z.number().optional().describe('pt'),
        align: z.enum(['left', 'center', 'right', 'justify']).optional(), firstLineIndent: z.number().optional().describe('pt'), spaceBefore: z.number().optional().describe('pt'), spaceAfter: z.number().optional().describe('pt'),
        basedOn: z.string().optional(), alignToBaseline: z.boolean().optional(),
      })).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async (a) => newDocument(a)),
)

server.registerTool(
  'design_impose',
  {
    title: 'Impose for folding',
    description: 'Make a print-ready imposed PDF (and .indd) from a document, leaving the original untouched. "saddle-stitch": pages 2-up in booklet order for double-sided printing, folding and stapling (padded to a multiple of 4). ' +
      '"mini-zine": up to 8 pages on one side of one sheet, top row upside down, for the cut-and-fold zine. Returns the page order and folding notes.',
    inputSchema: { document: docPath, kind: z.enum(['saddle-stitch', 'mini-zine']), out: absPath.describe('Absolute path for the imposed file (.pdf or .indd; both are written).') },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async (a) => impose(a)),
)

// ── art: art logs, image checks, placing art ────────────────

server.registerTool(
  'manuscript_art',
  {
    title: 'Attach an art log',
    description: 'Match an art log (CSV or XLSX; columns found by name: Fig/ID, File, Caption, Credit, Alt text, Size, Placement, Chapter, Color) to a tagging job. ' +
      'Each piece is placed at a callout in the manuscript ("[Insert Fig. 2.1]", "<photo3.jpg>", a compositor note naming the file; the callout is removed) or after the paragraph its Placement phrase names. ' +
      'book_build then writes each as a Note (Window › Editorial › Notes) at that spot. Reports anything it could not place.',
    inputSchema: { job: jobArg, artLog: absPath },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async (a) => attachArtLog(a)),
)

server.registerTool(
  'art_check',
  {
    title: 'Check images',
    description: 'Check images (from an art log, or every file in a folder) at the size they will print: pixels, effective ppi, colour space, format. ' +
      'Flags low resolution (under 300 ppi; 1,200 for 1-bit line art), RGB in a one-colour book, formats that need converting for print or EPUB. Changes nothing. macOS (uses sips).',
    inputSchema: {
      folder: absPath.describe('Folder with the image files.'), artLog: absPath.optional(),
      columnWidth: z.number().default(306).describe('Text column width in points (306 = 4.25 in); sizes like "half" are fractions of it.'),
      color: z.enum(['1c', '2c', '4c']).default('4c').describe('How the book prints: one colour (black), two colour, or four colour.'), minPpi: z.number().default(300),
    },
    annotations: READ,
  },
  tool(async (a) => artCheck(a)),
)

server.registerTool(
  'art_place',
  {
    title: 'Place art at its notes',
    description: 'Read the art notes ("ART: …") in a document and plan frames: page, size (column width or a fraction of it; "full-page", "half", "3 in"), wrap or above the line, effective ppi. ' +
      'Dry run by default. With approved: true, creates anchored frames at each note: image placed and fitted, caption and credit beneath, alt text for EPUB; pieces narrower than the column get a text wrap. ' +
      'A missing file gets a grey placeholder. One undo step; each note is marked "placed" so a second run skips it. Only when the designer asks; show the plan first.',
    inputSchema: { document: docPath, folder: absPath.describe('Folder with the image files.'), approved: z.boolean().default(false), color: z.enum(['1c', '2c', '4c']).default('4c'), minPpi: z.number().default(300) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async (a) => artPlace(a)),
)

await server.connect(new StdioServerTransport())
