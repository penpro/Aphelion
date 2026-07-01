//! Vision model support: presence check, swapping the loaded model between text and image
//! mode on the main port, and reading folder images for the classify→PDF workflow.
use crate::engine::{llama_server_path, spawn_engine};
use crate::state::{model_dir, Engine, MainModel, VisionEngine, LLAMA_PORT};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::Manager;

/// Whether both files of a vision model are present in the model dir.
#[tauri::command]
pub fn vision_present(app: tauri::AppHandle, text_file: String, mmproj_file: String) -> bool {
    match model_dir(&app) {
        Some(dir) => dir.join(&text_file).exists() && dir.join(&mmproj_file).exists(),
        None => false,
    }
}

/// Switch between text and image mode by swapping the model loaded on LLAMA_PORT.
/// on=true: stop the main model, load the vision model (with its mmproj).
/// on=false: stop the vision model, reload the remembered main model.
#[tauri::command]
pub fn set_vision_mode(app: tauri::AppHandle, on: bool, text_file: String, mmproj_file: String) -> Result<(), String> {
    let dir = model_dir(&app).ok_or("no model dir")?;
    if on {
        let model = dir.join(&text_file);
        let mmproj = dir.join(&mmproj_file);
        if !model.exists() || !mmproj.exists() {
            return Err("vision model files not found — download it in Settings".into());
        }
        if let Some(mut old) = app.state::<Engine>().0.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = old.kill();
        }
        if let Some(mut old) = app.state::<VisionEngine>().0.lock().unwrap_or_else(|e| e.into_inner()).take() {
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
        cmd.stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        match cmd.spawn() {
            Ok(child) => {
                *app.state::<VisionEngine>().0.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
                Ok(())
            }
            Err(e) => Err(format!("failed to start vision engine: {e}")),
        }
    } else {
        if let Some(mut old) = app.state::<VisionEngine>().0.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = old.kill();
        }
        let main = app.state::<MainModel>().0.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let main = main.ok_or("no main model on record to reload")?;
        let model = dir.join(&main);
        if !model.exists() {
            return Err(format!("main model not found: {main}"));
        }
        if let Some(mut old) = app.state::<Engine>().0.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = old.kill();
        }
        let child = spawn_engine(&app, &model);
        let ok = child.is_some();
        *app.state::<Engine>().0.lock().unwrap_or_else(|e| e.into_inner()) = child;
        if ok {
            Ok(())
        } else {
            Err("main model failed to reload".into())
        }
    }
}

/// List image filenames in a folder (non-recursive), sorted.
#[tauri::command]
pub fn list_images(folder: String) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&folder) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_file() {
                let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
                if matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp") {
                    if let Some(n) = p.file_name() {
                        out.push(n.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    out.sort();
    out
}

/// Read an image file from a folder as a base64 data URL (to send to the vision model).
#[tauri::command]
pub fn read_image_data(folder: String, name: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let p = PathBuf::from(&folder).join(&name);
    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
    let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/jpeg",
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(&bytes)))
}
