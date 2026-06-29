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

/** Standard (safety-tuned) models — the default, recommended tier. */
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
]

/** Uncensored ("abliterated"/finetuned) models — guardrails removed. Opt-in only. */
export const UNCENSORED_CATALOG: ModelOption[] = [
  {
    id: 'gemma3-4b-unc',
    name: 'Gemma 3 · 4B (uncensored)',
    filename: 'gemma-3-4b-it-abliterated.q4_k_m.gguf',
    url: 'https://huggingface.co/mlabonne/gemma-3-4b-it-abliterated-GGUF/resolve/main/gemma-3-4b-it-abliterated.q4_k_m.gguf',
    sizeGb: 2.32,
    minVramGb: 6,
    uncensored: true,
    note: 'Abliterated 4B — light and unfiltered.',
  },
  {
    id: 'gemma3-12b-unc',
    name: 'Gemma 3 · 12B (uncensored)',
    filename: 'gemma-3-12b-it-abliterated.q4_k_m.gguf',
    url: 'https://huggingface.co/mlabonne/gemma-3-12b-it-abliterated-GGUF/resolve/main/gemma-3-12b-it-abliterated.q4_k_m.gguf',
    sizeGb: 6.8,
    minVramGb: 12,
    uncensored: true,
    note: 'Abliterated 12B — unfiltered mid-range.',
  },
  {
    id: 'gemma3-27b-unc',
    name: 'Gemma 3 · 27B (uncensored)',
    filename: 'gemma-3-27b-it-abliterated.q4_k_m.gguf',
    url: 'https://huggingface.co/mlabonne/gemma-3-27b-it-abliterated-GGUF/resolve/main/gemma-3-27b-it-abliterated.q4_k_m.gguf',
    sizeGb: 15.41,
    minVramGb: 20,
    uncensored: true,
    note: 'Abliterated 27B — unfiltered flagship.',
  },
  {
    id: 'supergemma4',
    name: 'SuperGemma4 · 26B',
    filename: 'supergemma4-26b-uncensored-fast-v2-Q4_K_M.gguf',
    url: 'https://huggingface.co/Jiunsong/supergemma4-26b-uncensored-gguf-v2/resolve/main/supergemma4-26b-uncensored-fast-v2-Q4_K_M.gguf',
    sizeGb: 15.64,
    minVramGb: 20,
    uncensored: true,
    note: 'Uncensored roleplay finetune.',
  },
]

export const ALL_MODELS: ModelOption[] = [...MODEL_CATALOG, ...UNCENSORED_CATALOG]

export function findModel(id: string): ModelOption | undefined {
  return ALL_MODELS.find((m) => m.id === id)
}

/** Recommend a STANDARD (safe-default) model for the detected VRAM. */
export function recommendModel(vramGb: number | null): string {
  if (!vramGb) return 'gemma3-4b'
  const fits = MODEL_CATALOG.filter((m) => m.minVramGb <= vramGb).sort((a, b) => b.minVramGb - a.minVramGb)
  return fits[0]?.id ?? 'gemma3-4b'
}

/**
 * Turn a raw model id / GGUF filename / path (as the engine reports it on
 * /v1/models, or settings.model) into a friendly display label. Known catalog
 * models use their curated name; anything else is derived by stripping the
 * extension, quant tags, and common noise, then title-casing.
 */
export function friendlyModelName(idOrFile: string | null | undefined): string {
  if (!idOrFile) return 'the model'
  const base = idOrFile.split(/[\\/]/).pop() || idOrFile
  const hit = ALL_MODELS.find((m) => m.id === idOrFile || m.filename === base || m.filename === idOrFile)
  if (hit) return hit.name
  let s = base.replace(/\.gguf$/i, '')
  s = s.replace(/[._-](q\d[._a-z0-9]*|iq\d[._a-z0-9]*|f16|f32|bf16)\b/gi, '') // quant tags
  s = s.replace(/[._-](it|instruct|chat|abliterated|uncensored|unc|fast|base|v\d+(?:\.\d+)*)\b/gi, '') // noise tags
  s = s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return base.replace(/\.gguf$/i, '')
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}
