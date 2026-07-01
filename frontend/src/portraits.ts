import { convertFileSrc } from '@tauri-apps/api/core'
import { savePortrait, readImageData } from './tauri'
import { uid } from './util'

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
