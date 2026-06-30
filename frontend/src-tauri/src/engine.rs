//! Model/engine lifecycle: VRAM detection, listing/loading/deleting models, spawning llama-server.
use crate::state::{model_dir, Engine, MainModel, VisionEngine, LLAMA_PORT};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use tauri::Manager;

/// The llama.cpp server binary name (`.exe` only on Windows).
fn server_bin() -> &'static str {
    if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}

/// Resolve the llama-server binary (resource dir when packaged, dev `bin/llama` otherwise).
pub(crate) fn llama_server_path(app: &tauri::AppHandle) -> Option<PathBuf> {
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
pub(crate) fn spawn_engine(app: &tauri::AppHandle, model: &Path) -> Option<Child> {
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
pub fn gpu_vram() -> Option<(u64, u64)> {
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
pub fn vram_total_mb() -> Option<u64> {
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

/// List downloaded text-model files (*.gguf, excluding vision projectors) in the app model dir.
#[tauri::command]
pub fn list_models(app: tauri::AppHandle) -> Vec<String> {
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
pub fn model_dir_path(app: tauri::AppHandle) -> Option<String> {
    model_dir(&app).map(|p| p.to_string_lossy().to_string())
}

/// Start (or restart) the engine on a downloaded model file.
#[tauri::command]
pub fn start_engine(app: tauri::AppHandle, filename: String) -> Result<(), String> {
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

/// List model files: (filename, size_bytes, is_loaded_main). Includes vision files + projectors.
#[tauri::command]
pub fn model_files(app: tauri::AppHandle) -> Vec<(String, u64, bool)> {
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
pub fn delete_model(app: tauri::AppHandle, filename: String) -> Result<(), String> {
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
