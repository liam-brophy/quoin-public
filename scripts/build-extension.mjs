#!/usr/bin/env node
// Build Quoin as a one-click Claude Desktop extension (.mcpb).
// usage: node scripts/build-extension.mjs [--out dist/quoin-<version>.mcpb]
//
// The bundle is self-contained: Claude Desktop ships its own Node.js, so users install nothing else.
// Only public files go in: the built-in Basic profile (never a house profile), an empty designer-script
// registry, the server, the workflow guide and the licence.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MCPB = '@anthropic-ai/mcpb@2.1.2'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'))
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const outArg = process.argv.indexOf('--out')
const out = resolve(outArg > 0 ? process.argv[outArg + 1] : join(root, 'dist', `quoin-${plugin.version}.mcpb`))
const REPO = 'https://github.com/liam-brophy/quoin-public'

const stage = mkdtempSync(join(tmpdir(), 'quoin-mcpb-'))
const copy = (from, to = from) => cpSync(join(root, from), join(stage, to), { recursive: true })
try {
  // 1. Public files only.
  for (const f of ['server', 'skills', 'LICENSE', 'NOTICE', 'PRIVACY.md', 'README.md']) copy(f)
  copy('extension/icon.png', 'icon.png')
  for (const f of ['src', 'bin', 'package.json', 'README.md']) copy(join('packages/core', f))
  mkdirSync(join(stage, 'packages/core/profiles'), { recursive: true })
  copy('packages/core/profiles/basic.json')
  mkdirSync(join(stage, 'designer-scripts'), { recursive: true })
  copy('designer-scripts/README.md')
  writeFileSync(join(stage, 'designer-scripts/registry.json'), JSON.stringify({
    '//': 'Built-in scripts: none. Register your own in ~/.quoin/scripts/registry.json (see README.md here).', scripts: [] }, null, 2) + '\n')
  rmSync(join(stage, 'server/launch.mjs'), { force: true }) // dependencies are bundled; no first-run install

  // 2. Dependencies as real files (book-core is a workspace symlink in development).
  const deps = { ...rootPkg.dependencies, 'book-core': 'file:./packages/core' }
  writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'quoin', version: plugin.version, private: true, type: 'module', license: 'Apache-2.0', dependencies: deps }, null, 2) + '\n')
  execFileSync('npm', ['install', '--omit=dev', '--install-links', '--no-package-lock', '--no-fund', '--no-audit', '--loglevel=error'], { cwd: stage, stdio: 'inherit' })

  // 3. Never a house profile, whatever the source tree holds.
  const profiles = [join(stage, 'packages/core/profiles'), join(stage, 'node_modules/book-core/profiles')].filter(existsSync)
  for (const dir of profiles) for (const f of readdirSync(dir)) if (f !== 'basic.json') rmSync(join(dir, f), { recursive: true })

  // 4. The tool list, read from the server itself.
  const { Client } = await import(pathToFileURL(join(stage, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')).href)
  const { StdioClientTransport } = await import(pathToFileURL(join(stage, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')).href)
  const client = new Client({ name: 'build', version: '0' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(stage, 'server/index.mjs')], cwd: stage }))
  const tools = (await client.listTools()).tools.map((t) => ({ name: t.name, description: (t.title ? `${t.title}. ` : '') + t.description.split(/(?<=\.)\s/)[0] }))
  await client.close()

  // 5. The manifest.
  const manifest = {
    manifest_version: '0.4',
    name: 'quoin',
    display_name: 'Quoin',
    version: plugin.version,
    description: 'From manuscript to finished book in Adobe InDesign: structure text, flow it into your template, place art, make zines, and export accessible EPUBs.',
    long_description: [
      'Quoin takes the repeatable work out of making books, zines and EPUBs in Adobe InDesign, and leaves every design decision with you.',
      'Ask Claude to structure a manuscript, flow it into a copy of your template, place art from an art log, hit a page count, check a book for the printer and package it, or write a validated, accessible EPUB 3.',
      'Anything that changes a document is previewed first, and Quoin never saves your files.',
      'Needs Adobe InDesign 2024 or later on a Mac (Windows is planned). The first time it talks to InDesign, macOS asks whether Claude may control it: allow it.',
      'An independent project; not made or endorsed by Adobe. Adobe and InDesign are trademarks of Adobe Inc.',
    ].join('\n\n'),
    author: { name: plugin.author.name, url: REPO },
    repository: { type: 'git', url: `${REPO}.git` },
    homepage: REPO,
    documentation: `${REPO}#readme`,
    support: `${REPO}/issues`,
    icon: 'icon.png',
    server: {
      type: 'node',
      entry_point: 'server/index.mjs',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/index.mjs'],
        env: {
          INDESIGN_APP: '${user_config.indesign_app}',
          BOOK_PROFILES_DIR: '${user_config.profiles_dir}',
          QUOIN_SCRIPTS_DIR: '${user_config.scripts_dir}',
        },
      },
    },
    tools,
    tools_generated: false,
    keywords: plugin.keywords,
    license: 'Apache-2.0',
    privacy_policies: [`${REPO}/blob/main/PRIVACY.md`],
    compatibility: { platforms: ['darwin'], runtimes: { node: '>=20.0.0' } },
    user_config: {
      profiles_dir: { type: 'directory', title: 'Tag profiles folder', description: 'Optional. A folder holding your house tag profile (see docs/PROFILES.md). Leave empty to use ~/.book-core/profiles or the built-in Basic profile.', required: false, default: '' },
      scripts_dir: { type: 'directory', title: 'Your InDesign scripts folder', description: 'Optional. A folder with your own scripts and a registry.json (see designer-scripts/README.md). Leave empty to use ~/.quoin/scripts.', required: false, default: '' },
      indesign_app: { type: 'string', title: 'InDesign application name', description: 'Optional. Only if you have several versions installed, e.g. "Adobe InDesign 2025". Leave empty to use the newest.', required: false, default: '' },
    },
  }
  writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  // 6. Validate and pack with Anthropic's tool.
  mkdirSync(dirname(out), { recursive: true })
  execFileSync('npx', ['-y', MCPB, 'validate', join(stage, 'manifest.json')], { stdio: 'inherit' })
  execFileSync('npx', ['-y', MCPB, 'pack', stage, out], { stdio: 'inherit' })
  console.log(JSON.stringify({ out, version: plugin.version, tools: tools.length, stage: process.argv.includes('--keep') ? stage : undefined }))
} finally {
  if (!process.argv.includes('--keep')) rmSync(stage, { recursive: true, force: true })
}
