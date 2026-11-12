// Art: match an art log to a job, check images, place art at its notes in InDesign.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'
import { findArtPlaces, parseArtNote, readArtLog } from 'book-core/art'
import { computeState, loadJob, saveJob, setArt } from 'book-core/job'
import { runJsx, script } from './bridge.mjs'

const exec = promisify(execFile)

/** Match an art log to a job and store the matches on it. */
export async function attachArtLog({ job, artLog }) {
  const { job: j, raw } = await loadJob(job)
  const { items, columns, ignored } = await readArtLog(artLog)
  const state = computeState(raw, j.rules)
  const found = findArtPlaces(raw, items, { topics: state.topic, titles: state.topicTitle })
  setArt(j, { log: artLog, items, ...found })
  await saveJob(job, j)
  return {
    artLog, items: items.length, columnsRead: columns, columnsIgnored: ignored,
    placed: found.places.map((p) => ({ id: p.id, paragraph: p.index, how: p.how, text: raw[p.index].text.slice(0, 70) })),
    unmatched: found.unmatched, calloutsWithoutArt: found.unusedCallouts,
    next: 'book_build writes these as Notes (Window › Editorial › Notes) in the ICML; art_place turns them into frames.',
  }
}

/** Pixel size, resolution, colour space and format of an image (macOS sips). */
export async function imageInfo(file) {
  const { stdout } = await exec('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'dpiWidth', '-g', 'space', '-g', 'format', '-g', 'bitsPerSample', file])
  const get = (k) => /:\s*(.+)$/.exec(stdout.split('\n').find((l) => l.trim().startsWith(`${k}:`)) ?? '')?.[1]?.trim()
  return { width: Number(get('pixelWidth')), height: Number(get('pixelHeight')), dpi: Number(get('dpiWidth')) || null, space: get('space') ?? null, format: get('format') ?? null, bits: Number(get('bitsPerSample')) || null }
}

const FRACTION = { full: 1, 'full-page': 1, page: 1, 'full page': 1, column: 1, 'full-width': 1, 'full width': 1, 'full column': 1, 'two-thirds': 2 / 3, half: 0.5, third: 1 / 3, quarter: 0.25 }
const UNIT = { in: 72, inch: 72, '"': 72, mm: 72 / 25.4, cm: 72 / 2.54, pt: 1, p: 12, pica: 12 }

/** Width in points and layout mode for a size word ("half", "3 in", "full-page") in a column of `col` points. */
export function sizeFor(size, col, frameHeight) {
  const s = String(size ?? '').trim().toLowerCase()
  if (!s) return { width: col, mode: 'above', fullPage: false }
  if (FRACTION[s] !== undefined) return { width: col * FRACTION[s], mode: FRACTION[s] >= 0.9 ? 'above' : 'wrap', fullPage: /page/.test(s) }
  const m = /^([\d.]+)\s*(in|inch|"|mm|cm|pt|p|pica)?/.exec(s)
  if (m) { const w = Math.min(Number(m[1]) * (UNIT[m[2] ?? 'in']), col); return { width: w, mode: w >= 0.9 * col ? 'above' : 'wrap', fullPage: false } }
  return { width: col, mode: 'above', fullPage: false, unknown: true }
}

async function findFile(folder, name) {
  if (!name || !folder) return null
  if (existsSync(join(folder, name))) return join(folder, name)
  const want = name.toLowerCase(), base = want.replace(/\.[a-z0-9]+$/, '')
  for (const f of await readdir(folder)) { const l = f.toLowerCase(); if (l === want || l.replace(/\.[a-z0-9]+$/, '') === base) return join(folder, f) }
  return null
}

const PRINT_EXT = new Set(['.tif', '.tiff', '.psd', '.jpg', '.jpeg', '.png', '.pdf', '.ai', '.eps'])
const WEB_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.svg'])

/** Flags for one image at its intended width (points). */
export function flags(info, file, widthPt, { color = '4c', minPpi = 300 } = {}) {
  const out = []
  const ppi = info.width && widthPt ? Math.round(info.width / (widthPt / 72)) : null
  const lineArt = info.bits === 1
  if (ppi !== null) {
    const need = lineArt ? 1200 : minPpi
    if (ppi < need * 0.67) out.push({ level: 'error', what: `${ppi} ppi at ${(widthPt / 72).toFixed(2)} in wide: too low for print (${need}+ wanted${lineArt ? ' for line art' : ''})` })
    else if (ppi < need) out.push({ level: 'warn', what: `${ppi} ppi at ${(widthPt / 72).toFixed(2)} in wide: below ${need}; may look soft` })
  }
  const space = String(info.space ?? '').toLowerCase()
  if (color === '1c' && space && space !== 'gray') out.push({ level: 'warn', what: `${info.space} in a one-colour book: convert to grayscale` })
  if (color === '4c' && space === 'rgb') out.push({ level: 'info', what: 'RGB: fine if the PDF export converts to the printer\'s CMYK; otherwise convert' })
  if (color === '2c') out.push({ level: 'info', what: 'Two-colour (duotone/spot) separation is set up in Photoshop or InDesign swatches; not checked here' })
  const ext = extname(file).toLowerCase()
  if (!PRINT_EXT.has(ext)) out.push({ level: 'warn', what: `${ext} is not a usual print format` })
  if (!WEB_EXT.has(ext)) out.push({ level: 'info', what: `${ext} must be converted to JPEG or PNG for an EPUB` })
  return { ppi, flags: out }
}

/** Check every image in an art log (or folder) at its intended size. */
export async function artCheck({ artLog, folder, columnWidth = 306, frameHeight = 520, color = '4c', minPpi = 300 }) {
  const items = artLog ? (await readArtLog(artLog)).items : (await readdir(folder)).filter((f) => !f.startsWith('.')).map((f) => ({ id: f, file: f, size: '' }))
  const out = []
  for (const it of items) {
    const file = await findFile(folder, it.file)
    if (!file) { out.push({ id: it.id, file: it.file, flags: [{ level: 'error', what: 'file not found' }] }); continue }
    const info = await imageInfo(file)
    const s = sizeFor(it.size, columnWidth, frameHeight)
    const height = info.width ? s.width * (info.height / info.width) : null
    const color2 = (it.color || '').toLowerCase().match(/[124]c|gray|grey|bw|b\/w/) ? ((it.color.toLowerCase().match(/gray|grey|bw|b\/w|1c/) ? '1c' : it.color.toLowerCase().match(/2c/) ? '2c' : '4c')) : color
    out.push({ id: it.id, file: it.file, pixels: `${info.width} × ${info.height}`, space: info.space, format: info.format, intended: `${(s.width / 72).toFixed(2)} × ${height ? (height / 72).toFixed(2) : '?'} in (${it.size || 'column'})`, ...flags(info, file, s.width, { color: color2, minPpi }) })
  }
  const count = (l) => out.filter((x) => x.flags.some((f) => f.level === l)).length
  return { images: out.length, withErrors: count('error'), withWarnings: count('warn'), assumed: { columnWidthIn: +(columnWidth / 72).toFixed(2), color, minPpi }, results: out }
}

/** Plan (dry run) or place (approved) art at the document's art notes. */
export async function artPlace({ document, folder, approved = false, color = '4c', minPpi = 300 }) {
  const { notes } = await runJsx(await script('art-notes'), { path: document })
  const plan = []
  for (const n of notes) {
    const item = parseArtNote(n.text)
    if (!item) continue
    if (item.placed) { plan.push({ id: item.id, page: n.page, skip: `already placed (${item.placed})` }); continue }
    if (n.overset) { plan.push({ id: item.id, skip: 'note is in overset text: flow the story first' }); continue }
    const file = await findFile(folder, item.file)
    const s = sizeFor(item.size, n.columnWidth, n.frameHeight)
    let height = s.width * 0.75, check = null
    if (file) {
      const info = await imageInfo(file)
      if (info.width) height = s.width * (info.height / info.width)
      check = flags(info, file, s.width, { color, minPpi })
    }
    // Leave room for a caption; never taller than the text frame.
    const room = n.frameHeight - (item.caption ? 36 : 0)
    if (height > room) { const k = room / height; height = room; s.width = s.width * k }
    plan.push({
      id: item.id, page: n.page, story: n.story, note: n.note, file, fileName: item.file ?? null, mode: s.mode,
      size: `${(s.width / 72).toFixed(2)} × ${(height / 72).toFixed(2)} in`, width: s.width, height,
      caption: [item.caption, item.credit].filter(Boolean).join(' '), alt: item.alt ?? null,
      ppi: check?.ppi ?? null, flags: check?.flags ?? (file ? [] : [{ level: 'error', what: `file "${item.file}" not in the folder: a grey placeholder frame will be used` }]),
      captionStyles: n.topic ? [`${n.topic}_cap`, 'chap_cap', 'cap', 'caption', 'Caption'] : ['chap_cap', 'cap', 'caption', 'Caption'],
      unknownSize: s.unknown ? item.size : undefined,
    })
  }
  const todo = plan.filter((p) => !p.skip)
  if (!approved) return { document, dryRun: true, artNotes: plan.length, toPlace: todo.length, plan: plan.map(({ story, note, width, height, captionStyles, ...p }) => p),
    next: todo.length ? 'Show the designer this plan; call again with approved: true to place. One undo step; stories are checked out to place art in them.' : 'Nothing to place.' }
  const r = await runJsx(await script('art-place'), { path: document, items: todo.map((p) => ({ story: p.story, note: p.note, id: p.id, page: p.page, file: p.file, width: p.width, height: p.height, mode: p.mode, caption: p.caption, alt: p.alt, captionStyles: p.captionStyles })) },
    { undoName: `Place ${todo.length} art`, timeoutMs: 15 * 60_000 })
  return { document, placed: r.placed, missing: r.missing, storiesCheckedOut: r.checkedOut, stylesCreated: r.createdStyles, warnings: r.warnings,
    note: 'Saved? No: the document is open with the changes; the designer saves. Each note now says "placed".' }
}
