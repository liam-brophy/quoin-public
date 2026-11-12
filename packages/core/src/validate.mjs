// EPUB checks: EPUBCheck (validity) and DAISY Ace (accessibility), summarised. Both run anywhere
// Java / Node do; nothing here needs InDesign.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export async function epubcheck(file) {
  const dir = await mkdtemp(join(tmpdir(), 'epubcheck-'))
  const json = join(dir, 'report.json')
  // Run EPUBCheck's jar with whichever Java works: Homebrew's launcher hard-codes a JDK path that can go missing.
  const jar = [process.env.EPUBCHECK_JAR, '/usr/local/opt/epubcheck/libexec/epubcheck.jar', '/opt/homebrew/opt/epubcheck/libexec/epubcheck.jar'].find((p) => p && existsSync(p))
  const [cmd, args] = jar ? ['java', ['-jar', jar, file, '--json', json]] : ['epubcheck', [file, '--json', json]]
  let stderr = ''
  try { await exec(cmd, args, { timeout: 10 * 60_000, maxBuffer: 64 << 20 }) } catch (e) { stderr = String(e.stderr ?? e.message) /* also non-zero when it finds errors */ }
  try {
    const r = JSON.parse(await readFile(json, 'utf8'))
    const by = new Map()
    for (const m of r.messages ?? []) {
      const k = `${m.severity} ${m.ID}`
      const e = by.get(k) ?? { severity: m.severity, id: m.ID, message: m.message, count: 0, where: [] }
      e.count++
      if (e.where.length < 3) e.where.push(...(m.locations ?? []).slice(0, 1).map((l) => `${l.path}${l.line > 0 ? `:${l.line}` : ''}`))
      by.set(k, e)
    }
    const c = r.checker ?? {}
    return { fatal: c.nFatal ?? 0, errors: c.nError ?? 0, warnings: c.nWarning ?? 0, usage: c.nUsage ?? 0,
      messages: [...by.values()].sort((a, b) => rank(a.severity) - rank(b.severity) || b.count - a.count).slice(0, 25) }
  } catch (e) {
    return { error: `EPUBCheck did not produce a report: ${e.message}`, detail: stderr.slice(0, 400) }
  }
}
const rank = (s) => ({ FATAL: 0, ERROR: 1, WARNING: 2, USAGE: 3, INFO: 4 })[s] ?? 5

export async function ace(file) {
  const dir = await mkdtemp(join(tmpdir(), 'ace-'))
  try { await exec('ace', ['--outdir', dir, '--force', file], { timeout: 15 * 60_000, maxBuffer: 64 << 20 }) } catch { /* non-zero on violations */ }
  try {
    const r = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'))
    const by = new Map()
    for (const doc of r.assertions ?? []) for (const a of doc.assertions ?? []) {
      if (a['earl:result']?.['earl:outcome'] !== 'fail') continue
      const t = a['earl:test'] ?? {}
      const k = t['dct:title']
      const e = by.get(k) ?? { rule: k, impact: t['earl:impact'], what: (t['dct:description'] ?? '').slice(0, 160), count: 0, files: new Set() }
      e.count++
      e.files.add(doc['earl:testSubject']?.url)
      by.set(k, e)
    }
    const order = { critical: 0, serious: 1, moderate: 2, minor: 3 }
    const violations = [...by.values()].map((e) => ({ ...e, files: [...e.files].slice(0, 3) }))
      .sort((a, b) => (order[a.impact] ?? 4) - (order[b.impact] ?? 4) || b.count - a.count)
    const counts = {}
    for (const v of violations) counts[v.impact] = (counts[v.impact] ?? 0) + v.count
    return { outcome: r['earl:result']?.['earl:outcome'], violationsByImpact: counts, violations: violations.slice(0, 25),
      metadata: r['a11y-metadata'] ? { present: r['a11y-metadata'].present, missing: r['a11y-metadata'].missing } : null, report: join(dir, 'report.html') }
  } catch (e) {
    return { error: `Ace did not produce a report: ${e.message}` }
  }
}

