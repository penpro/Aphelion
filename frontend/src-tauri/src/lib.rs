use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

/// Holds the bundled llama.cpp server process so we can shut it down / restart it.
struct Engine(Mutex<Option<Child>>);

const LLAMA_PORT: u16 = 11435;

/// The app's own model directory (AppData/<id>/models), created if missing.
fn model_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("models");
    let _ = std::fs::create_dir_all(&dir);
    Some(dir)
}

/// Resolve `llama-server.exe` (resource dir when packaged, dev `bin/llama` otherwise).
fn llama_server_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resource = app
        .path()
        .resolve("llama/llama-server.exe", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|p| p.exists());
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin/llama/llama-server.exe");
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

/// Total VRAM (MiB) for model recommendation. DXGI first (universal), nvidia-smi fallback.
#[tauri::command]
fn vram_total_mb() -> Option<u64> {
    #[cfg(windows)]
    if let Some(mb) = detect_vram_mb_dxgi() {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_upload::init())
        .manage(Engine(Mutex::new(None)))
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
            start_engine
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
