// Images for a directly written EPUB: art-log figures, a scene-break ornament, styled chapter openers.
// Formats an EPUB can't use (TIFF, PSD…) and very large images are converted with macOS `sips` when available.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { findIsbn, icmlFileNames } from './icml.mjs'

const exec = promisify(execFile)
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml' }
const MAX_EDGE = 2000

async function findFile(folder, name) {
  if (!name || !folder) return null
  if (existsSync(join(folder, name))) return join(folder, name)
  const want = name.toLowerCase(), base = want.replace(/\.[a-z0-9]+$/, '')
  for (const f of await readdir(folder)) { const l = f.toLowerCase(); if (l === want || l.replace(/\.[a-z0-9]+$/, '') === base) return join(folder, f) }
  return null
}

/** Bytes and extension ready for an EPUB; converts or downsizes with sips where it can. */
async function prepare(path, warnings) {
  let ext = extname(path).toLowerCase()
  const ok = !!TYPES[ext]
  if (process.platform === 'darwin' && ext !== '.svg') {
    try {
      const { stdout } = await exec('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path])
      const w = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1]), h = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1])
      if (!ok || Math.max(w, h) > MAX_EDGE) {
        const outExt = ext === '.png' || ext === '.gif' ? '.png' : '.jpg'
        const out = join(await mkdtemp(join(tmpdir(), 'epub-img-')), `i${outExt}`)
        await exec('sips', ['-Z', String(MAX_EDGE), '-s', 'format', outExt === '.png' ? 'png' : 'jpeg', path, '--out', out])
        return { bytes: await readFile(out), ext: outExt, converted: !ok }
      }
    } catch (e) { if (!ok) { warnings.push(`${basename(path)}: could not be converted (${e.message.split('\n')[0]})`); return null } }
  }
  if (!ok) { warnings.push(`${basename(path)}: ${ext} can't go in an EPUB; supply a JPEG or PNG (automatic conversion needs macOS)`); return null }
  return { bytes: await readFile(path), ext }
}

/**
 * @param {{ resolved, profile, images?: string, ornament?: string, openers?: string }} o  images/openers are folders
 * @returns {{ figures: Map, ornament: object|null, openers: Map, files: Array<{ name, bytes, type }>, names: string[], warnings: string[] }}
 */
export async function gatherMedia(o) {
  const warnings = [], files = [], figures = new Map(), openers = new Map()
  const names = icmlFileNames(o.resolved.topics, o.profile, findIsbn(o.resolved.topics, o.profile)).map((n) => n.replace(/\.icml$/, ''))
  const used = new Set()
  const add = (stem, p) => {
    let name = `${stem.replace(/[^A-Za-z0-9._-]+/g, '-')}${p.ext}`
    while (used.has(name)) name = name.replace(/(\.[a-z]+)$/, '_$1')
    used.add(name)
    files.push({ name, bytes: p.bytes, type: TYPES[p.ext] })
    return name
  }
  const art = o.resolved.topics.flatMap((t) => t.items.flatMap((it) => (it.art ?? []).map((a) => a.item)))
  for (const item of art) {
    if (!item.file || figures.has(item.file)) continue
    const path = await findFile(o.images, item.file)
    if (!path) { warnings.push(`art ${item.id}: "${item.file}" ${o.images ? 'is not in the images folder' : 'needs an images folder'}; left out of the EPUB`); continue }
    const p = await prepare(path, warnings)
    if (p) figures.set(item.file, { name: add(`fig-${basename(item.file).replace(/\.[a-z0-9]+$/i, '')}`, p) })
  }
  let ornament = null
  if (o.ornament) {
    const p = existsSync(o.ornament) ? await prepare(o.ornament, warnings) : null
    if (p) ornament = { name: add('ornament', p) }
    else warnings.push(`ornament "${o.ornament}" not found or unusable`)
  }
  if (o.openers) {
    const list = JSON.parse(await readFile(join(o.openers, 'openers.json'), 'utf8'))
    for (const [key, e] of Object.entries(list.openers ?? {})) {
      const path = join(o.openers, e.image)
      if (!existsSync(path)) { warnings.push(`opener image ${e.image} missing`); continue }
      openers.set(key, { name: add(`opener-${key}`, { bytes: await readFile(path), ext: extname(e.image).toLowerCase() }), paragraphs: e.paragraphs })
    }
  }
  return { figures, ornament, openers, files, names, warnings }
}
