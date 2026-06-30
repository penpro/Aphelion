// Bundled expert emblem icons (transparent PNGs), mapped by builtin expert id.
// Custom (user-made) experts have no emblem and fall back to their emoji.
import generalist from './assets/experts/expert-generalist.png'
import llm from './assets/experts/expert-llm.png'
import code from './assets/experts/expert-code.png'
import rawtruth from './assets/experts/expert-rawtruth.png'
import image from './assets/experts/expert-image.png'
import photography from './assets/experts/expert-photography.png'
import writing from './assets/experts/expert-writing.png'

export const EXPERT_ICONS: Record<string, string> = {
  'exp-generalist': generalist,
  'exp-llm': llm,
  'exp-code': code,
  'exp-raw-truth': rawtruth,
  'exp-image-describer': image,
  'exp-photo': photography,
  'exp-writing': writing,
}

export function expertIcon(id?: string): string | undefined {
  return id ? EXPERT_ICONS[id] : undefined
}
