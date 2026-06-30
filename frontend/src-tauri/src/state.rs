//! Shared app state (managed by Tauri) and the model directory helper.
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;
use tauri::Manager;

pub(crate) const LLAMA_PORT: u16 = 11435;

/// Holds the bundled llama.cpp server process so we can shut it down / restart it.
pub struct Engine(pub Mutex<Option<Child>>);

/// Caches ingested + chunked text per knowledge-folder path (re-read on app restart).
pub struct KnowledgeCache(pub Mutex<HashMap<String, Vec<(String, String)>>>);

/// Holds the vision model's process while in image mode (swapped onto LLAMA_PORT).
pub struct VisionEngine(pub Mutex<Option<Child>>);

/// Filename of the main (text) model, remembered so it reloads when leaving image mode.
pub struct MainModel(pub Mutex<Option<String>>);

/// Progress + state of one in-flight model download.
#[derive(Clone)]
pub struct DownloadEntry {
    pub received: u64,
    pub total: u64,
    pub status: String, // downloading | resuming | paused | failed | done
}

/// Tracks in-flight model downloads so the UI can show progress and pause/resume.
pub struct Downloads(pub Mutex<HashMap<String, DownloadEntry>>);

/// Folders the user has explicitly opened/granted via a file or folder dialog. The scoped
/// file commands (read_text_file / write_to_path / save_typst_at) only operate within these,
/// so the "it only touches files you hand it" guarantee is enforced in Rust, not by convention.
pub struct Granted(pub Mutex<HashSet<PathBuf>>);

/// The app's own model directory (AppData/<id>/models), created if missing.
pub(crate) fn model_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("models");
    let _ = std::fs::create_dir_all(&dir);
    Some(dir)
}
