//! On-disk storage for character portrait images. Large images live as files here (referenced by
//! path) instead of bloating the localStorage-persisted store as base64 data-URLs. The frontend
//! reads them back through Tauri's asset protocol (convertFileSrc), scoped to this folder.
use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::PathBuf;
use tauri::Manager;

/// `<app_data_dir>/portraits`, created if missing.
fn portraits_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("portraits");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Decode a base64 image data-URL and write it to `<portraits>/<id>.<ext>`; return the file path.
#[tauri::command]
pub fn save_portrait(app: tauri::AppHandle, id: String, data_url: String) -> Result<String, String> {
    let dir = portraits_dir(&app)?;
    let (meta, b64) = data_url.split_once(',').ok_or("not a data URL")?;
    let ext = if meta.contains("png") {
        "png"
    } else if meta.contains("jpeg") || meta.contains("jpg") {
        "jpg"
    } else {
        "webp"
    };
    let bytes = STANDARD.decode(b64.trim().as_bytes()).map_err(|e| e.to_string())?;
    // A portrait is ~60-150 KB; reject anything absurd so a bad caller can't fill the disk.
    if bytes.len() > 12 * 1024 * 1024 {
        return Err("image too large".into());
    }
    // The id is a uuid, but stay filesystem-safe regardless.
    let safe: String = id.chars().filter(|c| c.is_alphanumeric() || *c == '-').take(64).collect();
    let safe = if safe.is_empty() { "portrait".to_string() } else { safe };
    let path = dir.join(format!("{safe}.{ext}"));
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Delete a portrait file (best-effort). Only touches files inside the portraits dir.
#[tauri::command]
pub fn delete_portrait(app: tauri::AppHandle, path: String) {
    if let Ok(dir) = portraits_dir(&app) {
        let p = PathBuf::from(&path);
        if p.starts_with(&dir) {
            let _ = std::fs::remove_file(&p);
        }
    }
}
