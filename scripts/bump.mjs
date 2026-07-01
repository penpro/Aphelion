#!/usr/bin/env node
// Single source of truth for version bumps. Writes the new version into all five files that must
// stay in lockstep (package.json, package-lock.json ×2 entries, tauri.conf.json, Cargo.toml,
// Cargo.lock) so cutting a release is one command instead of six hand-edits that are easy to miss.
//
//   npm run bump 0.1.38      # explicit version
//   npm run bump patch       # 0.1.37 -> 0.1.38   (default)
//   npm run bump minor       # 0.1.37 -> 0.2.0
//   npm run bump major       # 0.1.37 -> 1.0.0
//
// Each replacement is anchored so a dependency that happens to share the version string is never
// touched. Prints which files changed; exits non-zero if any file didn't contain the old version.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fe = join(root, 'frontend')
const tauri = join(fe, 'src-tauri')

const pkgPath = join(fe, 'package.json')
const current = JSON.parse(readFileSync(pkgPath, 'utf8')).version
if (!/^\d+\.\d+\.\d+$/.test(current || '')) {
  console.error(`Can't read a valid current version from package.json (got "${current}").`)
  process.exit(1)
}

const arg = process.argv[2] || 'patch'
let next
if (/^\d+\.\d+\.\d+$/.test(arg)) {
  next = arg
} else if (arg === 'patch' || arg === 'minor' || arg === 'major') {
  const [maj, min, pat] = current.split('.').map(Number)
  next = arg === 'major' ? `${maj + 1}.0.0` : arg === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`
} else {
  console.error(`Usage: npm run bump <x.y.z | patch | minor | major>  (got "${arg}")`)
  process.exit(1)
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// [file, [from, to]...] — `from` is a RegExp (anchored) or exact string.
const edits = [
  [pkgPath, [[`"version": "${current}"`, `"version": "${next}"`]]],
  // both the root and the packages."" entry, keyed off the name line that precedes each.
  [
    join(fe, 'package-lock.json'),
    [[new RegExp(`("name": "localllm-roleplay-studio",\\s*"version": ")${esc(current)}(")`, 'g'), `$1${next}$2`]],
  ],
  [join(tauri, 'tauri.conf.json'), [[`"version": "${current}"`, `"version": "${next}"`]]],
  [join(tauri, 'Cargo.toml'), [[new RegExp(`(name = "app"\\r?\\nversion = ")${esc(current)}(")`), `$1${next}$2`]]],
  [join(tauri, 'Cargo.lock'), [[new RegExp(`(name = "app"\\r?\\nversion = ")${esc(current)}(")`), `$1${next}$2`]]],
]

let failed = false
for (const [file, swaps] of edits) {
  const before = readFileSync(file, 'utf8')
  let text = before
  for (const [from, to] of swaps) {
    text = typeof from === 'string' ? text.split(from).join(to) : text.replace(from, to)
  }
  if (text === before) {
    console.error(`  ✗ ${file} — no "${current}" found to replace`)
    failed = true
  } else {
    writeFileSync(file, text)
    console.log(`  ✓ ${file.replace(root, '.')}`)
  }
}

if (failed) {
  console.error('\nSome files were not updated — check them by hand.')
  process.exit(1)
}
console.log(`\nBumped ${current} → ${next}. Next: cargo check, commit, tag v${next}, push.`)
