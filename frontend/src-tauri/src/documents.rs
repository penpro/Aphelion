//! Document generation (Typst → PDF), plain-text / code file output, opening files in the
//! default app, and reading/writing files the user is editing. The app does the I/O.
use crate::state::Granted;
use std::collections::HashSet;
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

/// True if `target` (or, for a not-yet-created file, its parent dir) resolves inside a granted
/// folder. Both sides are canonicalized so it's robust to `.`/`..`/symlinks on every OS.
fn path_allowed(granted: &HashSet<PathBuf>, target: &str) -> bool {
    let p = PathBuf::from(target);
    let canon = std::fs::canonicalize(&p).ok().or_else(|| {
        p.parent()
            .and_then(|par| std::fs::canonicalize(par).ok())
            .map(|c| c.join(p.file_name().unwrap_or_default()))
    });
    match canon {
        Some(c) => granted.iter().any(|g| c == *g || c.starts_with(g)),
        None => false,
    }
}

/// Record a folder the user explicitly picked (file or folder dialog) as granted. For a file,
/// its parent directory is granted, so editing it / saving a PDF beside it stays in scope.
#[tauri::command]
pub fn grant_path(app: tauri::AppHandle, path: String) {
    let p = PathBuf::from(&path);
    let dir = if p.is_dir() {
        p.clone()
    } else {
        p.parent().map(|x| x.to_path_buf()).unwrap_or(p)
    };
    if let Ok(canon) = std::fs::canonicalize(&dir) {
        app.state::<Granted>().0.lock().unwrap_or_else(|e| e.into_inner()).insert(canon);
    }
}

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

/// Run `typst compile <input> <out>` rooted at `root`; returns Typst's stderr on failure.
fn run_typst(app: &tauri::AppHandle, root: &PathBuf, input: &PathBuf, out: &PathBuf) -> Result<(), String> {
    let exe = typst_path(app).ok_or("Typst engine not found")?;
    let mut cmd = Command::new(&exe);
    cmd.arg("compile").arg("--root").arg(root).arg(input).arg(out);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let result = cmd.output().map_err(|e| format!("failed to run Typst: {e}"))?;
    if result.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&result.stderr);
        Err(if err.trim().is_empty() {
            "Typst could not compile the document.".into()
        } else {
            err.to_string()
        })
    }
}

/// Compile Typst `source` to a PDF. With `out_path`, writes there; otherwise to a temp
/// preview file. Returns the PDF path on success, or Typst's error output on failure.
#[tauri::command]
pub fn compile_typst(app: tauri::AppHandle, source: String, out_path: Option<String>) -> Result<String, String> {
    let work = std::env::temp_dir().join("aphelion-typst");
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let input = work.join("document.typ");
    std::fs::write(&input, &source).map_err(|e| format!("couldn't write source: {e}"))?;
    let out = match out_path {
        Some(p) => PathBuf::from(p),
        None => work.join("preview.pdf"),
    };
    run_typst(&app, &work, &input, &out)?;
    Ok(out.to_string_lossy().to_string())
}

/// Open a file with the OS default application (used to show a generated PDF).
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
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
/// `<title>.pdf` beside it (folder is the Typst root, so `#image(...)` resolves). Returns the PDF path.
#[tauri::command]
pub fn save_document(app: tauri::AppHandle, folder: String, title: String, source: String) -> Result<String, String> {
    let dir = PathBuf::from(&folder);
    if !dir.is_dir() {
        return Err("That folder no longer exists.".into());
    }
    let safe = sanitize_title(&title);
    let typ = dir.join(format!("{safe}.typ"));
    let pdf = dir.join(format!("{safe}.pdf"));
    std::fs::write(&typ, &source).map_err(|e| format!("couldn't write the source: {e}"))?;
    run_typst(&app, &dir, &typ, &pdf)?;
    Ok(pdf.to_string_lossy().to_string())
}

/// List saved document sources / editable files in a folder, newest first — for reopening.
#[tauri::command]
pub fn list_documents(folder: String) -> Vec<String> {
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
pub fn read_document(folder: String, name: String) -> Result<String, String> {
    let p = PathBuf::from(&folder).join(&name);
    std::fs::read_to_string(&p).map_err(|e| e.to_string())
}

/// Save a generated plain-text / code document as `<title>.<ext>` in a granted folder,
/// ready for an IDE/editor to open. Returns the file path.
#[tauri::command]
pub fn save_text_document(folder: String, title: String, ext: String, content: String) -> Result<String, String> {
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
pub fn write_temp_file(name: String, content: String) -> Result<String, String> {
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
pub fn read_text_file(granted: tauri::State<Granted>, path: String) -> Result<String, String> {
    if !path_allowed(&granted.0.lock().unwrap_or_else(|e| e.into_inner()), &path) {
        return Err("That file isn't in a folder you've opened — use the Open button to pick it.".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    String::from_utf8(bytes)
        .map_err(|_| "That file isn't text (it looks like an image or binary). To analyze an image, drag it into the chat instead.".to_string())
}

/// Overwrite a text/code file at an absolute path (saving edits back to the opened file).
#[tauri::command]
pub fn write_to_path(granted: tauri::State<Granted>, path: String, content: String) -> Result<(), String> {
    if !path_allowed(&granted.0.lock().unwrap_or_else(|e| e.into_inner()), &path) {
        return Err("That location isn't in a folder you've opened.".into());
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

/// Write Typst source to `typ_path` and compile a PDF beside it; returns the PDF path.
#[tauri::command]
pub fn save_typst_at(
    app: tauri::AppHandle,
    granted: tauri::State<Granted>,
    typ_path: String,
    source: String,
) -> Result<String, String> {
    if !path_allowed(&granted.0.lock().unwrap_or_else(|e| e.into_inner()), &typ_path) {
        return Err("That location isn't in a folder you've opened.".into());
    }
    let typ = PathBuf::from(&typ_path);
    let dir = typ.parent().map(|p| p.to_path_buf()).unwrap_or_else(std::env::temp_dir);
    std::fs::write(&typ, &source).map_err(|e| format!("couldn't write the source: {e}"))?;
    let pdf = typ.with_extension("pdf");
    run_typst(&app, &dir, &typ, &pdf)?;
    Ok(pdf.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_title_cleans_and_defaults() {
        assert_eq!(sanitize_title("Hello: World!"), "Hello_ World_");
        assert_eq!(sanitize_title("   "), "document");
        assert_eq!(sanitize_title(""), "document");
        assert_eq!(sanitize_title(&"a".repeat(100)).chars().count(), 60);
    }

    #[test]
    fn path_allowed_scopes_to_granted_dirs() {
        let base = std::env::temp_dir().join(format!("aph-grant-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&base);
        std::fs::write(base.join("a.txt"), "x").unwrap();
        let mut granted = HashSet::new();
        granted.insert(std::fs::canonicalize(&base).unwrap());
        // existing file inside a granted dir
        assert!(path_allowed(&granted, &base.join("a.txt").to_string_lossy()));
        // a not-yet-created file inside a granted dir (parent resolves)
        assert!(path_allowed(&granted, &base.join("new.pdf").to_string_lossy()));
        // outside any granted dir
        assert!(!path_allowed(&granted, &std::env::temp_dir().join("aph-outside.txt").to_string_lossy()));
        // nothing granted → nothing allowed
        assert!(!path_allowed(&HashSet::new(), &base.join("a.txt").to_string_lossy()));
        let _ = std::fs::remove_dir_all(&base);
    }
}
