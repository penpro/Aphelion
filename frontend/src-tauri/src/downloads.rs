//! Resumable, background model downloads: stream to disk via reqwest, resume a partial file
//! with an HTTP Range request, and report progress so the UI can show + pause/resume them.
use crate::state::{model_dir, DownloadEntry, Downloads};
use std::path::Path;
use tauri::Manager;

/// Snapshot of all downloads: (filename, received_bytes, total_bytes, status).
#[tauri::command]
pub fn download_status(downloads: tauri::State<Downloads>) -> Vec<(String, u64, u64, String)> {
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
pub fn pause_download(downloads: tauri::State<Downloads>, filename: String) {
    if let Some(e) = downloads.0.lock().unwrap().get_mut(&filename) {
        e.status = "paused".into();
    }
}

/// Start (or resume) a background download of `url` into the model dir as `filename`.
#[tauri::command]
pub fn start_download(app: tauri::AppHandle, url: String, filename: String) -> Result<(), String> {
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
