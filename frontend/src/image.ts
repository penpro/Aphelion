// Portrait helpers — downscale/compress an uploaded image to a data URL stored inline in the
// save, plus a few generic on-brand portraits so the picker isn't empty before custom art exists.

// Longest side in px. 768 keeps the live portrait crisp at the Large size (even on hi-DPI) while
// WebP keeps each one ~60-150 KB. (Re-upload existing portraits to pick up the higher resolution.)
const MAX_EDGE = 768

/** Read an image File, downscale to fit MAX_EDGE, and return a compressed WebP data URL. */
export async function fileToPortrait(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error("That file isn't an image.")
  const dataUrl = await readAsDataUrl(file)
  const img = await loadImage(dataUrl)
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl // canvas unavailable — keep the original rather than fail
  ctx.drawImage(img, 0, 0, w, h)
  // toDataURL falls back to PNG if WebP isn't supported, so this is always safe.
  return canvas.toDataURL('image/webp', 0.85)
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(new Error('Could not read that file.'))
    r.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode that image.'))
    img.src = src
  })
}

/** A glowing eclipse orb in `color` — an on-brand generic portrait, no external asset needed. */
export function genericPortrait(color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">` +
    `<defs><radialGradient id="g" cx="50%" cy="42%" r="62%">` +
    `<stop offset="0%" stop-color="${color}"/>` +
    `<stop offset="52%" stop-color="${color}" stop-opacity="0.30"/>` +
    `<stop offset="100%" stop-color="#07021a"/></radialGradient></defs>` +
    `<rect width="128" height="128" fill="#0c0426"/>` +
    `<circle cx="64" cy="58" r="36" fill="url(#g)"/>` +
    `<circle cx="64" cy="58" r="36" fill="none" stroke="${color}" stroke-width="2.5" opacity="0.85"/>` +
    `<circle cx="64" cy="58" r="23" fill="#07021a"/>` +
    `</svg>`
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

export const GENERIC_PORTRAITS = ['#5EEAD4', '#22D3EE', '#C084FC', '#FF79C6', '#F5B642', '#34D399'].map(
  genericPortrait,
)
