#!/usr/bin/env node
// Fetches the bundled llama.cpp engine for the CURRENT OS/arch into
// frontend/src-tauri/bin/llama (git-ignored, ~90 MB). Cross-platform — run once
// after cloning, before building:  node scripts/fetch-engine.mjs  (or: npm run fetch-engine)
//
// Backends: Vulkan on Windows/Linux (any GPU vendor), Metal on macOS (Apple Silicon).
import { existsSync, mkdirSync, readdirSync, statSync, cpSync, chmodSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const TAG = 'b9829' // pinned llama.cpp release for reproducible builds
const here = dirname(fileURLToPath(import.meta.url))
const dest = join(here, '..', 'frontend', 'src-tauri', 'bin', 'llama')
const platform = process.platform // 'win32' | 'darwin' | 'linux'
const arch = process.arch // 'x64' | 'arm64'
const exe = platform === 'win32' ? 'llama-server.exe' : 'llama-server'

function assetName() {
  if (platform === 'win32') return arch === 'arm64' ? `llama-${TAG}-bin-win-cpu-arm64.zip` : `llama-${TAG}-bin-win-vulkan-x64.zip`
  if (platform === 'darwin') return arch === 'arm64' ? `llama-${TAG}-bin-macos-arm64.tar.gz` : `llama-${TAG}-bin-macos-x64.tar.gz`
  if (platform === 'linux') return arch === 'arm64' ? `llama-${TAG}-bin-ubuntu-vulkan-arm64.tar.gz` : `llama-${TAG}-bin-ubuntu-vulkan-x64.tar.gz`
  throw new Error(`unsupported platform: ${platform}`)
}

function findEngineDir(root) {
  for (const e of readdirSync(root)) {
    const p = join(root, e)
    const s = statSync(p)
    if (s.isFile() && e === exe) return root
    if (s.isDirectory()) {
      const found = findEngineDir(p)
      if (found) return found
    }
  }
  return null
}

if (existsSync(join(dest, exe))) {
  console.log(`Engine already present at ${dest} — nothing to do.`)
  process.exit(0)
}

const asset = assetName()
const url = `https://github.com/ggml-org/llama.cpp/releases/download/${TAG}/${asset}`
const tmp = join(tmpdir(), `aphelion-engine-${platform}-${arch}`)
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })
const archive = join(tmp, asset)

console.log(`Downloading ${asset} ...`)
const res = await fetch(url) // follows redirects to the release CDN
if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${url}`)
writeFileSync(archive, Buffer.from(await res.arrayBuffer()))

console.log('Extracting ...')
// bsdtar (Win10+/macOS) and GNU tar (Linux) both handle .zip and .tar.gz with -xf.
const ex = spawnSync('tar', ['-xf', archive, '-C', tmp], { stdio: 'inherit' })
if (ex.status !== 0) throw new Error('extraction failed — `tar` is required (ships with Win10+/macOS/Linux)')

const engineDir = findEngineDir(tmp)
if (!engineDir) throw new Error(`could not find ${exe} inside ${asset}`)

mkdirSync(dest, { recursive: true })
cpSync(engineDir, dest, { recursive: true })
if (platform !== 'win32') chmodSync(join(dest, exe), 0o755)
rmSync(tmp, { recursive: true, force: true })

if (!existsSync(join(dest, exe))) throw new Error('engine missing after extraction')
console.log(`Engine ready at ${dest}`)
