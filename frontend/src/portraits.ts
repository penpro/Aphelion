import { invoke, convertFileSrc } from '@tauri-apps/api/core'
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
    const path = await invoke<string>('save_portrait', { id: uid(), dataUrl })
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
