//! Aphelion Tauri backend. Domain logic lives in the modules below; this file wires up
//! state, auto-starts the engine on launch, and registers the command handlers.
mod documents;
mod downloads;
mod engine;
mod knowledge;
mod state;
mod updates;
mod vision;

use state::{model_dir, Downloads, Engine, KnowledgeCache, MainModel, VisionEngine};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            // Auto-start the engine on the largest non-projector model already downloaded
            // (the user's main model is bigger than any bundled vision model); else the
            // frontend shows the first-run setup wizard.
            let handle = app.handle().clone();
            if let Some(dir) = model_dir(&handle) {
                if let Ok(entries) = std::fs::read_dir(&dir) {
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
                        let child = engine::spawn_engine(&handle, &model);
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
            engine::gpu_vram,
            engine::vram_total_mb,
            engine::list_models,
            engine::model_dir_path,
            engine::start_engine,
            engine::model_files,
            engine::delete_model,
            engine::shutdown_engine,
            knowledge::folder_info,
            knowledge::retrieve_context,
            knowledge::extract_pdf,
            documents::compile_typst,
            documents::open_path,
            documents::save_document,
            documents::list_documents,
            documents::read_document,
            documents::save_text_document,
            documents::write_temp_file,
            documents::read_text_file,
            documents::write_to_path,
            documents::save_typst_at,
            vision::vision_present,
            vision::set_vision_mode,
            vision::list_images,
            vision::read_image_data,
            downloads::start_download,
            downloads::pause_download,
            downloads::download_status,
            updates::app_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
