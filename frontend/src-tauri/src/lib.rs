use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

/// Holds the bundled llama.cpp server process so we can shut it down on exit.
struct Engine(Mutex<Option<Child>>);

const LLAMA_PORT: u16 = 11435;

// Phase 1 (dev): point at the SuperGemma4 GGUF already on disk (the Ollama blob).
// Phase 2 replaces this with managed model storage + a first-run download wizard.
const MODEL_PATH: &str =
    "C:\\Users\\penum\\.ollama\\models\\blobs\\sha256-e773b0a209d48524f9d485bca0818247f75d7ddde7cce951367a7e441fb59137";

/// Locate the bundled `llama-server.exe` (the resource dir when packaged, the dev
/// `bin/llama` folder otherwise) and launch it hidden on a localhost port.
fn spawn_engine(app: &tauri::AppHandle) -> Option<Child> {
    let resource = app
        .path()
        .resolve("llama/llama-server.exe", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|p| p.exists());
    let dev = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin/llama/llama-server.exe");
    let exe = resource.unwrap_or(dev);
    if !exe.exists() {
        eprintln!("[engine] llama-server.exe not found at {exe:?}");
        return None;
    }

    let mut cmd = Command::new(&exe);
    cmd.args([
        "-m",
        MODEL_PATH,
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

    // Hide the console window the server would otherwise pop up on Windows.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    match cmd.spawn() {
        Ok(child) => {
            println!("[engine] llama-server started (pid {})", child.id());
            Some(child)
        }
        Err(e) => {
            eprintln!("[engine] failed to start llama-server: {e}");
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Engine(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let child = spawn_engine(app.handle());
            *app.state::<Engine>().0.lock().unwrap() = child;
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
