// The single typed boundary to the Rust backend. UI code imports these functions instead of
// calling `invoke('cmd', {...})` directly, so every command name, argument shape, and return type
// lives in ONE place instead of being duplicated across ~40 call sites. Add a wrapper here for
// every new `#[tauri::command]`; components should never import `invoke` themselves.
import { invoke } from '@tauri-apps/api/core'

// ---------- shared shapes ----------

/** A model file on disk: `[filename, sizeBytes, isTheLoadedMainModel]`. */
export type ModelFile = [name: string, sizeBytes: number, isMain: boolean]

/** One download's live progress, as reported by the backend. */
export interface DownloadInfo {
  filename: string
  received: number
  total: number
  status: string
}

// ---------- engine & models ----------

/** GPU VRAM usage in MiB (via `nvidia-smi`). null off-Tauri / on non-NVIDIA. */
export async function gpuVram(): Promise<{ used: number; total: number } | null> {
  try {
    const r = (await invoke('gpu_vram')) as [number, number] | null
    return r ? { used: r[0], total: r[1] } : null
  } catch {
    return null
  }
}

/** Total VRAM (MiB) for model-fit recommendation (DXGI / Metal / nvidia-smi). null if unknown. */
export const vramTotalMb = (): Promise<number | null> => invoke('vram_total_mb')

/** Downloaded text-model filenames (vision projectors excluded). */
export const listModels = (): Promise<string[]> => invoke('list_models')

/** Absolute path of the model directory, or null. */
export const modelDirPath = (): Promise<string | null> => invoke('model_dir_path')

/** Start (or restart) the engine on a downloaded model file. Rejects with a user-facing message. */
export const startEngine = (filename: string): Promise<void> => invoke('start_engine', { filename })

/** Stop the running engine(s) — e.g. before an in-app update overwrites the binaries. */
export const shutdownEngine = (): Promise<void> => invoke('shutdown_engine')

/** All model files as `[name, sizeBytes, isMain]`. */
export const modelFiles = (): Promise<ModelFile[]> => invoke('model_files')

/** Delete a model file (refuses the active main model — switch first). */
export const deleteModel = (filename: string): Promise<void> => invoke('delete_model', { filename })

// ---------- downloads ----------

/** Start (or resume) a background model download. */
export const startDownload = (url: string, filename: string): Promise<void> =>
  invoke('start_download', { url, filename })

/** Pause a running download (keeps the partial file). */
export const pauseDownload = (filename: string): Promise<void> => invoke('pause_download', { filename })

/** Snapshot of all downloads' progress. */
export const downloadStatus = (): Promise<DownloadInfo[]> => invoke('download_status')

// ---------- knowledge folders ----------

/** Ingest (cached) a knowledge folder → `[fileCount, chunkCount, fileNames]`. */
export const folderInfo = (path: string): Promise<[number, number, string[]]> => invoke('folder_info', { path })

/** Retrieve the chunks most relevant to `query` from a knowledge folder, up to `maxChars`. */
export const retrieveContext = (path: string, query: string, maxChars: number): Promise<string> =>
  invoke('retrieve_context', { path, query, maxChars })

/** Extract text from dropped PDF bytes (scanned / image-only PDFs reject). */
export const extractPdf = (data: number[]): Promise<string> => invoke('extract_pdf', { data })

// ---------- documents & files (writes go only to user-granted folders) ----------

/** Record a user-picked folder/file's directory as granted, scoping the file commands to it. */
export const grantPath = (path: string): Promise<void> => invoke('grant_path', { path })

/** Compile Typst `source` → PDF (temp preview when `outPath` is null). Returns the PDF path. */
export const compileTypst = (source: string, outPath: string | null): Promise<string> =>
  invoke('compile_typst', { source, outPath })

/** Open a file with the OS default application. */
export const openPath = (path: string): Promise<void> => invoke('open_path', { path })

/** Write `<title>.typ` + compile `<title>.pdf` into a granted folder. Returns the PDF path. */
export const saveDocument = (folder: string, title: string, source: string): Promise<string> =>
  invoke('save_document', { folder, title, source })

/** Save a plain-text / code document as `<title>.<ext>` in a granted folder. Returns the path. */
export const saveTextDocument = (folder: string, title: string, ext: string, content: string): Promise<string> =>
  invoke('save_text_document', { folder, title, ext, content })

/** Saved-document / editable filenames in a folder, newest first. */
export const listDocuments = (folder: string): Promise<string[]> => invoke('list_documents', { folder })

/** Read a saved document's source back from a folder. */
export const readDocument = (folder: string, name: string): Promise<string> =>
  invoke('read_document', { folder, name })

/** Read a text file by absolute path (must be inside a granted folder). */
export const readTextFile = (path: string): Promise<string> => invoke('read_text_file', { path })

/** Overwrite a text/code file at a granted absolute path. */
export const writeToPath = (path: string, content: string): Promise<void> =>
  invoke('write_to_path', { path, content })

/** Write Typst to `typPath` + compile a PDF beside it (granted path). Returns the PDF path. */
export const saveTypstAt = (typPath: string, source: string): Promise<string> =>
  invoke('save_typst_at', { typPath, source })

/** Write content to a temp file (to preview a generated file in its default app). Returns the path. */
export const writeTempFile = (name: string, content: string): Promise<string> =>
  invoke('write_temp_file', { name, content })

// ---------- vision ----------

/** Whether both files of a vision model are present on disk. */
export const visionPresent = (textFile: string, mmprojFile: string): Promise<boolean> =>
  invoke('vision_present', { textFile, mmprojFile })

/** Swap the engine between text and image mode on the main port. */
export const setVisionMode = (on: boolean, textFile: string, mmprojFile: string): Promise<void> =>
  invoke('set_vision_mode', { on, textFile, mmprojFile })

/** Image filenames in a folder (non-recursive), sorted. */
export const listImages = (folder: string): Promise<string[]> => invoke('list_images', { folder })

/** Read a folder image as a base64 data URL (to send to the vision model). */
export const readImageData = (folder: string, name: string): Promise<string> =>
  invoke('read_image_data', { folder, name })

// ---------- portraits (on-disk storage) ----------

/** Write a portrait data-URL to disk under `<app-data>/portraits`; returns the file path. */
export const savePortrait = (id: string, dataUrl: string): Promise<string> =>
  invoke('save_portrait', { id, dataUrl })

/** Delete a portrait file (best-effort; only inside the portraits dir). */
export const deletePortrait = (path: string): Promise<void> => invoke('delete_portrait', { path })

// ---------- app ----------

/** The running app version (from Cargo). */
export const appVersion = (): Promise<string> => invoke('app_version')
