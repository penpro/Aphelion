//! Knowledge folder: ingest + chunk a granted folder, retrieve query-relevant chunks,
//! and extract text from dropped PDFs. The app reads files; the model only sees text.
use crate::state::KnowledgeCache;
use std::path::PathBuf;
use tauri::State;

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

/// Ingest (cached) a knowledge folder; returns (file count, chunk count, file names).
#[tauri::command]
pub fn folder_info(cache: State<KnowledgeCache>, path: String) -> (usize, usize, Vec<String>) {
    let mut map = cache.0.lock().unwrap_or_else(|e| e.into_inner());
    let chunks = map.entry(path.clone()).or_insert_with(|| ingest_folder(&path));
    let mut names: Vec<String> = chunks.iter().map(|c| c.0.clone()).collect();
    names.sort();
    names.dedup();
    (names.len(), chunks.len(), names)
}

/// Retrieve the chunks most relevant to `query` (keyword scoring), up to `max_chars`.
#[tauri::command]
pub fn retrieve_context(cache: State<KnowledgeCache>, path: String, query: String, max_chars: usize) -> String {
    let mut map = cache.0.lock().unwrap_or_else(|e| e.into_inner());
    let chunks = map.entry(path.clone()).or_insert_with(|| ingest_folder(&path));
    if chunks.is_empty() {
        return String::new();
    }
    retrieve_chunks(chunks, &query, max_chars)
}

/// Extract text from dropped PDF bytes (for attaching a PDF to a chat). Scanned/image-only
/// PDFs yield nothing.
#[tauri::command]
pub fn extract_pdf(data: Vec<u8>) -> Result<String, String> {
    let tmp = std::env::temp_dir().join(format!(
        "aphelion-drop-{}.pdf",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::write(&tmp, &data).map_err(|e| e.to_string())?;
    let text = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| pdf_extract::extract_text(&tmp).ok()))
        .ok()
        .flatten();
    let _ = std::fs::remove_file(&tmp);
    text.filter(|t| !t.trim().is_empty())
        .ok_or_else(|| "Couldn't extract text from that PDF (it may be scanned / image-only).".to_string())
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
