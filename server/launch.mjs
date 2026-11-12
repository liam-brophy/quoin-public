#!/usr/bin/env node
// Starts the MCP server; on the first run after the plugin is installed, fetches its dependencies.
// Nothing may be written to stdout before the server starts (it is the MCP channel), so npm reports to stderr.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(root, 'node_modules', '@modelcontextprotocol', 'sdk')) || !existsSync(join(root, 'node_modules', 'book-core'))) {
  console.error('[quoin] first run: installing dependencies…')
  try {
    execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] })
  } catch (e) {
    console.error(`[quoin] could not install dependencies (${e.message}). Run "npm install" in ${root}.`)
    process.exit(1)
  }
}
await import('./index.mjs')
