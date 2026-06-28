import { invoke } from '@tauri-apps/api/core'

/** GPU VRAM usage in MiB via the Rust `gpu_vram` command (nvidia-smi). null off-Tauri / non-NVIDIA. */
export async function gpuVram(): Promise<{ used: number; total: number } | null> {
  try {
    const r = (await invoke('gpu_vram')) as [number, number] | null
    return r ? { used: r[0], total: r[1] } : null
  } catch {
    return null
  }
}
