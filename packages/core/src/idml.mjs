// Read a template's paragraph and character styles from an IDML file (InDesign's XML format).
// Inheritance (BasedOn) is followed to the root, as InDesign does. No InDesign needed.
import { readFile } from 'node:fs/promises'
import { strFromU8, unzipSync } from 'fflate'
import { SaxesParser } from 'saxes'

// InDesign's own defaults for "[No paragraph style]".
const ROOT = { PointSize: 12, Leading: 'Auto', AutoLeading: 120, Justification: 'LeftAlign', FontStyle: 'Regular', AppliedFont: 'Minion Pro',
  FirstLineIndent: 0, LeftIndent: 0, RightIndent: 0, SpaceBefore: 0, SpaceAfter: 0, Capitalization: 'Normal', Tracking: 0, Position: 'Normal' }
const FIELDS = ['PointSize', 'Leading', 'AutoLeading', 'Justification', 'FontStyle', 'AppliedFont', 'FirstLineIndent', 'LeftIndent', 'RightIndent',
  'SpaceBefore', 'SpaceAfter', 'Capitalization', 'Tracking', 'Position', 'Underline', 'StrikeThru', 'StartParagraph', 'FillColor']

/** @returns {{ paragraph: Map<string, object>, character: Map<string, object> }} specs by style name, inheritance resolved */
export async function readIdmlStyles(path) {
  const files = unzipSync(new Uint8Array(await readFile(path)), { filter: (f) => f.name === 'Resources/Styles.xml' })
  if (!files['Resources/Styles.xml']) throw new Error('Not an IDML file (no Resources/Styles.xml).')
  const raw = { ParagraphStyle: new Map(), CharacterStyle: new Map() }
  let cur = null, prop = null, text = ''
  const sax = new SaxesParser()
  sax.on('opentag', ({ name, attributes: a }) => {
    if (name === 'ParagraphStyle' || name === 'CharacterStyle') {
      cur = { kind: name, self: a.Self, name: a.Name?.replace(/^\$ID\//, ''), basedOn: null }
      for (const f of FIELDS) if (a[f] !== undefined) cur[f] = a[f]
    } else if (cur && name !== 'Properties') { prop = name; text = '' }
  })
  sax.on('text', (t) => { if (prop) text += t })
  sax.on('closetag', ({ name }) => {
    if (cur && name === prop) {
      if (prop === 'BasedOn') cur.basedOn = text.trim()
      else if (FIELDS.includes(prop)) cur[prop] = text.trim()
      prop = null
    }
    if (name === 'ParagraphStyle' || name === 'CharacterStyle') { raw[name].set(cur.self, cur); cur = null }
  })
  sax.write(strFromU8(files['Resources/Styles.xml'])).close()

  const resolve = (kind, isPara) => {
    const out = new Map()
    const flat = (s, seen = new Set()) => {
      if (!s || seen.has(s.self)) return isPara ? { ...ROOT } : {}
      seen.add(s.self)
      const parent = s.basedOn && raw[kind].get(s.basedOn.startsWith(`${kind}/`) ? s.basedOn : `${kind}/${s.basedOn}`)
      const base = flat(parent, seen)
      const own = Object.fromEntries(FIELDS.filter((f) => s[f] !== undefined).map((f) => [f, s[f]]))
      return { ...base, ...own }
    }
    for (const s of raw[kind].values()) if (s.name && !/^\[/.test(s.name)) out.set(s.name, flat(s))
    return out
  }
  return { paragraph: resolve('ParagraphStyle', true), character: resolve('CharacterStyle', false) }
}
