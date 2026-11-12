#!/usr/bin/env node
// node scripts/build-book.mjs --docx book.docx --template template.indd --out out/Book [--profile <name>] [--no-indesign]
import { parseArgs } from 'node:util'
import { buildBook } from '../server/build.mjs'

const { values } = parseArgs({
  options: {
    docx: { type: 'string' }, template: { type: 'string' }, out: { type: 'string' },
    profile: { type: 'string' }, book: { type: 'string' },
    'no-indesign': { type: 'boolean', default: false },
  },
})
if (!values.docx || !values.out || (!values.template && !values['no-indesign'])) {
  console.error('usage: build-book.mjs --docx <file> --template <indd> --out <dir> [--profile <name>] [--no-indesign]')
  process.exit(2)
}
const t = Date.now()
const r = await buildBook({ ...values, indesign: !values['no-indesign'] })
console.log(r.summary)
console.log(`done in ${((Date.now() - t) / 1000).toFixed(1)} s → ${r.indd ?? r.out}`)
