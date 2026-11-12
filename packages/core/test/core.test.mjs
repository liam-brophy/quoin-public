// Self-test for book-core: a small tagged Word file built in memory, through every stage.
// No InDesign, no Claude, no private manuscripts: runs anywhere (node --test or npm test).
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import {
  buildEpub, computeState, findArtPlaces, listProfiles, miniZine, parseArtNote, readArtLog, saddleStitch, setArt, findIsbn, loadJob, loadProfile, openJob, predictions, readDocx, resolve,
  scoreTags, styledRuns, taggedParagraphs, writeIcmlBook,
} from '../src/index.mjs'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const run = (text, style) => `<w:r>${style ? `<w:rPr><w:rStyle w:val="${style}"/></w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`
const para = (style, ...runs) => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${runs.join('')}</w:p>`
const note = `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>`

const BODY = [
  para('topic-cpy', run('Copyright Page')),
  para('cpy', run('Copyright © 2026 by A. Writer.')),
  para('isbn', run('ISBN 978-0-00-000000-2')),
  para('topic-chap', run('Chapter 1')),
  para('num', run('Chapter 1')),
  para('loc', run('Kyoto, Japan')),
  para('da', run('Monday, May 4, 2026')),
  para('p', run('She met '), run('ケン', null), run(' at the station.'), note, run(' Then it rained.')),
  para('p', run('A second paragraph, with '), run('emphasis', 'i'), run('.')),
  para('ext', run('An extract, first line.')),
  para('ext', run('An extract, second line.')),
  para('txb2', run('[no ornament]')),
  para('p', run('After the break.')),
].join('')

