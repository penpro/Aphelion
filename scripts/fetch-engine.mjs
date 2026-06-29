#!/usr/bin/env node
// Fetches the bundled engines for the CURRENT OS/arch into frontend/src-tauri/bin:
//   bin/llama  — llama.cpp inference (Vulkan on Windows/Linux, Metal on macOS)
//   bin/typst  — Typst CLI (compiles generated documents to PDF)
// Cross-platform (Win/macOS/Linux); run once after cloning, before building:
//   node scripts/fetch-engine.mjs        (or: npm run fetch-engine)
import { existsSync, mkdirSync, readdirSync, statSync, cpSync, chmodSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const binRoot = join(here, '..', 'frontend', 'src-tauri', 'bin')
const platform = process.platform // 'win32' | 'darwin' | 'linux'
const arch = process.arch // 'x64' | 'arm64'
const winExe = platform === 'win32' ? '.exe' : ''

const LLAMA_TAG = 'b9829'
const TYPST_TAG = 'v0.15.0'

function llamaAsset() {
  if (platform === 'win32') return arch === 'arm64' ? `llama-${LLAMA_TAG}-bin-win-cpu-arm64.zip` : `llama-${LLAMA_TAG}-bin-win-vulkan-x64.zip`
  if (platform === 'darwin') return arch === 'arm64' ? `llama-${LLAMA_TAG}-bin-macos-arm64.tar.gz` : `llama-${LLAMA_TAG}-bin-macos-x64.tar.gz`
  if (platform === 'linux') return arch === 'arm64' ? `llama-${LLAMA_TAG}-bin-ubuntu-vulkan-arm64.tar.gz` : `llama-${LLAMA_TAG}-bin-ubuntu-vulkan-x64.tar.gz`
  throw new Error(`unsupported platform: ${platform}`)
}

function typstAsset() {
  const triple = {
    'win32-x64': 'x86_64-pc-windows-msvc',
    'win32-arm64': 'aarch64-pc-windows-msvc',
    'darwin-x64': 'x86_64-apple-darwin',
    'darwin-arm64': 'aarch64-apple-darwin',
    'linux-x64': 'x86_64-unknown-linux-musl',
    'linux-arm64': 'aarch64-unknown-linux-musl',
  }[`${platform}-${arch}`]
  if (!triple) throw new Error(`unsupported platform: ${platform}-${arch}`)
  return `typst-${triple}.${platform === 'win32' ? 'zip' : 'tar.xz'}`
}

function findBin(root, exe) {
  for (const e of readdirSync(root)) {
    const p = join(root, e)
    const s = statSync(p)
    if (s.isFile() && e === exe) return root
    if (s.isDirectory()) {
      const f = findBin(p, exe)
      if (f) return f
    }
  }
  return null
}

async function fetchTool(label, destName, exe, url) {
  const dest = join(binRoot, destName)
  if (existsSync(join(dest, exe))) {
    console.log(`${label} already present at ${dest} — skipping.`)
    return
  }
  const tmp = join(tmpdir(), `aphelion-${destName}-${platform}-${arch}`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const archive = join(tmp, url.split('/').pop())
  console.log(`Downloading ${label} (${url.split('/').pop()}) ...`)
  const res = await fetch(url) // follows redirects to the release CDN
  if (!res.ok) throw new Error(`${label} download failed: HTTP ${res.status} for ${url}`)
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()))
  console.log(`Extracting ${label} ...`)
  // bsdtar (Win10+/macOS) and GNU tar (Linux, with xz-utils) handle .zip/.tar.gz/.tar.xz with -xf.
  const ex = spawnSync('tar', ['-xf', archive, '-C', tmp], { stdio: 'inherit' })
  if (ex.status !== 0) throw new Error(`${label}: extraction failed — 'tar' is required`)
  const dir = findBin(tmp, exe)
  if (!dir) throw new Error(`${label}: '${exe}' not found inside the archive`)
  mkdirSync(dest, { recursive: true })
  cpSync(dir, dest, { recursive: true, dereference: true }) // deref: versioned .so/.dylib symlinks
  if (platform !== 'win32') chmodSync(join(dest, exe), 0o755)
  rmSync(tmp, { recursive: true, force: true })
  if (!existsSync(join(dest, exe))) throw new Error(`${label}: '${exe}' missing after extraction`)
  console.log(`${label} ready at ${dest}`)
}

const gh = 'https://github.com'
await fetchTool('llama.cpp', 'llama', `llama-server${winExe}`, `${gh}/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/${llamaAsset()}`)
await fetchTool('Typst', 'typst', `typst${winExe}`, `${gh}/typst/typst/releases/download/${TYPST_TAG}/${typstAsset()}`)
