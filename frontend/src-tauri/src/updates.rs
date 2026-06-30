//! Manual, user-initiated update check. Aphelion is offline by default; this is the one command
//! that reaches the network, and only when the user clicks "Check for updates" after an explicit
//! in-app disclosure. It reads the latest GitHub release tag and compares it to the running
//! version — no telemetry, nothing about the user or their data is sent.
use serde::Serialize;

const RELEASES_API: &str = "https://api.github.com/repos/penpro/Aphelion/releases/latest";
const RELEASES_PAGE: &str = "https://github.com/penpro/Aphelion/releases/latest";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub update_available: bool,
    pub url: String,
}

/// The running app version (for display in Settings, no network needed).
#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Contact GitHub to read the latest published release and compare it to the running version.
/// Called only after the user confirms the in-app network disclosure.
#[tauri::command]
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let client = reqwest::Client::builder()
        .user_agent(concat!("Aphelion/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(RELEASES_API)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| "Couldn't reach GitHub — check your internet connection.".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("GitHub returned HTTP {}.", resp.status().as_u16()));
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|_| "Couldn't read GitHub's response.".to_string())?;
    let tag = json
        .get("tag_name")
        .and_then(|t| t.as_str())
        .ok_or("No published release was found.")?;
    let latest = tag.trim_start_matches('v').to_string();
    let url = json
        .get("html_url")
        .and_then(|u| u.as_str())
        .unwrap_or(RELEASES_PAGE)
        .to_string();
    let update_available = is_newer(&latest, &current);
    Ok(UpdateInfo { current, latest, update_available, url })
}

/// True if dotted-numeric `latest` is a higher version than `current` (e.g. 0.1.10 > 0.1.9).
fn is_newer(latest: &str, current: &str) -> bool {
    fn parts(s: &str) -> Vec<u64> {
        s.split('.')
            .map(|p| p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0))
            .collect()
    }
    let (l, c) = (parts(latest), parts(current));
    for i in 0..l.len().max(c.len()) {
        let (lv, cv) = (l.get(i).copied().unwrap_or(0), c.get(i).copied().unwrap_or(0));
        if lv != cv {
            return lv > cv;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn newer_patch_minor_major() {
        assert!(is_newer("0.1.3", "0.1.2"));
        assert!(is_newer("0.2.0", "0.1.9"));
        assert!(is_newer("1.0.0", "0.9.9"));
    }

    #[test]
    fn same_or_older_is_not_newer() {
        assert!(!is_newer("0.1.2", "0.1.2"));
        assert!(!is_newer("0.1.1", "0.1.2"));
        assert!(!is_newer("0.1.2", "0.1.3"));
    }

    #[test]
    fn compares_numerically_not_lexically() {
        assert!(is_newer("0.1.10", "0.1.9"));
        assert!(!is_newer("0.1.9", "0.1.10"));
    }
}