async function makeDocx(dir) {
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${BODY}</w:body></w:document>`),
    'word/footnotes.xml': strToU8(`<?xml version="1.0"?><w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r>${run(' A note on the station.')}</w:p></w:footnote></w:footnotes>`),
  }
  const path = join(dir, 'Sample.docx')
  await writeFile(path, zipSync(files))
  return path
}

const dir = await mkdtemp(join(tmpdir(), 'book-core-test-'))
const docx = await makeDocx(dir)
// Most tests exercise a full house profile; without one (the public release) they are skipped.
// The house profile is named by BOOK_TEST_PROFILE (the private repository's package.json sets it).
const HOUSE = !!process.env.BOOK_TEST_PROFILE && listProfiles().includes(process.env.BOOK_TEST_PROFILE)
const profile = HOUSE ? loadProfile(process.env.BOOK_TEST_PROFILE) : loadProfile('basic')
const house = { skip: !HOUSE && 'needs a house profile' }

test('reads paragraphs, character styles and footnotes with their positions', async () => {
  const { paragraphs, stats } = readDocx(await readFile(docx))
  assert.equal(paragraphs.length, 13)
  assert.equal(stats.footnotes, 1)
  const p = paragraphs[7]
  const text = p.runs.map((r) => r.text).join('')
  assert.equal(text.slice(0, p.notes[0].offset), 'She met ケン at the station.')
  assert.equal(p.notes[0].paragraphs[0].runs.map((r) => r.text).join(''), 'A note on the station.')
  assert.equal(paragraphs[8].runs[1].cstyle, 'i')
})

test('resolves tags to house style names', house, async () => {
  const { topics } = resolve(readDocx(await readFile(docx)).paragraphs, profile)
  const chap = topics.find((t) => t.abbr === 'chap').items.map((it) => it.name)
  assert.deepEqual(chap, ['chap_num', 'chap_loc_first', 'chap_da_last', 'chap_pfada', 'chap_p', 'chap_ext_first', 'chap_ext_last', 'chap_txb2', 'chap_pat2'])
  assert.equal(topics.find((t) => t.abbr === 'chap').items.at(-2).runs.length, 0, 'the [no ornament] placeholder is emptied')
})

test('writes one ICML per topic, named A/B + ISBN + title, with a real footnote', house, async () => {
  const out = join(dir, 'icml')
  const b = await writeIcmlBook({ docx, out, profile })
  assert.equal(b.isbn, '9780000000002')
  const names = (await readdir(join(out, 'ICML'))).sort()
  assert.deepEqual(names, ['A001_9780000000002_CopyrightPage.icml', 'B001_9780000000002_Chapter1.icml'])
  const icml = await readFile(join(out, 'ICML', names[1]), 'utf8')
  assert.match(icml, /<Footnote>[\s\S]*<\?ACE 4\?>[\s\S]*A note on the station\./)
  assert.match(icml, /ParagraphStyle\/chap_pfada/)
})

test('a job opened from the tagged file reproduces it exactly', house, async () => {
  const { path } = await openJob({ docx, out: join(dir, 'job'), name: 'Sample' })
  const { job, raw } = await loadJob(path)
  const state = computeState(raw, job.rules)
  const names = (paras) => resolve(paras, profile).topics.flatMap((t) => t.items.map((it) => it.name))
  assert.deepEqual(names(taggedParagraphs(raw, state, profile)), names(readDocx(await readFile(docx)).paragraphs))
})

test('a blind job scores 100% when its rules match the editor', house, async () => {
  const { path } = await openJob({ docx, out: join(dir, 'blind'), name: 'Blind', ignoreTags: true })
  const { job, raw, key } = await loadJob(path)
  assert.ok(key, 'answer key kept aside')
  const rules = [
    { id: 'r1', kind: 'topic', topic: 'topic-cpy', where: { indices: [0] } },
    { id: 'r2', kind: 'topic', topic: 'topic-chap', where: { text: '^Chapter \\d+$' } },
    { id: 'r3', kind: 'tag', tag: 'cpy', where: { indices: [0] } },
    { id: 'r4', kind: 'tag', tag: 'isbn', where: { text: '^ISBN' } },
    { id: 'r5', kind: 'tag', tag: 'num', where: { text: '^Chapter \\d+$' } },
    { id: 'r6', kind: 'tag', tag: 'loc', where: { indices: [3] } },
    { id: 'r7', kind: 'tag', tag: 'da', where: { indices: [4] } },
    { id: 'r8', kind: 'tag', tag: 'ext', where: { text: '^An extract' } },
    { id: 'r9', kind: 'tag', tag: 'txb2', where: { text: '^(\\* ){2}\\*$' } },
  ]
  const s = scoreTags(key, predictions(computeState(raw, rules)))
  assert.equal(s.tagAccuracy, 1)
  assert.equal(s.topics.matched, 2)
})

test('language runs are styled automatically from their writing system', house, () => {
  const runs = styledRuns({ runs: [{ text: '[ケン]—こんにちは.', cstyle: null, fmt: {} }] }, [{ start: 0, end: 5, style: 'diaspk' }], profile)
  assert.deepEqual(runs.map((r) => [r.cstyle, r.text]), [['diaspk', '['], ['langjap', 'ケン'], ['diaspk', ']—'], ['langjap', 'こんにちは.']])
})

test('finds the print ISBN, not the e-book one', house, () => {
  const t = (abbr, text) => ({ abbr, items: [{ runs: [{ text }] }] })
  assert.equal(findIsbn([t('ecpy', 'Digital Edition ISBN: 978-0-00-000001-9'), t('cpy', 'ISBN 978-0-00-000000-2')], profile), '9780000000002')
})

test('writes an EPUB directly: one file per topic, real structure, notes and languages', house, async () => {
  const out = join(dir, 'Sample.epub')
  const r = await buildEpub({ docx, out, profile, validate: false, meta: { title: 'Sample', author: 'A. Writer', isbn: '978-0-00-000000-9' } })
  const f = unzipSync(new Uint8Array(await readFile(out)))
  assert.equal(strFromU8(f.mimetype), 'application/epub+zip')
  assert.equal(Object.keys(f)[0], 'mimetype', 'mimetype comes first')
  const pages = Object.keys(f).filter((n) => n.startsWith('OEBPS/xhtml/'))
  assert.equal(pages.length, 2)
  const chap = strFromU8(f[pages[1]])
  assert.match(chap, /<section epub:type="chapter" role="doc-chapter" aria-labelledby="[^"]+">\s*<h1 class="chap_num"/)
  assert.match(chap, /<blockquote>\s*<p class="chap_ext_first">/)
  assert.match(chap, /<hr class="chap_txb2"\/>/)
  assert.match(chap, /<a epub:type="noteref" role="doc-noteref" href="#fn1" id="fnref1">1<\/a>/)
  assert.match(chap, /<aside epub:type="footnote" role="doc-footnote" id="fn1">/)
  assert.match(chap, /lang="ja"/)
  const opf = strFromU8(f['OEBPS/content.opf'])
  assert.match(opf, /urn:isbn:9780000000009/)
  assert.equal(r.notes, 1)
})

test('a plain Word file with ordinary headings becomes a structured book (basic profile)', async () => {
  const styles = `<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style></w:styles>`
  const it = (t) => `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`
  const body = [para('Title', run('My Zine')), para('Heading1', run('One')), para('Normal', run('First paragraph with '), it('italics'), run('.')), para('Normal', run('')),
    para('Normal', run('Second paragraph.')), para('Normal', run('* * *')), para('Normal', run('After the break.')), para('Quote', run('A quoted line.')), para('Heading1', run('Two')), para('Normal', run('The end.'))].join('')
  const path = join(dir, 'Plain.docx')
  await writeFile(path, zipSync({ 'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`), 'word/styles.xml': strToU8(styles) }))
  const { path: jobPath, mapped } = await openJob({ docx: path, out: join(dir, 'plain'), name: 'Plain', profile: 'basic' })
  assert.equal(mapped, true)
  const { job, raw, profile: basic } = await loadJob(jobPath)
  assert.equal(raw.length, 9, 'the blank spacer paragraph is dropped')
  const out = join(dir, 'Plain.epub')
  await buildEpub({ paragraphs: taggedParagraphs(raw, computeState(raw, job.rules), basic), profile: basic, out, validate: false, meta: { title: 'My Zine' } })
  const f = unzipSync(new Uint8Array(await readFile(out)))
  const pages = Object.keys(f).filter((n) => n.startsWith('OEBPS/xhtml/')).map((n) => strFromU8(f[n]))
  assert.equal(pages.length, 3, 'title page + two chapters')
  assert.match(pages[1], /<h1 class="chap_chapter-title"[^>]*>One<\/h1>\s*<p class="chap_p-first">First paragraph with <i>italics<\/i>\.<\/p>/)
  assert.match(pages[1], /<hr class="chap_break"\/>\s*<p class="chap_p-first">After the break/)
  assert.match(pages[1], /<blockquote>\s*<p class="chap_quote_only">/)
})

