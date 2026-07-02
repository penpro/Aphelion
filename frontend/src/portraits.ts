import { convertFileSrc } from '@tauri-apps/api/core'
import { savePortrait, readImageData, deletePortrait } from './tauri'
import { uid } from './util'
import type { Character, EmotionKey } from './types'

// Character portraits used to live in the store as base64 data-URLs, which bloated localStorage
// past its ~5MB quota. Now uploads are written to disk (Rust `save_portrait`) and the store holds
// a small 'disk:<path>' reference, read back through the asset protocol.
const DISK_PREFIX = 'disk:'

/** Persist a portrait data-URL to disk; returns a store-safe ref ('disk:<path>').
 *  Falls back to the inline data-URL in the browser dev build, or if the write fails — so a
 *  portrait always keeps working, just un-offloaded. */
export async function persistPortrait(dataUrl: string): Promise<string> {
  try {
    const path = await savePortrait(uid(), dataUrl)
    return DISK_PREFIX + path
  } catch {
    return dataUrl
  }
}

/** Resolve a stored portrait value to an <img> src. Disk refs go through the asset protocol;
 *  data-URLs, bundled asset imports (Seraphina), and http(s) URLs pass through unchanged. */
export function portraitSrc(value?: string): string | undefined {
  if (!value) return value
  return value.startsWith(DISK_PREFIX) ? convertFileSrc(value.slice(DISK_PREFIX.length)) : value
}

export const isDataUrl = (v?: string): boolean => !!v && v.startsWith('data:')
export const isDiskRef = (v?: string): boolean => !!v && v.startsWith(DISK_PREFIX)
/** The raw path inside a 'disk:' ref (for delete_portrait). */
export const diskPath = (v: string): string => (v.startsWith(DISK_PREFIX) ? v.slice(DISK_PREFIX.length) : v)

/** Resolve any stored portrait value to a base64 data-URL (what the vision model needs). Disk refs
 *  are read via Rust; data-URLs pass through; bundled-asset/http srcs are fetched and inlined.
 *  Returns '' if it can't be read. */
export async function portraitDataUrl(value?: string): Promise<string> {
  if (!value) return ''
  if (isDataUrl(value)) return value
  if (isDiskRef(value)) {
    const path = diskPath(value)
    const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    try {
      return await readImageData(i >= 0 ? path.slice(0, i) : '', i >= 0 ? path.slice(i + 1) : path)
    } catch {
      return ''
    }
  }
  try {
    const resp = await fetch(portraitSrc(value) || value)
    const blob = await resp.blob()
    return await new Promise((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = () => resolve('')
      r.readAsDataURL(blob)
    })
  } catch {
    return ''
  }
}

// ---------- migration: inline data-URL portraits → disk ----------

/** Should this stored value be moved to disk? Real images only — the generic SVG orbs are ~1KB
 *  generated constants (moving them would also break the picker's selected-state match), and
 *  bundled assets (Seraphina) / disk refs / empty values stay as they are. */
const shouldMigrate = (v?: string): v is string => !!v && v.startsWith('data:image/') && !v.startsWith('data:image/svg')

/** Migrate one character's inline portraits to disk. Returns a store patch with the rewritten
 *  fields, or null if nothing needed moving. A failed write leaves that value inline (persist
 *  returns its input unchanged on failure), so this is safe to re-run — it converges. */
export async function migrateCharacterPortraits(
  c: Character,
  persist: (dataUrl: string) => Promise<string> = persistPortrait,
): Promise<Partial<Character> | null> {
  const patch: Partial<Character> = {}
  const move = async (v: string | undefined): Promise<string | undefined> => {
    if (!shouldMigrate(v)) return v
    const out = await persist(v)
    return out !== v ? out : v
  }

  const portrait = await move(c.portrait)
  if (portrait !== c.portrait) patch.portrait = portrait

  if (c.portraits && Object.values(c.portraits).some(shouldMigrate)) {
    const legacy: Partial<Record<EmotionKey, string>> = { ...c.portraits }
    let changed = false
    for (const k of Object.keys(legacy) as EmotionKey[]) {
      const moved = await move(legacy[k])
      if (moved !== legacy[k]) {
        legacy[k] = moved
        changed = true
      }
    }
    if (changed) patch.portraits = legacy
  }

  if (c.portraitSets?.some((s) => Object.values(s.portraits).some(shouldMigrate))) {
    let changed = false
    const sets = await Promise.all(
      c.portraitSets.map(async (s) => {
        const portraits: Partial<Record<EmotionKey, string>> = { ...s.portraits }
        for (const k of Object.keys(portraits) as EmotionKey[]) {
          const moved = await move(portraits[k])
          if (moved !== portraits[k]) {
            portraits[k] = moved
            changed = true
          }
        }
        return { ...s, portraits }
      }),
    )
    if (changed) patch.portraitSets = sets
  }

  return Object.keys(patch).length ? patch : null
}

type PortraitFields = Pick<Character, 'portrait' | 'portraits' | 'portraitSets'>

/** Every 'disk:' ref a character owns — used to clean up its files when they're dropped. */
export function collectDiskRefs(c: PortraitFields): string[] {
  const refs: string[] = []
  const add = (v?: string) => {
    if (isDiskRef(v)) refs.push(v!)
  }
  add(c.portrait)
  Object.values(c.portraits ?? {}).forEach(add)
  c.portraitSets?.forEach((s) => Object.values(s.portraits).forEach(add))
  return refs
}

/** Fire-and-forget deletion of a character's on-disk portrait files (call after removing it). */
export function deleteDiskPortraits(c: PortraitFields): void {
  for (const ref of collectDiskRefs(c)) deletePortrait(diskPath(ref)).catch(() => {})
}

/** Delete the files whose refs were dropped between two versions of a character — swapped
 *  emotion images, cleared slots, deleted sets. Call on SAVE only (never on draft edits, so
 *  Cancel keeps everything); refs still present after the save are kept. */
export function deleteDroppedPortraits(before: PortraitFields, after: PortraitFields): void {
  const keep = new Set(collectDiskRefs(after))
  for (const ref of collectDiskRefs(before)) {
    if (!keep.has(ref)) deletePortrait(diskPath(ref)).catch(() => {})
  }
}
