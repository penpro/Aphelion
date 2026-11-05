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

/// Strip `<...>` tags, keeping the text between them.
fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

/// Decode the handful of entities our documents actually contain.
fn decode_entities(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&") // last, so "&amp;lt;" stays literal
}

/// Collapse inline whitespace within each paragraph; paragraphs stay split on blank lines,
/// which is what `chunk_text` keys on.
fn tidy(s: &str) -> String {
    s.split("\n\n")
        .map(|para| para.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|para| !para.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Remove `<tag ...>...</tag>` blocks entirely (case-insensitive), content included.
fn remove_block(s: &str, tag: &str) -> String {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let lower = s.to_ascii_lowercase(); // byte-length stable, so offsets map back to `s`
    let mut out = String::new();
    let mut i = 0usize;
    while i < s.len() {
        match lower[i..].find(open.as_str()) {
            Some(rel) => {
                let start = i + rel;
                out.push_str(&s[i..start]);
                match lower[start..].find(close.as_str()) {
                    Some(crel) => i = start + crel + close.len(),
                    None => break, // unterminated — drop the remainder
                }
            }
            None => {
                out.push_str(&s[i..]);
                break;
            }
        }
    }
    out
}

/// Best-effort HTML -> text: drop script/style, turn block-level ends into paragraph
/// breaks, strip the rest.
fn strip_html(s: &str) -> String {
    let mut s = remove_block(&remove_block(s, "script"), "style");
    for close in ["</p>", "</div>", "</h1>", "</h2>", "</h3>", "</h4>", "</li>", "</tr>", "</section>"] {
        s = s.replace(close, "\n\n");
    }
    for br in ["<br>", "<br/>", "<br />"] {
        s = s.replace(br, "\n");
    }
    tidy(&decode_entities(&strip_tags(&s)))
}

/// Best-effort RTF -> text: honor \par/\line/\tab, skip header/ignorable groups, drop
/// other control words and braces.
fn de_rtf(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    let mut depth: i32 = 0;
    let mut skip_to: i32 = -1; // when >=0, skip text until depth drops below it
    while let Some(c) = chars.next() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if skip_to >= 0 && depth < skip_to {
                    skip_to = -1;
                }
            }
            '\\' => match chars.peek().copied() {
                Some('*') => {
                    chars.next();
                    if skip_to < 0 {
                        skip_to = depth;
                    }
                }
                Some('\'') => {
                    chars.next();
                    let hex: String = (0..2).filter_map(|_| chars.next()).collect();
                    if skip_to < 0 {
                        if let Ok(b) = u8::from_str_radix(&hex, 16) {
                            out.push(b as char);
                        }
                    }
                }
                Some(n) if !n.is_ascii_alphabetic() => {
                    chars.next();
                    if skip_to < 0 && matches!(n, '\\' | '{' | '}') {
                        out.push(n);
                    }
                }
                Some(_) => {
                    let mut word = String::new();
                    while let Some(&m) = chars.peek() {
                        if m.is_ascii_alphabetic() {
                            word.push(m);
                            chars.next();
                        } else {
                            break;
                        }
                    }
                    if let Some(&m) = chars.peek() {
                        if m == '-' || m.is_ascii_digit() {
                            chars.next();
                            while let Some(&d) = chars.peek() {
                                if d.is_ascii_digit() {
                                    chars.next();
                                } else {
                                    break;
                                }
                            }
                        }
                    }
                    if chars.peek() == Some(&' ') {
                        chars.next();
                    }
                    if matches!(
                        word.as_str(),
                        "fonttbl" | "colortbl" | "stylesheet" | "info" | "filetbl" | "listtable" | "listoverridetable"
                    ) {
                        if skip_to < 0 {
                            skip_to = depth;
                        }
                    } else if skip_to < 0 {
                        match word.as_str() {
                            "par" | "line" | "sect" => out.push('\n'),
                            "tab" => out.push('\t'),
                            _ => {}
                        }
                    }
                }
                None => {}
            },
            _ => {
                if skip_to < 0 {
                    out.push(c);
                }
            }
        }
    }
    tidy(&out)
}

/// Extract visible text from a .docx: unzip `word/document.xml`, turn paragraph ends into
/// blank lines, strip tags, decode entities.
fn read_docx_text(path: &std::path::Path) -> Option<String> {
    use std::io::Read;
    let file = std::fs::File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut xml = String::new();
    archive.by_name("word/document.xml").ok()?.read_to_string(&mut xml).ok()?;
    let xml = xml
        .replace("</w:p>", "\n\n")
        .replace("<w:br/>", "\n")
        .replace("<w:br />", "\n")
        .replace("<w:tab/>", "\t");
    let text = tidy(&decode_entities(&strip_tags(&xml)));
    (!text.trim().is_empty()).then_some(text)
}

/// Read every supported file under `path` into (filename, chunk) pairs. Text, markdown,
/// code, CSV and JSON read directly; PDFs via text extraction; Word (.docx), HTML and RTF
/// via lightweight converters (scanned/image PDFs yield nothing).
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
                "html" | "htm" => std::fs::read_to_string(&p).ok().map(|s| strip_html(&s)),
                "rtf" => std::fs::read_to_string(&p).ok().map(|s| de_rtf(&s)),
                "docx" => read_docx_text(&p),
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
    fn html_strips_to_readable_text() {
        let t = strip_html("<h1>Aphelion</h1><p>Local <b>AI</b> &amp; private.</p><script>var x=1</script>");
        assert!(t.contains("Aphelion"));
        assert!(t.contains("Local AI & private."), "got: {t}");
        assert!(!t.contains("var x"));
        assert!(!t.contains('<'));
    }

    #[test]
    fn rtf_strips_to_readable_text() {
        let t = de_rtf(r"{\rtf1\ansi\deff0{\fonttbl{\f0 Helvetica;}}\fs36\b Hello Aphelion\b0\fs24\par \par Second line\par }");
        assert!(t.contains("Hello Aphelion"), "got: {t}");
        assert!(t.contains("Second line"));
        assert!(!t.contains("Helvetica"));
        assert!(!t.contains("rtf1"));
    }

    #[test]
    fn docx_extracts_paragraph_text() {
        use std::io::Write;
        let path = std::env::temp_dir().join(format!(
            "aph-docx-{}.docx",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
        ));
        {
            let f = std::fs::File::create(&path).unwrap();
            let mut z = zip::ZipWriter::new(f);
            z.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(br#"<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Hello Aphelion</w:t></w:r></w:p><w:p><w:r><w:t>Second line</w:t></w:r></w:p></w:body></w:document>"#).unwrap();
            z.finish().unwrap();
        }
        let text = read_docx_text(&path).unwrap();
        assert!(text.contains("Hello Aphelion"), "got: {text}");
        assert!(text.contains("Second line"), "got: {text}");
        let _ = std::fs::remove_file(&path);
    }

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
