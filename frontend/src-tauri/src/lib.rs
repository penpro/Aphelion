use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Manager, State};

/// Holds the bundled llama.cpp server process so we can shut it down / restart it.
struct Engine(Mutex<Option<Child>>);

/// Caches ingested + chunked text per knowledge-folder path (re-read on app restart).
struct KnowledgeCache(Mutex<HashMap<String, Vec<(String, String)>>>);

/// Holds the vision model's process while in image mode (swapped onto LLAMA_PORT).
struct VisionEngine(Mutex<Option<Child>>);

/// Filename of the main (text) model, remembered so it reloads when leaving image mode.
struct MainModel(Mutex<Option<String>>);

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
            // Hide vision projectors — they aren't loadable as standalone text models.
            if name.ends_with(".gguf") && !name.contains("mmproj") {
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
    *app.state::<MainModel>().0.lock().unwrap() = Some(filename.clone());
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

/// Score chunks by query keyword frequency; return the most relevant, up to `max_chars`.
fn retrieve_chunks(chunks: &[(String, String)], query: &str, max_chars: usize) -> String {
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

/// Retrieve the chunks most relevant to `query` (keyword scoring), up to `max_chars`.
#[tauri::command]
fn retrieve_context(cache: State<KnowledgeCache>, path: String, query: String, max_chars: usize) -> String {
    let mut map = cache.0.lock().unwrap();
    let chunks = map.entry(path.clone()).or_insert_with(|| ingest_folder(&path));
    if chunks.is_empty() {
        return String::new();
    }
    retrieve_chunks(chunks, &query, max_chars)
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

/// Make a safe file base name from a document title (used for saved documents).
fn sanitize_title(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let cleaned = cleaned.trim();
    let base = if cleaned.is_empty() { "document" } else { cleaned };
    base.chars().take(60).collect()
}

/// Save a generated document into a user-granted folder: writes `<title>.typ` and compiles
/// `<title>.pdf` beside it. Returns the PDF path. The app writes the files; the model never does.
#[tauri::command]
fn save_document(app: tauri::AppHandle, folder: String, title: String, source: String) -> Result<String, String> {
    let dir = PathBuf::from(&folder);
    if !dir.is_dir() {
        return Err("That folder no longer exists.".into());
    }
    let safe = sanitize_title(&title);
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
    const DOC_EXTS: &[&str] = &[
        "typ", "md", "markdown", "txt", "text", "html", "htm", "css", "js", "ts", "jsx", "tsx", "json",
        "csv", "xml", "yaml", "yml", "java", "py", "rs", "go", "c", "cpp", "h", "sh", "sql",
    ];
    let mut docs: Vec<(std::time::SystemTime, String)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&folder) {
        for e in entries.flatten() {
            let p = e.path();
            let is_doc = p
                .extension()
                .map_or(false, |x| DOC_EXTS.contains(&x.to_string_lossy().to_lowercase().as_str()));
            if is_doc {
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

/// Save a generated plain-text / code document as `<title>.<ext>` in a granted folder,
/// ready for an IDE/editor to open. Returns the file path.
#[tauri::command]
fn save_text_document(folder: String, title: String, ext: String, content: String) -> Result<String, String> {
    let dir = PathBuf::from(&folder);
    if !dir.is_dir() {
        return Err("That folder no longer exists.".into());
    }
    let safe = sanitize_title(&title);
    let ext_clean: String = ext.chars().filter(|c| c.is_alphanumeric()).take(12).collect::<String>().to_lowercase();
    let ext_clean = if ext_clean.is_empty() { "txt".to_string() } else { ext_clean };
    let file = dir.join(format!("{safe}.{ext_clean}"));
    std::fs::write(&file, content).map_err(|e| format!("couldn't write the file: {e}"))?;
    Ok(file.to_string_lossy().to_string())
}

/// Write content to a temp file (to preview a generated text/code file in its default app).
#[tauri::command]
fn write_temp_file(name: String, content: String) -> Result<String, String> {
    let safe: String = name.chars().filter(|c| c.is_alphanumeric() || *c == '.' || *c == '-' || *c == '_').collect();
    let safe = if safe.is_empty() { "preview.txt".to_string() } else { safe };
    let dir = std::env::temp_dir().join("aphelion-docs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join(safe);
    std::fs::write(&p, content).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().to_string())
}

/// Read any text file by absolute path (for opening a file to edit). Binary/non-UTF-8
/// files (e.g. images) return a friendly error rather than a cryptic decode failure.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    String::from_utf8(bytes)
        .map_err(|_| "That file isn't text (it looks like an image or binary). To analyze an image, drag it into the chat instead.".to_string())
}

/// Overwrite a text/code file at an absolute path (saving edits back to the opened file).
#[tauri::command]
fn write_to_path(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

/// Write Typst source to `typ_path` and compile a PDF beside it; returns the PDF path.
#[tauri::command]
fn save_typst_at(app: tauri::AppHandle, typ_path: String, source: String) -> Result<String, String> {
    let typ = PathBuf::from(&typ_path);
    let dir = typ.parent().map(|p| p.to_path_buf()).unwrap_or_else(std::env::temp_dir);
    std::fs::write(&typ, &source).map_err(|e| format!("couldn't write the source: {e}"))?;
    let pdf = typ.with_extension("pdf");
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

// ---------- vision model (optional second engine with an mmproj) ----------

/// Whether both files of a vision model are present in the model dir.
#[tauri::command]
fn vision_present(app: tauri::AppHandle, text_file: String, mmproj_file: String) -> bool {
    match model_dir(&app) {
        Some(dir) => dir.join(&text_file).exists() && dir.join(&mmproj_file).exists(),
        None => false,
    }
}

/// Switch between text and image mode by swapping the model loaded on LLAMA_PORT.
/// on=true: stop the main model, load the vision model (with its mmproj).
/// on=false: stop the vision model, reload the remembered main model.
#[tauri::command]
fn set_vision_mode(app: tauri::AppHandle, on: bool, text_file: String, mmproj_file: String) -> Result<(), String> {
    let dir = model_dir(&app).ok_or("no model dir")?;
    if on {
        let model = dir.join(&text_file);
        let mmproj = dir.join(&mmproj_file);
        if !model.exists() || !mmproj.exists() {
            return Err("vision model files not found — download it in Settings".into());
        }
        if let Some(mut old) = app.state::<Engine>().0.lock().unwrap().take() {
            let _ = old.kill();
        }
        if let Some(mut old) = app.state::<VisionEngine>().0.lock().unwrap().take() {
            let _ = old.kill();
        }
        let exe = llama_server_path(&app).ok_or("engine binary not found")?;
        let port = LLAMA_PORT.to_string();
        let mut cmd = Command::new(&exe);
        cmd.arg("-m")
            .arg(&model)
            .arg("--mmproj")
            .arg(&mmproj)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(&port)
            .arg("-ngl")
            .arg("999")
            .arg("-c")
            .arg("4096");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        match cmd.spawn() {
            Ok(child) => {
                *app.state::<VisionEngine>().0.lock().unwrap() = Some(child);
                Ok(())
            }
            Err(e) => Err(format!("failed to start vision engine: {e}")),
        }
    } else {
        if let Some(mut old) = app.state::<VisionEngine>().0.lock().unwrap().take() {
            let _ = old.kill();
        }
        let main = app.state::<MainModel>().0.lock().unwrap().clone();
        let main = main.ok_or("no main model on record to reload")?;
        let model = dir.join(&main);
        if !model.exists() {
            return Err(format!("main model not found: {main}"));
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
            Err("main model failed to reload".into())
        }
    }
}

// ---------- model management (list with sizes, delete) ----------

/// List model files: (filename, size_bytes, is_loaded_main). Includes vision files + projectors.
#[tauri::command]
fn model_files(app: tauri::AppHandle) -> Vec<(String, u64, bool)> {
    let Some(dir) = model_dir(&app) else { return vec![] };
    let main = app.state::<MainModel>().0.lock().unwrap().clone();
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".gguf") {
                let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                let is_main = main.as_deref() == Some(name.as_str());
                out.push((name, size, is_main));
            }
        }
    }
    out.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    out
}

/// Delete a model file. Refuses the active main model (switch first); if a file lock
/// blocks it (e.g. the vision engine), frees that engine and retries.
#[tauri::command]
fn delete_model(app: tauri::AppHandle, filename: String) -> Result<(), String> {
    let dir = model_dir(&app).ok_or("no model dir")?;
    let path = dir.join(&filename);
    if !path.exists() {
        return Ok(());
    }
    let main = app.state::<MainModel>().0.lock().unwrap().clone();
    let main_running = app.state::<Engine>().0.lock().unwrap().is_some();
    if main_running && main.as_deref() == Some(filename.as_str()) {
        return Err("That model is currently loaded. Switch to another model first.".into());
    }
    if std::fs::remove_file(&path).is_ok() {
        return Ok(());
    }
    // Possibly locked by the vision engine — free it and retry.
    if let Some(mut v) = app.state::<VisionEngine>().0.lock().unwrap().take() {
        let _ = v.kill();
    }
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

// ---------- resumable background model downloads ----------

#[derive(Clone, serde::Serialize)]
struct DownloadEntry {
    received: u64,
    total: u64,
    status: String, // downloading | resuming | paused | failed | done
}

/// Tracks in-flight model downloads so the UI can show progress and pause/resume.
struct Downloads(Mutex<HashMap<String, DownloadEntry>>);

/// Snapshot of all downloads: (filename, received_bytes, total_bytes, status).
#[tauri::command]
fn download_status(downloads: State<Downloads>) -> Vec<(String, u64, u64, String)> {
    downloads
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|(f, e)| (f.clone(), e.received, e.total, e.status.clone()))
        .collect()
}

/// Pause a running download — keeps the partial file so it can resume later.
#[tauri::command]
fn pause_download(downloads: State<Downloads>, filename: String) {
    if let Some(e) = downloads.0.lock().unwrap().get_mut(&filename) {
        e.status = "paused".into();
    }
}

/// Start (or resume) a background download of `url` into the model dir as `filename`.
#[tauri::command]
fn start_download(app: tauri::AppHandle, url: String, filename: String) -> Result<(), String> {
    let dir = model_dir(&app).ok_or("no model dir")?;
    let path = dir.join(&filename);
    {
        let downloads = app.state::<Downloads>();
        let mut map = downloads.0.lock().unwrap();
        if let Some(e) = map.get(&filename) {
            if e.status == "downloading" || e.status == "resuming" {
                return Ok(()); // already in progress
            }
        }
        let existing = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        map.insert(
            filename.clone(),
            DownloadEntry {
                received: existing,
                total: 0,
                status: if existing > 0 { "resuming".into() } else { "downloading".into() },
            },
        );
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_download(&app2, &url, &filename, &path).await {
            if let Some(en) = app2.state::<Downloads>().0.lock().unwrap().get_mut(&filename) {
                if en.status != "paused" {
                    en.status = "failed".into();
                }
            }
            eprintln!("[download] {filename} failed: {e}");
        }
    });
    Ok(())
}

/// Stream a download to disk, resuming from any partial file via an HTTP Range request.
async fn run_download(app: &tauri::AppHandle, url: &str, filename: &str, path: &Path) -> Result<(), String> {
    use futures_util::StreamExt;
    use std::io::Write;

    let start = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let client = reqwest::Client::new();
    let mut req = client.get(url);
    if start > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={start}-"));
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let code = resp.status().as_u16();
    if code == 416 {
        // Range not satisfiable → the file is already complete.
        if let Some(e) = app.state::<Downloads>().0.lock().unwrap().get_mut(filename) {
            e.total = start;
            e.received = start;
            e.status = "done".into();
        }
        return Ok(());
    }
    if !resp.status().is_success() {
        return Err(format!("HTTP {code}"));
    }
    let resumed = code == 206 && start > 0;
    let len = resp.content_length().unwrap_or(0);
    let total = if resumed { start + len } else { len };
    let mut file = if resumed {
        std::fs::OpenOptions::new().append(true).open(path).map_err(|e| e.to_string())?
    } else {
        std::fs::File::create(path).map_err(|e| e.to_string())?
    };
    let mut received = if resumed { start } else { 0 };
    if let Some(e) = app.state::<Downloads>().0.lock().unwrap().get_mut(filename) {
        e.received = received;
        e.total = total;
        e.status = "downloading".into();
    }
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        // Pause check — leave the partial file in place and stop.
        if app
            .state::<Downloads>()
            .0
            .lock()
            .unwrap()
            .get(filename)
            .map(|e| e.status == "paused")
            .unwrap_or(false)
        {
            return Ok(());
        }
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if let Some(e) = app.state::<Downloads>().0.lock().unwrap().get_mut(filename) {
            e.received = received;
        }
    }
    file.flush().ok();
    if let Some(e) = app.state::<Downloads>().0.lock().unwrap().get_mut(filename) {
        e.status = "done".into();
        if e.total == 0 {
            e.total = received;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Engine(Mutex::new(None)))
        .manage(KnowledgeCache(Mutex::new(HashMap::new())))
        .manage(VisionEngine(Mutex::new(None)))
        .manage(MainModel(Mutex::new(None)))
        .manage(Downloads(Mutex::new(HashMap::new())))
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
                    // Pick the largest non-projector .gguf as the main model (the user's main
                    // model is typically larger than any bundled vision model like Gemma 3 4B).
                    let mut best: Option<(u64, PathBuf)> = None;
                    for e in entries.flatten() {
                        let p = e.path();
                        let is_gguf = p.extension().map_or(false, |x| x == "gguf");
                        let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
                        if is_gguf && !name.contains("mmproj") {
                            let sz = e.metadata().map(|m| m.len()).unwrap_or(0);
                            if best.as_ref().map_or(true, |(b, _)| sz > *b) {
                                best = Some((sz, p));
                            }
                        }
                    }
                    if let Some((_, model)) = best {
                        if let Some(fname) = model.file_name().map(|n| n.to_string_lossy().to_string()) {
                            *handle.state::<MainModel>().0.lock().unwrap() = Some(fname);
                        }
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
                if let Some(v) = window.app_handle().try_state::<VisionEngine>() {
                    if let Some(mut child) = v.0.lock().unwrap().take() {
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
            read_document,
            save_text_document,
            write_temp_file,
            read_text_file,
            write_to_path,
            save_typst_at,
            vision_present,
            set_vision_mode,
            start_download,
            pause_download,
            download_status,
            model_files,
            delete_model
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_text_splits_large_text() {
        let text = format!("para one\n\n{}\n\nlast para", "x ".repeat(800));
        let chunks = chunk_text(&text);
        assert!(chunks.len() >= 2, "expected multiple chunks");
        assert!(chunks.iter().any(|c| c.contains("para one")));
        assert!(chunks.iter().any(|c| c.contains("last para")));
    }

    #[test]
    fn chunk_text_ignores_blank() {
        assert!(chunk_text("   \n\n   ").is_empty());
    }

    #[test]
    fn sanitize_title_cleans_and_defaults() {
        assert_eq!(sanitize_title("Hello: World!"), "Hello_ World_");
        assert_eq!(sanitize_title("   "), "document");
        assert_eq!(sanitize_title(""), "document");
        assert_eq!(sanitize_title(&"a".repeat(100)).chars().count(), 60);
    }

    #[test]
    fn retrieve_picks_relevant_and_labels() {
        let chunks = vec![
            ("dragons.txt".to_string(), "The red dragon breathes fire on the keep.".to_string()),
            ("meadow.txt".to_string(), "A quiet meadow full of spring flowers.".to_string()),
        ];
        let out = retrieve_chunks(&chunks, "dragon fire", 1000);
        assert!(out.contains("dragon"));
        assert!(out.contains("[dragons.txt]"));
        assert!(!out.contains("meadow"));
    }

    #[test]
    fn retrieve_noise_query_returns_nothing() {
        let chunks = vec![("a.txt".to_string(), "hello world".to_string())];
        // tokens of <=2 chars are filtered out, leaving no usable terms
        assert_eq!(retrieve_chunks(&chunks, "  ?? a ", 1000), "");
    }

    #[test]
    fn retrieve_respects_max_chars() {
        let chunks = vec![
            ("a.txt".to_string(), "alpha one".to_string()),
            ("b.txt".to_string(), "alpha two".to_string()),
            ("c.txt".to_string(), "alpha three".to_string()),
        ];
        let small = retrieve_chunks(&chunks, "alpha", 30);
        let big = retrieve_chunks(&chunks, "alpha", 1000);
        assert!(small.len() <= 40);
        assert!(big.len() > small.len(), "more budget should keep more chunks");
    }
}
