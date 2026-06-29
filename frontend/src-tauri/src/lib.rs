use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Manager, State};

/// Holds the bundled llama.cpp server process so we can shut it down / restart it.
struct Engine(Mutex<Option<Child>>);

/// Caches ingested + chunked text per knowledge-folder path (re-read on app restart).
struct KnowledgeCache(Mutex<HashMap<String, Vec<(String, String)>>>);

const LLAMA_PORT: u16 = 11435;

/// The app's own model directory (AppData/<id>/models), created if missing.
fn model_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("models");
    let _ = std::fs::create_dir_all(&dir);
    Some(dir)
}

/// The llama.cpp server binary name (`.exe` only on Windows).
fn server_bin() -> &'static str {
    if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}

/// Resolve the llama-server binary (resource dir when packaged, dev `bin/llama` otherwise).
fn llama_server_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let bin = server_bin();
    let resource = app
        .path()
        .resolve(format!("llama/{bin}"), tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|p| p.exists());
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin/llama").join(bin);
    resource.or(Some(dev)).filter(|p| p.exists())
}

/// Launch llama-server hidden, serving `model` on the local port.
fn spawn_engine(app: &tauri::AppHandle, model: &Path) -> Option<Child> {
    let exe = llama_server_path(app)?;
    let mut cmd = Command::new(&exe);
    cmd.args([
        "-m",
        &model.to_string_lossy(),
        "--host",
        "127.0.0.1",
        "--port",
        &LLAMA_PORT.to_string(),
        "-ngl",
        "999",
        "-c",
        "32768",
        "--reasoning",
        "off",
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    match cmd.spawn() {
        Ok(child) => {
            println!("[engine] started (pid {}) on {model:?}", child.id());
            Some(child)
        }
        Err(e) => {
            eprintln!("[engine] failed to start: {e}");
            None
        }
    }
}

/// Live GPU memory (used, total) in MiB via nvidia-smi. None on non-NVIDIA.
#[tauri::command]
fn gpu_vram() -> Option<(u64, u64)> {
    let mut cmd = Command::new("nvidia-smi");
    cmd.args(["--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().next()?;
    let mut parts = line.split(',').map(|p| p.trim());
    let used: u64 = parts.next()?.parse().ok()?;
    let total: u64 = parts.next()?.parse().ok()?;
    Some((used, total))
}

/// Dedicated VRAM (MiB) of the largest GPU adapter via DXGI — works on ANY vendor
/// (NVIDIA/AMD/Intel), unlike nvidia-smi.
#[cfg(windows)]
fn detect_vram_mb_dxgi() -> Option<u64> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1().ok()?;
        let mut best: usize = 0;
        let mut i = 0u32;
        while let Ok(adapter) = factory.EnumAdapters1(i) {
            if let Ok(desc) = adapter.GetDesc1() {
                if desc.DedicatedVideoMemory > best {
                    best = desc.DedicatedVideoMemory;
                }
            }
            i += 1;
        }
        (best > 0).then(|| (best / (1024 * 1024)) as u64)
    }
}

/// Apple Silicon shares system RAM with the GPU, so ~70% of total RAM is the model budget.
#[cfg(target_os = "macos")]
fn detect_mem_budget_mb_macos() -> Option<u64> {
    let out = Command::new("sysctl").args(["-n", "hw.memsize"]).output().ok()?;
    let bytes: u64 = String::from_utf8_lossy(&out.stdout).trim().parse().ok()?;
    Some((bytes / (1024 * 1024)) * 7 / 10)
}

/// Total VRAM (MiB) for model recommendation: DXGI on Windows (any GPU vendor),
/// Apple unified-memory budget on macOS, nvidia-smi elsewhere.
#[tauri::command]
fn vram_total_mb() -> Option<u64> {
    #[cfg(windows)]
    if let Some(mb) = detect_vram_mb_dxgi() {
        return Some(mb);
    }
    #[cfg(target_os = "macos")]
    if let Some(mb) = detect_mem_budget_mb_macos() {
        return Some(mb);
    }
    gpu_vram().map(|(_, total)| total)
}

/// List downloaded model files (*.gguf) in the app model dir.
#[tauri::command]
fn list_models(app: tauri::AppHandle) -> Vec<String> {
    let Some(dir) = model_dir(&app) else { return vec![] };
    let mut out = vec![];
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".gguf") {
                out.push(name);
            }
        }
    }
    out
}

/// Absolute path of the app model dir (the download target for the frontend).
#[tauri::command]
fn model_dir_path(app: tauri::AppHandle) -> Option<String> {
    model_dir(&app).map(|p| p.to_string_lossy().to_string())
}