test('imposition orders pages for folding', () => {
  assert.deepEqual(saddleStitch(8).sides.map((s) => s.pages), [[8, 1], [2, 7], [6, 3], [4, 5]])
  assert.deepEqual(saddleStitch(6).sides.map((s) => s.pages), [[null, 1], [2, null], [6, 3], [4, 5]])
  assert.deepEqual(miniZine(8).rows.map((r) => [r.rotate, ...r.pages]), [[180, 5, 4, 3, 2], [0, 6, 7, 8, 1]])
  assert.throws(() => miniZine(12))
})

test('an art log places notes at callouts and anchor phrases, and removes the callouts', house, async () => {
  const body = [
    para('topic-chap', run('Chapter 1')), para('num', run('Chapter 1')),
    para('p', run('The harbour at dawn was still.')),
    para('p', run('[Insert Fig. 1.1 here]')),
    para('p', run('Gulls rose over the water &lt;photo2.jpg&gt; and the boats went out.')),
    para('p', run('By noon the fog had lifted from the hills.')),
    para('p', run('Evening came slowly.')),
  ].join('')
  const path = join(dir, 'Art.docx')
  await writeFile(path, zipSync({ 'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`) }))
  const log = join(dir, 'artlog.csv')
  await writeFile(log, 'Fig,File Name,Caption,Credit,Alt Text,Size,Placement\n' +
    '1.1,harbour.tif,"The harbour, 1921",Town archive,Boats moored in a small harbour,half,\n' +
    'photo2,photo2.jpg,Gulls,,Gulls over water,column,\n' +
    '3,hills.jpg,The hills,,Hills under fog,quarter,after: fog had lifted from the hills\n' +
    '4,missing.jpg,Nowhere,,,,after: this phrase is not in the book\n')
  const { items, columns } = await readArtLog(log)
  assert.equal(items.length, 4)
  assert.equal(columns.alt, 'Alt Text')
  const { path: jp } = await openJob({ docx: path, out: join(dir, 'artjob'), name: 'Art' })
  const { job, raw } = await loadJob(jp)
  const state0 = computeState(raw, job.rules)
  const found = findArtPlaces(raw, items, { topics: state0.topic, titles: state0.topicTitle })
  assert.deepEqual(found.places.map((p) => [p.id, raw[p.index].text.slice(0, 12), p.offset]), [['1.1', 'Gulls rose o', 0], ['photo2', 'Gulls rose o', 26], ['3', 'Evening came', 0]])
  assert.deepEqual(found.unmatched.map((u) => u.id), ['4'])
  setArt(job, { items, ...found })
  const paras = taggedParagraphs(raw, computeState(raw, job.rules, job.art), profile)
  const texts = paras.map((p) => p.runs.map((r) => r.text).join(''))
  assert.ok(!texts.some((t) => /Insert Fig/.test(t)), 'callout line removed')
  assert.ok(texts.includes('Gulls rose over the water and the boats went out.'), 'inline callout cut')
  const b = await writeIcmlBook({ paragraphs: paras, out: join(dir, 'articml'), profile, book: 'Art' })
  const icml = await readFile(b.files[0].path, 'utf8')
  const notes = [...icml.matchAll(/<Note [^>]*>([\s\S]*?)<\/Note>/g)].map((m) => m[1].replace(/<Br\/>/g, '\n').replace(/<[^>]+>/g, ''))
  assert.equal(notes.length, 3)
  assert.deepEqual(parseArtNote(notes[0]), { id: '1.1', file: 'harbour.tif', size: 'half', caption: 'The harbour, 1921', credit: 'Town archive', alt: 'Boats moored in a small harbour' })
  assert.match(icml, /Gulls rose over the water <\/Content><\/CharacterStyleRange>\s*<CharacterStyleRange[^>]*><Note /)
})

test('art placed by the log becomes figures in the EPUB, with captions and alt text', house, async () => {
  // Reuses the art job from the art-log test above.
  const { job, raw } = await loadJob(join(dir, 'artjob', 'Art.job.json'))
  const { items } = await readArtLog(join(dir, 'artlog.csv'))
  const state0 = computeState(raw, job.rules)
  setArt(job, { items, ...findArtPlaces(raw, items, { topics: state0.topic, titles: state0.topicTitle }) })
  const images = join(dir, 'images')
  await (await import('node:fs/promises')).mkdir(images, { recursive: true })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  await writeFile(join(images, 'photo2.jpg'), png) // tiny stand-in; only its presence matters here
  await writeFile(join(images, 'hills.jpg'), png)
  const out = join(dir, 'Art.epub')
  const r = await buildEpub({ paragraphs: taggedParagraphs(raw, computeState(raw, job.rules, job.art), profile), profile, out, images, validate: false, meta: { title: 'Art' } })
  assert.equal(r.figures, 2)
  assert.ok(r.warnings.some((w) => /harbour\.tif/.test(w)), 'the missing image is reported')
  const f = unzipSync(new Uint8Array(await readFile(out)))
  const html = strFromU8(f[Object.keys(f).find((n) => n.startsWith('OEBPS/xhtml/'))])
  assert.match(html, /<figure class="art" style="width:25%"><img src="\.\.\/images\/fig-hills\.jpg" alt="Hills under fog"\/><figcaption class="chap_cap">The hills<\/figcaption><\/figure>/)
  assert.ok(f['OEBPS/images/fig-photo2.jpg'])
  assert.match(strFromU8(f['OEBPS/content.opf']), /href="images\/fig-hills\.jpg" media-type="image\/jpeg"/)
})
