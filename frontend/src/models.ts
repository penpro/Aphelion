export interface ModelOption {
  id: string
  name: string
  filename: string
  url: string
  sizeGb: number
  minVramGb: number // recommended minimum VRAM
  uncensored?: boolean
  note: string
}

/** Curated, verified GGUFs across VRAM tiers (all single-file Q4_K_M). */
export const MODEL_CATALOG: ModelOption[] = [
  {
    id: 'gemma3-4b',
    name: 'Gemma 3 · 4B',
    filename: 'gemma-3-4b-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf',
    sizeGb: 2.32,
    minVramGb: 6,
    note: 'Fast and light. Runs on modest GPUs (or CPU).',
  },
  {
    id: 'gemma3-12b',
    name: 'Gemma 3 · 12B',
    filename: 'gemma-3-12b-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/ggml-org/gemma-3-12b-it-GGUF/resolve/main/gemma-3-12b-it-Q4_K_M.gguf',
    sizeGb: 6.8,
    minVramGb: 12,
    note: 'A strong all-rounder for mid-range GPUs.',
  },
  {
    id: 'gemma3-27b',
    name: 'Gemma 3 · 27B',
    filename: 'gemma-3-27b-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/ggml-org/gemma-3-27b-it-GGUF/resolve/main/gemma-3-27b-it-Q4_K_M.gguf',
    sizeGb: 15.41,
    minVramGb: 20,
    note: 'Most capable Gemma. Needs a high-VRAM GPU.',
  },
  {
    id: 'supergemma4',
    name: 'SuperGemma4 · 26B (uncensored)',
    filename: 'supergemma4-26b-uncensored-fast-v2-Q4_K_M.gguf',
    url: 'https://huggingface.co/Jiunsong/supergemma4-26b-uncensored-gguf-v2/resolve/main/supergemma4-26b-uncensored-fast-v2-Q4_K_M.gguf',
    sizeGb: 15.64,
    minVramGb: 20,
    uncensored: true,
    note: 'Uncensored roleplay finetune. Needs a high-VRAM GPU.',
  },
]

/** Pick the best model for the detected VRAM (minVramGb bakes in context headroom). */
export function recommendModel(vramGb: number | null): string {
  if (!vramGb) return 'gemma3-4b'
  if (vramGb >= 20) return 'supergemma4' // favor the uncensored flagship when there's room
  const fits = MODEL_CATALOG.filter((m) => m.minVramGb <= vramGb).sort((a, b) => b.minVramGb - a.minVramGb)
  return fits[0]?.id ?? 'gemma3-4b'
}
