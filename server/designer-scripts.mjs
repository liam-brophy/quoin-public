// Run a designer's own ExtendScript (from their Scripts panel) without its dialogs.
// The script's text is wrapped in a function whose parameters are named alert,
// confirm and prompt, so its messages become the report and its questions get
// answers chosen in advance. The file on disk is never changed.
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runJsx } from './bridge.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** Folders holding a registry.json, first wins on a repeated id: $QUOIN_SCRIPTS_DIR, ~/.quoin/scripts, built-in. */
export function scriptDirs() {
  return [process.env.QUOIN_SCRIPTS_DIR, join(homedir(), '.quoin', 'scripts'), join(here, '..', 'designer-scripts')]
    .filter((d) => d && existsSync(join(d, 'registry.json')))
}

/** Every registered script, with `folder` set to the folder its files are found in. */
export async function registry() {
  const seen = new Map()
  for (const dir of scriptDirs()) {
    const { scripts = [] } = JSON.parse(await readFile(join(dir, 'registry.json'), 'utf8'))
    for (const s of scripts) if (!seen.has(s.id)) seen.set(s.id, { ...s, folder: dir })
  }
  return [...seen.values()]
}

const inFolder = (entry, f) => (isAbsolute(f) ? f : join(entry.folder, f))

/** ExtendScript source ready to embed: no BOM, LF line ends, preprocessor lines (#target…) removed. */
function prepare(src) {
  return src.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
    .split('\n').map((l) => (/^\s*#(target|targetengine|strict|script|include)\b/.test(l) ? `// ${l}` : l)).join('\n')
}

/**
 * @param {{ id: string, document?: string, settings?: object, dryRun?: boolean, answers?: boolean[], undoName?: string }} o
 *   document: path of an .indd to open (with a window) and make active; omit to use the active document.
 */
export async function runDesignerScript(o) {
  const list = await registry()
  const entry = list.find((s) => s.id === o.id)
  if (!entry) throw new Error(list.length ? `No script "${o.id}" in the registry. Known: ${list.map((s) => s.id).join(', ')}` : 'No designer scripts are registered. See designer-scripts/README.md.')
  if (o.dryRun && !entry.dryRun) throw new Error(`${entry.id} has no dry run. Use preview: ${entry.preview ? 'yes, run with preview: true' : 'none — ask the designer before running it'}.`)
  const file = inFolder(entry, entry.file)
  const source = prepare(await readFile(file, 'utf8'))
  const body = `
var H = { settings: ARGS.settings || null, dryRun: !!ARGS.dryRun, alerts: [], confirms: [], result: null };
if (ARGS.document) {
  var f = new File(ARGS.document), d = null;
  for (var i = 0; i < app.documents.length; i++) if (app.documents[i].fullName && app.documents[i].fullName.fsName === f.fsName) d = app.documents[i];
  if (!d) d = app.open(f, true);
  app.activeDocument = d;
}
if (!app.documents.length) throw Error('No document is open.');
var answers = ARGS.answers || [];
$.global.__HEADLESS__ = H;
// Designer scripts expect to talk to a person: let them, and record what they say.
app.scriptPreferences.userInteractionLevel = UserInteractionLevels.INTERACT_WITH_ALL;
try {
  (function (alert, confirm, prompt) {
${source}
  })(
    function (m) { H.alerts.push(String(m)); },
    function (m) { var a = answers.length ? !!answers.shift() : false; H.confirms.push({ message: String(m), answer: a }); return a; },
    function (m) { H.alerts.push('prompt (answered nothing): ' + m); return null; }
  );
} finally {
  delete $.global.__HEADLESS__;
}
return { document: app.activeDocument.name, alerts: H.alerts, confirms: H.confirms, result: H.result };`
  const reply = await runJsx(body, { document: o.document, settings: o.settings, dryRun: !!o.dryRun, answers: o.answers },
    { undoName: o.dryRun ? undefined : (o.undoName ?? entry.name), timeoutMs: 15 * 60_000 })
  return { script: entry.name, dryRun: !!o.dryRun, ...reply }
}

/** A read-only preview the plugin provides for a script that has no dry run of its own. */
export async function previewDesignerScript(o) {
  const entry = (await registry()).find((s) => s.id === o.id)
  if (!entry?.preview) throw new Error(`${o.id} has no preview.`)
  const preview = await readFile(inFolder(entry, entry.preview), 'utf8')
  // Open (or find) the document by path, then let __doc() find it by name.
  const body = `if (ARGS.path) {
  var f = new File(ARGS.path), d = null;
  for (var i = 0; i < app.documents.length; i++) if (app.documents[i].fullName && app.documents[i].fullName.fsName === f.fsName) d = app.documents[i];
  if (!d) d = app.open(f, true);
  ARGS.document = d.name;
}
${preview}`
  return { script: entry.name, preview: true, ...(await runJsx(body, { path: o.document, settings: o.settings })) }
}