/// Start (or restart) the engine on a downloaded model file.
#[tauri::command]
fn start_engine(app: tauri::AppHandle, filename: String) -> Result<(), String> {
    let dir = model_dir(&app).ok_or("no model dir")?;
    let model = dir.join(&filename);
    if !model.exists() {
        return Err(format!("model not found: {filename}"));
    }
    if let Some(mut old) = app.state::<Engine>().0.lock().unwrap().take() {
        let _ = old.kill();
    }
    let child = spawn_engine(&app, &model);
    let ok = child.is_some();
    *app.state::<Engine>().0.lock().unwrap() = child;
    if ok {
        Ok(())
    } else {
        Err("engine failed to launch".into())
    }
}

// ---------- knowledge folder (user-granted, read-only, app-injected) ----------

/// Split text into ~1200-char chunks on paragraph boundaries.
fn chunk_text(t: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for para in t.split("\n\n") {
        let para = para.trim();
        if para.is_empty() {
            continue;
        }
        if !cur.is_empty() && cur.len() + para.len() > 1200 {
            out.push(std::mem::take(&mut cur));
        }
        if !cur.is_empty() {
            cur.push_str("\n\n");
        }
        cur.push_str(para);
        if cur.len() >= 1200 {
            out.push(std::mem::take(&mut cur));
        }
    }
    if !cur.trim().is_empty() {
        out.push(cur);
    }
    out
}

/// Read every supported file under `path` into (filename, chunk) pairs. Text/markdown/
/// code read directly; PDFs via text extraction (scanned/image PDFs yield nothing).
fn ingest_folder(path: &str) -> Vec<(String, String)> {
    let mut chunks = Vec::new();
    let mut stack = vec![PathBuf::from(path)];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
            let text = match ext.as_str() {
                "txt" | "md" | "markdown" | "text" | "csv" | "json" | "rs" | "py" | "js" | "ts" => {
                    std::fs::read_to_string(&p).ok()
                }
                // pdf-extract can panic on malformed PDFs — contain it so one bad file can't crash ingest.
                "pdf" => std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| pdf_extract::extract_text(&p).ok()))
                    .ok()
                    .flatten(),
                _ => None,
            };
            if let Some(t) = text {
                for c in chunk_text(&t) {
                    chunks.push((name.clone(), c));
                }
            }
        }
    }
    chunks
}

/// Ingest (cached) a knowledge folder; returns (file count, chunk count, file names).
#[tauri::command]
fn folder_info(cache: State<KnowledgeCache>, path: String) -> (usize, usize, Vec<String>) {
    let mut map = cache.0.lock().unwrap();
    let chunks = map.entry(path.clone()).or_insert_with(|| ingest_folder(&path));
    let mut names: Vec<String> = chunks.iter().map(|c| c.0.clone()).collect();
    names.sort();
    names.dedup();
    (names.len(), chunks.len(), names)
}

/// Retrieve the chunks most relevant to `query` (keyword scoring), up to `max_chars`.
#[tauri::command]
fn retrieve_context(cache: State<KnowledgeCache>, path: String, query: String, max_chars: usize) -> String {
    let mut map = cache.0.lock().unwrap();
    let chunks = map.entry(path.clone()).or_insert_with(|| ingest_folder(&path));
    if chunks.is_empty() {
        return String::new();
    }
    let terms: Vec<String> = query
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 2)
        .map(|w| w.to_string())
        .collect();
    if terms.is_empty() {
        return String::new();
    }
    let mut scored: Vec<(usize, usize)> = chunks
        .iter()
        .enumerate()
        .map(|(i, (_, text))| {
            let lc = text.to_lowercase();
            let score = terms.iter().map(|t| lc.matches(t.as_str()).count()).sum::<usize>();
            (score, i)
        })
        .filter(|(s, _)| *s > 0)
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    let mut out = String::new();
    for (_, i) in scored {
        let (src, text) = &chunks[i];
        if out.len() + text.len() + src.len() + 8 > max_chars {
            continue;
        }
        out.push_str("[");
        out.push_str(src);
        out.push_str("]\n");
        out.push_str(text);
        out.push_str("\n\n");
    }
    out
}

// ---------- document generator (Typst → PDF) ----------

/// The Typst CLI binary name (`.exe` only on Windows).
fn typst_bin() -> &'static str {
    if cfg!(windows) {
        "typst.exe"
    } else {
        "typst"
    }
}

/// Resolve the bundled Typst binary (resource dir when packaged, dev `bin/typst` otherwise).
fn typst_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let bin = typst_bin();
    let resource = app
        .path()
        .resolve(format!("typst/{bin}"), tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|p| p.exists());
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin/typst").join(bin);
    resource.or(Some(dev)).filter(|p| p.exists())
}

