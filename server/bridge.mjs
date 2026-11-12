// Runs ExtendScript inside a desktop InDesign via AppleScript `do script`.
import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const JSX_DIR = join(here, 'jsx')

/** $INDESIGN_APP, else the newest "Adobe InDesign 20xx" in /Applications. */
function findInDesign() {
  if (process.env.INDESIGN_APP) return process.env.INDESIGN_APP
  try {
    const found = readdirSync('/Applications').filter((n) => /^Adobe InDesign \d{4}$/.test(n)).sort()
    if (found.length) return found.at(-1)
  } catch { /* not macOS, or unreadable */ }
  return 'Adobe InDesign 2026'
}
export const APP = findInDesign()

let prelude
async function getPrelude() {
  prelude ??= await readFile(join(JSX_DIR, 'prelude.jsx'), 'utf8')
  return prelude
}

/** Load a bundled script body from server/jsx/<name>.jsx. */
export async function script(name) {
  return readFile(join(JSX_DIR, `${name}.jsx`), 'utf8')
}

export class InDesignError extends Error {
  constructor(message, detail = {}) {
    super(message)
    this.detail = detail
  }
}

/**
 * Run a script body inside InDesign. The body is a function body: use `return`
 * to hand plain data back. `ARGS` holds `args`. Units are points.
 *
 * @param {string} body
 * @param {object} [args]
 * @param {{ undoName?: string, timeoutMs?: number }} [opts]
 *   undoName: run as a single undo step with this name (for scripts that edit).
 */
export async function runJsx(body, args = {}, { undoName, timeoutMs = 180_000 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'indesign-mcp-'))
  const file = join(dir, 'script.jsx')
  const src = `${await getPrelude()}\nvar ARGS = ${JSON.stringify(args)};\n__run(function () {\n${body}\n});\n`
  await writeFile(file, src, 'utf8')

  const undo = undoName
    ? ` undo mode entire script undo name ${appleString(undoName)}`
    : ` undo mode fast entire script`
  const lines = [
    'on run argv',
    // Resolve the file outside `tell`, or `POSIX file` is sent to InDesign as a message.
    '  set f to (POSIX file (item 1 of argv)) as alias',
    `  tell application ${appleString(APP)}`,
    `    set r to do script f language javascript${undo}`,
    '  end tell',
    '  return r',
    'end run',
  ]
  try {
    const { stdout } = await exec('osascript', [...lines.flatMap((l) => ['-e', l]), file], {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    })
    return parse(stdout)
  } catch (err) {
    if (err instanceof InDesignError) throw err
    throw new InDesignError(explainOsascript(err), { stderr: err.stderr?.trim() })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function parse(stdout) {
  const text = stdout.trim()
  let reply
  try {
    reply = JSON.parse(text)
  } catch {
    throw new InDesignError('InDesign returned something that is not JSON.', { output: text.slice(0, 2000) })
  }
  if (!reply.ok) {
    throw new InDesignError(`InDesign script error: ${reply.error}`, { line: reply.line, number: reply.number })
  }
  return reply.result
}

function explainOsascript(err) {
  const stderr = String(err.stderr || '')
  if (err.killed) return 'InDesign did not answer in time (is a modal dialog open?).'
  if (/modal dialog or alert is active|30486/.test(stderr))
    return 'InDesign refused the request as "modal dialog or alert is active". Sometimes a dialog really is open; often none is, and InDesign\'s scripting is stuck after an earlier script (even Quit is refused then). ' +
      'Ask the designer to look for a dialog first; if there is none, InDesign needs a Force Quit (⌥⌘Esc) and relaunch.'
  if (/-1743|Not authorized/i.test(stderr))
    return 'macOS blocked automation. Allow it in System Settings → Privacy & Security → Automation for the app running Claude (Claude, or your terminal for Claude Code).'
  if (/-1728|Can.t get application|-10814/i.test(stderr))
    return `Could not find "${APP}". Set the InDesign application name to the app's exact name (Claude Desktop: Settings › Extensions › Quoin; Claude Code: INDESIGN_APP in .mcp.json).`
  return `osascript failed: ${stderr.trim() || err.message}`
}

function appleString(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
