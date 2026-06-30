//! App version for display in Settings. Update *checking + install* is handled by the Tauri
//! updater plugin (manual, user-triggered, signature-verified) — wired in `lib.rs`, configured
//! under `plugins.updater` in tauri.conf.json, and driven from `UpdateCheck.tsx`.

/// The running app version (shown in Settings → Updates).
#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