/// Compile Typst `source` to a PDF. With `out_path`, writes there; otherwise to a temp
/// preview file. Returns the PDF path on success, or Typst's error output on failure.
#[tauri::command]
fn compile_typst(app: tauri::AppHandle, source: String, out_path: Option<String>) -> Result<String, String> {
    let exe = typst_path(&app).ok_or("Typst engine not found")?;
    let work = std::env::temp_dir().join("aphelion-typst");
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let input = work.join("document.typ");
    std::fs::write(&input, &source).map_err(|e| format!("couldn't write source: {e}"))?;
    let out = match out_path {
        Some(p) => PathBuf::from(p),
        None => work.join("preview.pdf"),
    };
    let mut cmd = Command::new(&exe);
    cmd.arg("compile").arg("--root").arg(&work).arg(&input).arg(&out);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let result = cmd.output().map_err(|e| format!("failed to run Typst: {e}"))?;
    if result.status.success() {
        Ok(out.to_string_lossy().to_string())
    } else {
        let err = String::from_utf8_lossy(&result.stderr);
        Err(if err.trim().is_empty() {
            "Typst could not compile the document.".into()
        } else {
            err.to_string()
        })
    }
}

/// Open a file with the OS default application (used to show a generated PDF).
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", "start", "", &path]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(&path);
        c
    };
    #[cfg(target_os = "linux")]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(&path);
        c
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Save a generated document into a user-granted folder: writes `<title>.typ` and compiles
/// `<title>.pdf` beside it. Returns the PDF path. The app writes the files; the model never does.
#[tauri::command]
fn save_document(app: tauri::AppHandle, folder: String, title: String, source: String) -> Result<String, String> {
    let dir = PathBuf::from(&folder);
    if !dir.is_dir() {
        return Err("That folder no longer exists.".into());
    }
    let cleaned: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let cleaned = cleaned.trim();
    let base = if cleaned.is_empty() { "document" } else { cleaned };
    let safe: String = base.chars().take(60).collect();
    let typ = dir.join(format!("{safe}.typ"));
    let pdf = dir.join(format!("{safe}.pdf"));
    std::fs::write(&typ, &source).map_err(|e| format!("couldn't write the source: {e}"))?;
    let exe = typst_path(&app).ok_or("Typst engine not found")?;
    let mut cmd = Command::new(&exe);
    cmd.arg("compile").arg("--root").arg(&dir).arg(&typ).arg(&pdf);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let result = cmd.output().map_err(|e| format!("failed to run Typst: {e}"))?;
    if result.status.success() {
        Ok(pdf.to_string_lossy().to_string())
    } else {
        let err = String::from_utf8_lossy(&result.stderr);
        Err(if err.trim().is_empty() {
            "Typst could not compile the document.".into()
        } else {
            err.to_string()
        })
    }
}

/// List saved document sources (`*.typ`) in a folder, newest first — for reopening.
#[tauri::command]
fn list_documents(folder: String) -> Vec<String> {
    let mut docs: Vec<(std::time::SystemTime, String)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&folder) {
        for e in entries.flatten() {
            let p = e.path();
            let is_typ = p.extension().map_or(false, |x| x.to_string_lossy().to_lowercase() == "typ");
            if is_typ {
                let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                let mtime = e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
                docs.push((mtime, name));
            }
        }
    }
    docs.sort_by(|a, b| b.0.cmp(&a.0));
    docs.into_iter().map(|(_, n)| n).collect()
}

/// Read a saved document's source back from a granted folder (for reopening / editing).
#[tauri::command]
fn read_document(folder: String, name: String) -> Result<String, String> {
    let p = PathBuf::from(&folder).join(&name);
    std::fs::read_to_string(&p).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Engine(Mutex::new(None)))
        .manage(KnowledgeCache(Mutex::new(HashMap::new())))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Auto-start the engine if a model is already downloaded; otherwise the
            // frontend shows the first-run setup wizard.
            let handle = app.handle().clone();
            if let Some(dir) = model_dir(&handle) {
                if let Ok(entries) = std::fs::read_dir(&dir) {
                    if let Some(model) = entries
                        .flatten()
                        .map(|e| e.path())
                        .find(|p| p.extension().map_or(false, |x| x == "gguf"))
                    {
                        let child = spawn_engine(&handle, &model);
                        *handle.state::<Engine>().0.lock().unwrap() = child;
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(engine) = window.app_handle().try_state::<Engine>() {
                    if let Some(mut child) = engine.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            gpu_vram,
            vram_total_mb,
            list_models,
            model_dir_path,
            start_engine,
            folder_info,
            retrieve_context,
            compile_typst,
            open_path,
            save_document,
            list_documents,
            read_document
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
