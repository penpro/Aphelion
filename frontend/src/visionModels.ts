// Vision-capable models (Gemma 3 + matching projector) for image tasks. They run as a
// second engine on their own port; large ones may require unloading the main model.
export interface VisionModel {
  id: string
  label: string
  textFile: string // local filename for the text weights
  mmprojFile: string // local filename for the vision projector (renamed to avoid collisions)
  textUrl: string
  mmprojUrl: string
  approxGb: number
  note: string
}

const repo = (s: string) => `https://huggingface.co/ggml-org/gemma-3-${s}-it-GGUF/resolve/main`

export const VISION_MODELS: VisionModel[] = [
  {
    id: 'gemma3-4b-vision',
    label: 'Gemma 3 4B',
    textFile: 'gemma-3-4b-it-Q4_K_M.gguf',
    mmprojFile: 'gemma-3-4b-it-mmproj.gguf',
    textUrl: `${repo('4b')}/gemma-3-4b-it-Q4_K_M.gguf`,
    mmprojUrl: `${repo('4b')}/mmproj-model-f16.gguf`,
    approxGb: 3.1,
    note: 'Smallest & fastest. Runs alongside your main model without unloading it.',
  },
  {
    id: 'gemma3-12b-vision',
    label: 'Gemma 3 12B',
    textFile: 'gemma-3-12b-it-Q4_K_M.gguf',
    mmprojFile: 'gemma-3-12b-it-mmproj.gguf',
    textUrl: `${repo('12b')}/gemma-3-12b-it-Q4_K_M.gguf`,
    mmprojUrl: `${repo('12b')}/mmproj-model-f16.gguf`,
    approxGb: 8.1,
    note: 'Sharper recognition; usually fits alongside your main model on 24 GB.',
  },
  {
    id: 'gemma3-27b-vision',
    label: 'Gemma 3 27B',
    textFile: 'gemma-3-27b-it-Q4_K_M.gguf',
    mmprojFile: 'gemma-3-27b-it-mmproj.gguf',
    textUrl: `${repo('27b')}/gemma-3-27b-it-Q4_K_M.gguf`,
    mmprojUrl: `${repo('27b')}/mmproj-model-f16.gguf`,
    approxGb: 16.0,
    note: 'Best quality; will likely unload your main model while in use.',
  },
]

export const findVisionModel = (id: string): VisionModel | null => VISION_MODELS.find((v) => v.id === id) ?? null
