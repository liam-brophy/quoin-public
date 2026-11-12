// End-to-end check: starts the MCP server over stdio, makes a scratch document in
// InDesign, calls every read tool and an IDML export, then closes the scratch doc unsaved.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const client = new Client({ name: 'smoke', version: '0' })
await client.connect(new StdioClientTransport({ command: 'node', args: ['server/index.mjs'], stderr: 'inherit' }))

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args })
  const text = r.content[0].text
  if (r.isError) throw new Error(`${name}: ${text}`)
  return JSON.parse(text)
}

const tools = (await client.listTools()).tools.map((t) => t.name)
console.log('tools:', tools.join(', '))
console.log('status:', await call('indesign_status'))

const made = await call('indesign_run_script', {
  undoName: 'Smoke test',
  code: `
    var d = app.documents.add(false);
    d.documentPreferences.pageWidth = 360; d.documentPreferences.pageHeight = 540;
    var body = d.paragraphStyles.add({ name: 'Smoke Body', pointSize: 10.5, leading: 14.5, firstLineIndent: 12, spaceAfter: 0 });
    var head = d.paragraphStyles.add({ name: 'Smoke Heading', pointSize: 18, leading: 22, fontStyle: 'Bold' });
    var f = d.pages[0].textFrames.add({ geometricBounds: [36, 36, 504, 324], contents: 'Chapter One\\rIt was a calm morning.' });
    f.paragraphs[0].appliedParagraphStyle = head; f.paragraphs[1].appliedParagraphStyle = body;
    return { name: d.name };`,
})
const document = made.name
try {
  const insp = await call('indesign_inspect_document', { document })
  console.log('inspect:', { pages: insp.pages, pageSize: insp.pageSize, overset: insp.oversetStories.length })
  const styles = await call('indesign_list_styles', { document, kind: 'paragraph', names: ['Smoke Body'] })
  console.log('styles:', styles.paragraph[0])
  const out = join(await mkdtemp(join(tmpdir(), 'indesign-smoke-')), 'smoke.idml')
  console.log('export:', await call('indesign_export', { document, format: 'idml', path: out }))
  try {
    console.log('typestory:', await call('indesign_typestory_pairing', { document, bodyStyle: 'Smoke Body', headingStyle: 'Smoke Heading' }))
  } catch (e) {
    console.log('typestory: not ready —', e.message.slice(0, 200))
  }
} finally {
  await call('indesign_run_script', { args: { document }, code: '__doc().close(SaveOptions.NO); return true;' })
  await client.close()
}
console.log('smoke: ok')
