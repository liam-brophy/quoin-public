// Loads a tag profile: generated <name>.json merged with hand-kept <name>.extra.json.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUILT_IN = join(dirname(fileURLToPath(import.meta.url)), '..', 'profiles')

/**
 * Where profiles are looked for, in order: $BOOK_PROFILES_DIR, ~/.book-core/profiles (a publisher's own,
 * private tag libraries live in either, outside this package), then the built-in ones.
 */
export function profileDirs() {
  return [process.env.BOOK_PROFILES_DIR, join(homedir(), '.book-core', 'profiles'), BUILT_IN].filter((d) => d && existsSync(d))
}

/** Names of the profiles available, private ones first. */
export function listProfiles() {
  const seen = new Set()
  for (const d of profileDirs()) for (const f of readdirSync(d)) if (f.endsWith('.json') && !f.endsWith('.extra.json')) seen.add(f.replace(/\.json$/, ''))
  return [...seen]
}

/** $BOOK_PROFILE, else the first private profile, else the built-in "basic". */
export function defaultProfile() {
  if (process.env.BOOK_PROFILE) return process.env.BOOK_PROFILE
  const all = listProfiles()
  return all.find((n) => n !== 'basic') ?? 'basic'
}

export function loadProfile(nameOrPath = defaultProfile()) {
  let base = nameOrPath
  if (!nameOrPath.endsWith('.json')) {
    const dir = profileDirs().find((d) => existsSync(join(d, `${nameOrPath}.json`)))
    if (!dir) throw new Error(`No tag profile named "${nameOrPath}". Available: ${listProfiles().join(', ')}. Put your own in ~/.book-core/profiles.`)
    base = join(dir, `${nameOrPath}.json`)
  }
  const profile = JSON.parse(readFileSync(base, 'utf8'))
  const extraPath = base.replace(/\.json$/, '.extra.json')
  if (existsSync(extraPath)) {
    const extra = JSON.parse(readFileSync(extraPath, 'utf8'))
    for (const [k, v] of Object.entries(extra)) {
      if (k.startsWith('//')) continue
      if (k === 'paragraph' || k === 'character' || k === 'topics') {
        profile[k] ??= {}
        for (const [style, entry] of Object.entries(v)) profile[k][style] = { ...profile[k][style], ...entry }
      } else profile[k] = v
    }
  }
  profile.contextual ??= {}
  profile.placeholders ??= []
  profile.fallbackParents ??= {}
  profile.pagination ??= { default: 'any' }
  profile.printExclude ??= []
  profile.fallbackTopic ??= 'chap'
  return profile
}
